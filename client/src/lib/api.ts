export type Page =
  | 'dashboard'
  | 'live'
  | 'filters'
  | 'wishlist'
  | 'search'
  | 'history'
  | 'settings'
  | 'users'
  | 'api-keys';

export type AuthUser = {
  id: string;
  username: string;
  role: 'admin' | 'viewer';
  enabled?: boolean;
  mustChangePassword?: boolean;
};

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers || {});
  // Fastify rejects Content-Type: application/json with an empty body (Start IRC, etc.).
  if (opts.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, {
    credentials: 'include',
    ...opts,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText, message: res.statusText }));
    throw new Error(
      (err as { error?: string; message?: string }).message ||
        (err as { error?: string }).error ||
        res.statusText
    );
  }
  return res.json() as Promise<T>;
}

/** BozNetwork Hub (control plane) — override with VITE_HUB_URL at build time if needed */
export const HUB_URL =
  (import.meta.env.VITE_HUB_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://portal.boznetwork.com';

export function formatResetsInClient(resetsAt: string | null | undefined): string {
  if (!resetsAt) return '';
  const ms = Math.max(0, new Date(resetsAt).getTime() - Date.now());
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 48) return `~${Math.floor(hours / 24)}d`;
  if (hours > 0) return `~${hours}h ${mins}m`;
  return `~${mins}m`;
}
