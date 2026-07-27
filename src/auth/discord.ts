import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import type { FastifyReply } from 'fastify';
import { cookieSecure } from './sessions.js';
import type { UserRole } from './types.js';

const STATE_COOKIE = 'mbb_oauth_state';
const PORTAL_AUTH_CONFIG = '/home/cris/discordbots/dashboard/auth_config.json';

export type DiscordOAuthConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedUserIds: string[];
  defaultRole: UserRole;
};

function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadPortalAuthFallback(): {
  clientId?: string;
  clientSecret?: string;
  allowedUserIds?: string[];
} {
  try {
    if (!fs.existsSync(PORTAL_AUTH_CONFIG)) return {};
    const cfg = JSON.parse(fs.readFileSync(PORTAL_AUTH_CONFIG, 'utf8')) as {
      client_id?: string;
      client_secret?: string;
      allowed_user_ids?: string[];
    };
    return {
      clientId: cfg.client_id || undefined,
      clientSecret: cfg.client_secret || undefined,
      allowedUserIds: Array.isArray(cfg.allowed_user_ids)
        ? cfg.allowed_user_ids.map(String)
        : undefined,
    };
  } catch {
    return {};
  }
}

export function getDiscordOAuthConfig(): DiscordOAuthConfig {
  const portal = loadPortalAuthFallback();
  const clientId = (process.env.DISCORD_CLIENT_ID || portal.clientId || '').trim();
  const clientSecret = (process.env.DISCORD_CLIENT_SECRET || portal.clientSecret || '').trim();
  const redirectUri = (
    process.env.DISCORD_REDIRECT_URI ||
    'https://mybookbrr.boznetwork.com/api/auth/discord/callback'
  ).trim();
  const allowedUserIds =
    parseIdList(process.env.DISCORD_ALLOWED_USER_IDS).length > 0
      ? parseIdList(process.env.DISCORD_ALLOWED_USER_IDS)
      : portal.allowedUserIds || [];
  const defaultRole: UserRole =
    process.env.DISCORD_DEFAULT_ROLE === 'viewer' ? 'viewer' : 'admin';
  const enabled =
    process.env.DISCORD_OAUTH_ENABLED !== 'false' &&
    Boolean(clientId && clientSecret && redirectUri && allowedUserIds.length);

  return {
    enabled,
    clientId,
    clientSecret,
    redirectUri,
    allowedUserIds,
    defaultRole,
  };
}

export function isDiscordOAuthConfigured(): boolean {
  return getDiscordOAuthConfig().enabled;
}

export function buildDiscordAuthorizeUrl(state: string): string {
  const cfg = getDiscordOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export function createOAuthState(): string {
  return randomBytes(24).toString('hex');
}

export function setOAuthStateCookie(reply: FastifyReply, state: string): void {
  reply.setCookie(STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    maxAge: 10 * 60,
  });
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  reply.clearCookie(STATE_COOKIE, { path: '/' });
}

export function readOAuthStateCookie(
  cookies: Record<string, string> | undefined
): string | undefined {
  return cookies?.[STATE_COOKIE];
}

export async function exchangeDiscordCode(code: string): Promise<{
  id: string;
  username: string;
  globalName: string;
}> {
  const cfg = getDiscordOAuthConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
  });

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Discord token exchange failed (${tokenRes.status}): ${text.slice(0, 160)}`);
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error('Discord token response missing access_token');

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) {
    const text = await userRes.text();
    throw new Error(`Discord user fetch failed (${userRes.status}): ${text.slice(0, 160)}`);
  }
  const user = (await userRes.json()) as {
    id?: string;
    username?: string;
    global_name?: string | null;
  };
  if (!user.id) throw new Error('Discord user missing id');
  return {
    id: String(user.id),
    username: String(user.username || `discord_${user.id}`),
    globalName: String(user.global_name || user.username || `discord_${user.id}`),
  };
}

export { STATE_COOKIE };
