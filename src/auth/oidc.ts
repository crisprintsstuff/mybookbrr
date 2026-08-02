/**
 * Authentik / generic OIDC for MyBookBRR (deeper SSO than Hub ticket).
 * Env: OIDC_ENABLED, OIDC_DISCOVERY_URL (or OIDC_ISSUER), OIDC_CLIENT_ID/SECRET,
 *      OIDC_REDIRECT_URI, OIDC_SCOPES, OIDC_DEFAULT_ROLE, OIDC_ADMIN_GROUPS,
 *      OIDC_LINK_USERNAME (optional first-login link to local user).
 */

const STATE_COOKIE = 'mbb_oidc_state';

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
};

let cached: { at: number; doc: OidcDiscovery } | null = null;

export function isOidcConfigured(): boolean {
  const enabled = String(process.env.OIDC_ENABLED || '').toLowerCase() === 'true';
  return (
    enabled &&
    Boolean(process.env.OIDC_CLIENT_ID?.trim()) &&
    Boolean(process.env.OIDC_CLIENT_SECRET?.trim()) &&
    Boolean(process.env.OIDC_REDIRECT_URI?.trim()) &&
    Boolean(
      process.env.OIDC_DISCOVERY_URL?.trim() || process.env.OIDC_ISSUER?.trim()
    )
  );
}

function discoveryUrl(): string {
  if (process.env.OIDC_DISCOVERY_URL?.trim()) return process.env.OIDC_DISCOVERY_URL.trim();
  const issuer = (process.env.OIDC_ISSUER || '').replace(/\/$/, '');
  return `${issuer}/.well-known/openid-configuration`;
}

export async function getOidcDiscovery(): Promise<OidcDiscovery> {
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.doc;
  const url = discoveryUrl();
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
  const doc = (await res.json()) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error('OIDC discovery incomplete');
  }
  cached = { at: Date.now(), doc };
  return doc;
}

export function createOidcState(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export function setOidcStateCookie(
  reply: { setCookie: (n: string, v: string, o: Record<string, unknown>) => void },
  state: string
): void {
  reply.setCookie(STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
    maxAge: 600,
  });
}

export function readOidcStateCookie(req: {
  cookies?: Record<string, string | undefined>;
}): string | null {
  const v = req.cookies?.[STATE_COOKIE];
  return v ? String(v) : null;
}

export function clearOidcStateCookie(reply: {
  clearCookie: (n: string, o?: Record<string, unknown>) => void;
}): void {
  reply.clearCookie(STATE_COOKIE, { path: '/' });
}

export function buildOidcAuthorizeUrl(discovery: OidcDiscovery, state: string): string {
  const u = new URL(discovery.authorization_endpoint);
  u.searchParams.set('client_id', process.env.OIDC_CLIENT_ID!.trim());
  u.searchParams.set('redirect_uri', process.env.OIDC_REDIRECT_URI!.trim());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set(
    'scope',
    (process.env.OIDC_SCOPES || 'openid profile email groups').trim()
  );
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeOidcCode(
  discovery: OidcDiscovery,
  code: string
): Promise<{ access_token: string; id_token?: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.OIDC_REDIRECT_URI!.trim(),
    client_id: process.env.OIDC_CLIENT_ID!.trim(),
    client_secret: process.env.OIDC_CLIENT_SECRET!.trim(),
  });
  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; id_token?: string };
  if (!json.access_token) throw new Error('Missing access_token');
  return { access_token: json.access_token, id_token: json.id_token };
}

export type OidcUserInfo = {
  sub: string;
  preferred_username?: string;
  nickname?: string;
  name?: string;
  email?: string;
  groups?: string[] | string;
};

export async function fetchOidcUserInfo(
  discovery: OidcDiscovery,
  accessToken: string
): Promise<OidcUserInfo> {
  if (!discovery.userinfo_endpoint) throw new Error('No userinfo_endpoint');
  const res = await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`UserInfo failed (${res.status})`);
  const info = (await res.json()) as OidcUserInfo;
  if (!info.sub) throw new Error('UserInfo missing sub');
  return info;
}

export function oidcGroups(info: OidcUserInfo): string[] {
  if (!info.groups) return [];
  if (Array.isArray(info.groups)) return info.groups.map(String);
  return String(info.groups)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Map groups / default to admin|viewer. */
export function roleFromOidc(info: OidcUserInfo): 'admin' | 'viewer' {
  const adminGroups = (process.env.OIDC_ADMIN_GROUPS || 'authentik Admins,boz-admins')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const groups = oidcGroups(info).map((g) => g.toLowerCase());
  if (adminGroups.some((g) => groups.includes(g))) return 'admin';
  const def = (process.env.OIDC_DEFAULT_ROLE || 'admin').toLowerCase();
  return def === 'viewer' ? 'viewer' : 'admin';
}

export function usernameFromOidc(info: OidcUserInfo): string {
  return (
    info.preferred_username ||
    info.nickname ||
    info.email?.split('@')[0] ||
    info.name ||
    `oidc_${info.sub.slice(0, 8)}`
  )
    .replace(/[^a-zA-Z0-9_\-.]/g, '')
    .slice(0, 24) || `oidc_${info.sub.slice(0, 8)}`;
}
