import type { FastifyInstance } from 'fastify';
import {
  checkLoginRateLimit,
  clearSessionCookie,
  createUserSession,
  destroySession,
  hashPassword,
  noteLoginAttempt,
  readSessionCookie,
  requireRole,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from '../auth/index.js';
import {
  buildDiscordAuthorizeUrl,
  clearOAuthStateCookie,
  createOAuthState,
  exchangeDiscordCode,
  getDiscordOAuthConfig,
  isDiscordOAuthConfigured,
  readOAuthStateCookie,
  setOAuthStateCookie,
} from '../auth/discord.js';
import {
  createUser,
  ensureUniqueUsername,
  getUserByDiscordId,
  getUserById,
  getUserByUsername,
  linkDiscordId,
  listUsers,
  revokeUserSessions,
  updateUser,
} from '../db/authRepos.js';
import {
  createKeyedApiKey,
  listActiveApiKeys,
  normalizeScopes,
  revokeKeyedApiKey,
} from '../auth/apiKeys.js';
import { ALL_SCOPES } from '../auth/types.js';
import type { UserRole } from '../auth/types.js';

const DISCORD_PASSWORD_SENTINEL = '!discord-oauth';

function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.ip || 'unknown';
}

function redirectLoginError(reply: import('fastify').FastifyReply, code: string) {
  clearOAuthStateCookie(reply);
  return reply.redirect(`/?discord_error=${encodeURIComponent(code)}`);
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/providers', async () => {
    return {
      discord: isDiscordOAuthConfigured(),
      hub_sso: Boolean(
        (process.env.SSO_SHARED_SECRET || '').trim() &&
          (process.env.HUB_SSO_REDEEM_URL || '').trim()
      ),
    };
  });

  /**
   * One-time ticket SSO from BozNetwork Hub.
   * GET /api/auth/sso?ticket=...
   * Redeems ticket at Hub, creates/links local user, sets mbb_session cookie.
   */
  app.get('/api/auth/sso', async (req, reply) => {
    const secret = (process.env.SSO_SHARED_SECRET || '').trim();
    const redeemUrl = (
      process.env.HUB_SSO_REDEEM_URL || 'http://127.0.0.1:5000/api/v1/sso/redeem'
    ).trim();
    if (!secret || !redeemUrl) {
      return reply.redirect('/?sso_error=not_configured');
    }

    const q = req.query as { ticket?: string };
    const ticket = (q.ticket || '').trim();
    if (!ticket) return reply.redirect('/?sso_error=missing_ticket');

    let claims: {
      username?: string;
      display_name?: string;
      discord_id?: string | null;
      role?: UserRole;
      target?: string;
    };
    try {
      const res = await fetch(redeemUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SSO-Secret': secret,
        },
        body: JSON.stringify({ ticket, target: 'mybookbrr' }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        claims?: typeof claims;
      };
      if (!res.ok || body.status !== 'success' || !body.claims) {
        req.log.warn({ status: res.status, body }, 'Hub SSO redeem failed');
        return reply.redirect(
          `/?sso_error=${encodeURIComponent(body.message || 'redeem_failed')}`
        );
      }
      claims = body.claims;
    } catch (err) {
      req.log.error({ err }, 'Hub SSO redeem request failed');
      return reply.redirect('/?sso_error=redeem_unreachable');
    }

    const role: UserRole = claims.role === 'viewer' ? 'viewer' : 'admin';
    const discordId = claims.discord_id ? String(claims.discord_id) : null;
    let user = discordId ? getUserByDiscordId(discordId) : null;

    if (!user && claims.username) {
      user = getUserByUsername(String(claims.username));
      if (user && discordId && !user.discordId) {
        user = linkDiscordId(user.id, discordId) || user;
      }
    }

    if (!user) {
      const base =
        (claims.username || claims.display_name || 'hub_user')
          .replace(/[^a-zA-Z0-9_\-.]/g, '')
          .slice(0, 24) || 'hub_user';
      const username = ensureUniqueUsername(base);
      user = createUser({
        username,
        passwordHash: DISCORD_PASSWORD_SENTINEL,
        role,
        mustChangePassword: false,
        discordId,
      });
    } else {
      // Keep role in sync with Hub permissions (admin/control → admin)
      if (user.role !== role) {
        updateUser(user.id, { role });
        user = getUserById(user.id) || user;
      }
    }

    if (!user.enabled) {
      return reply.redirect('/?sso_error=disabled');
    }

    const { token, expiresAt } = createUserSession(user, {
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });
    setSessionCookie(reply, token, expiresAt);
    req.log.info(
      { userId: user.id, username: user.username, role: user.role, via: 'hub_sso' },
      'SSO login from Hub'
    );
    return reply.redirect('/');
  });

  app.get('/api/auth/discord', async (req, reply) => {
    if (!isDiscordOAuthConfigured()) {
      return reply.code(503).send({ error: 'Discord OAuth is not configured' });
    }
    const state = createOAuthState();
    setOAuthStateCookie(reply, state);
    return reply.redirect(buildDiscordAuthorizeUrl(state));
  });

  app.get('/api/auth/discord/callback', async (req, reply) => {
    if (!isDiscordOAuthConfigured()) {
      return redirectLoginError(reply, 'not_configured');
    }
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error) return redirectLoginError(reply, 'denied');
    if (!q.code || !q.state) return redirectLoginError(reply, 'missing_code');

    const expected = readOAuthStateCookie(req.cookies as Record<string, string> | undefined);
    clearOAuthStateCookie(reply);
    if (!expected || expected !== q.state) {
      return redirectLoginError(reply, 'invalid_state');
    }

    const cfg = getDiscordOAuthConfig();
    let discordUser: { id: string; username: string; globalName: string };
    try {
      discordUser = await exchangeDiscordCode(q.code);
    } catch (err) {
      req.log.error({ err }, 'Discord OAuth token exchange failed');
      return redirectLoginError(reply, 'exchange_failed');
    }

    if (!cfg.allowedUserIds.includes(discordUser.id)) {
      req.log.warn(
        { discordId: discordUser.id, username: discordUser.username },
        'Discord login denied — user not allowlisted'
      );
      return redirectLoginError(reply, 'not_allowed');
    }

    let user = getUserByDiscordId(discordUser.id);
    if (!user) {
      const linkUsername = (process.env.DISCORD_LINK_USERNAME || '').trim();
      if (linkUsername) {
        const existing = getUserByUsername(linkUsername);
        if (existing && !existing.discordId) {
          user = linkDiscordId(existing.id, discordUser.id);
        }
      }
    }
    if (!user) {
      const username = ensureUniqueUsername(discordUser.username);
      user = createUser({
        username,
        passwordHash: DISCORD_PASSWORD_SENTINEL,
        role: cfg.defaultRole,
        mustChangePassword: false,
        discordId: discordUser.id,
      });
    }
    if (!user.enabled) {
      return redirectLoginError(reply, 'disabled');
    }

    const { token, expiresAt } = createUserSession(user, {
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || ''),
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.redirect('/');
  });

  app.post('/api/auth/login', async (req, reply) => {
    const ip = clientIp(req);
    const limit = checkLoginRateLimit(ip);
    if (!limit.ok) {
      reply.header('Retry-After', String(limit.retryAfterSec || 60));
      return reply.code(429).send({ error: 'Too many login attempts. Try again shortly.' });
    }

    const body = (req.body || {}) as { username?: string; password?: string };
    const username = (body.username || '').trim();
    const password = body.password || '';
    if (!username || !password) {
      noteLoginAttempt(ip);
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    const row = getUserByUsername(username);
    const ok = row && row.enabled ? await verifyPassword(password, row.passwordHash) : false;
    if (!ok || !row) {
      noteLoginAttempt(ip);
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    const { token, expiresAt } = createUserSession(row, {
      ip,
      userAgent: String(req.headers['user-agent'] || ''),
    });
    setSessionCookie(reply, token, expiresAt);
    return {
      ok: true,
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        mustChangePassword: row.mustChangePassword,
      },
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readSessionCookie(req.cookies as Record<string, string> | undefined);
    destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.auth?.user) return { authenticated: false, user: null };
    return {
      authenticated: true,
      user: {
        id: req.auth.user.id,
        username: req.auth.user.username,
        role: req.auth.user.role,
        mustChangePassword: req.auth.user.mustChangePassword,
        discordId: req.auth.user.discordId,
      },
      authType: req.auth.authType,
    };
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    if (req.auth!.authType !== 'session') {
      return reply.code(400).send({ error: 'Change password requires a browser session' });
    }
    const body = (req.body || {}) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword || body.newPassword.length < 8) {
      return reply.code(400).send({ error: 'New password must be at least 8 characters' });
    }
    const row = getUserByUsername(req.auth!.user.username);
    if (!row || !(await verifyPassword(body.currentPassword, row.passwordHash))) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }
    const hash = await hashPassword(body.newPassword);
    updateUser(row.id, { passwordHash: hash, mustChangePassword: false });
    revokeUserSessions(row.id);
    const { token, expiresAt } = createUserSession(
      { ...row, mustChangePassword: false },
      { ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '') }
    );
    setSessionCookie(reply, token, expiresAt);
    return { ok: true };
  });

  // ---- Users (admin) ----
  app.get('/api/users', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    return listUsers();
  });

  app.post('/api/users', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as {
      username?: string;
      password?: string;
      role?: UserRole;
    };
    const username = (body.username || '').trim();
    const password = body.password || '';
    const role: UserRole = body.role === 'admin' ? 'admin' : 'viewer';
    if (!username || username.length < 2) {
      return reply.code(400).send({ error: 'Username required (min 2 chars)' });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters' });
    }
    if (getUserByUsername(username)) {
      return reply.code(409).send({ error: 'Username already exists' });
    }
    const hash = await hashPassword(password);
    const user = createUser({ username, passwordHash: hash, role, mustChangePassword: false });
    return user;
  });

  app.put('/api/users/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as {
      role?: UserRole;
      enabled?: boolean;
      password?: string;
      mustChangePassword?: boolean;
    };
    const existing = getUserById(id);
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    // Prevent locking yourself out
    if (id === req.auth!.user.id && body.enabled === false) {
      return reply.code(400).send({ error: 'Cannot disable your own account' });
    }
    if (id === req.auth!.user.id && body.role === 'viewer') {
      return reply.code(400).send({ error: 'Cannot demote your own account' });
    }

    let passwordHash: string | undefined;
    if (body.password) {
      if (body.password.length < 8) {
        return reply.code(400).send({ error: 'Password must be at least 8 characters' });
      }
      passwordHash = await hashPassword(body.password);
    }

    const updated = updateUser(id, {
      role: body.role,
      enabled: body.enabled,
      passwordHash,
      mustChangePassword: body.mustChangePassword,
    });
    if (passwordHash) revokeUserSessions(id);
    return updated;
  });

  // ---- API keys (admin) ----
  app.get('/api/api-keys', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    return {
      keys: listActiveApiKeys(),
      scopes: ALL_SCOPES,
    };
  });

  app.post('/api/api-keys', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as {
      name?: string;
      scopes?: string[];
      expiresAt?: string | null;
    };
    const name = (body.name || '').trim();
    if (!name) return reply.code(400).send({ error: 'Name required' });
    const scopes = normalizeScopes(body.scopes || []);
    if (!scopes.length) {
      return reply.code(400).send({ error: 'At least one scope required' });
    }
    const { key, raw } = createKeyedApiKey({
      userId: req.auth!.user.id,
      name,
      scopes,
      expiresAt: body.expiresAt || null,
    });
    return { key, raw, warning: 'Copy this API key now. It will not be shown again.' };
  });

  app.delete('/api/api-keys/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { id } = req.params as { id: string };
    const ok = revokeKeyedApiKey(id);
    if (!ok) return reply.code(404).send({ error: 'API key not found' });
    return { ok: true };
  });
}
