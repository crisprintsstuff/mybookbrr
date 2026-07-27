import { useCallback, useEffect, useMemo, useState } from 'react';

type Page =
  | 'dashboard'
  | 'live'
  | 'filters'
  | 'wishlist'
  | 'search'
  | 'history'
  | 'settings'
  | 'users'
  | 'api-keys';

type AuthUser = {
  id: string;
  username: string;
  role: 'admin' | 'viewer';
  enabled?: boolean;
  mustChangePassword?: boolean;
};

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
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

function Login({ onDone }: { onDone: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const discordError = params.get('discord_error');
    if (discordError) {
      const messages: Record<string, string> = {
        denied: 'Discord authorization was cancelled.',
        missing_code: 'Discord login incomplete. Try again.',
        invalid_state: 'Discord login expired. Try again.',
        exchange_failed: 'Discord token exchange failed.',
        not_allowed: 'Your Discord account is not allowlisted.',
        disabled: 'Your account is disabled.',
        not_configured: 'Discord login is not configured.',
      };
      setError(messages[discordError] || `Discord login failed (${discordError})`);
      window.history.replaceState({}, '', window.location.pathname);
    }
    void api<{ discord: boolean }>('/api/auth/providers')
      .then((r) => setDiscordEnabled(Boolean(r.discord)))
      .catch(() => setDiscordEnabled(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ ok: boolean; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onDone(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>
          MyBook<span style={{ color: 'var(--accent)' }}>BRR</span>
        </h1>
        <p>MAM auto-snatch & wishlist downloader</p>
        {discordEnabled && (
          <>
            <a className="btn btn-discord" href="/api/auth/discord">
              Continue with Discord
            </a>
            <div className="login-divider">
              <span>or</span>
            </div>
          </>
        )}
        <div className="field">
          <label>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus={!discordEnabled}
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button className="btn" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}

function ChangePasswordGate({ user, onDone }: { user: AuthUser; onDone: (user: AuthUser) => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onDone({ ...user, mustChangePassword: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Change password</h1>
        <p>Your account requires a new password before continuing.</p>
        <div className="field">
          <label>Current password</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label>New password (min 8)</label>
          <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
        </div>
        <button className="btn" disabled={busy || newPassword.length < 8}>
          {busy ? 'Saving…' : 'Update password'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}

function UsersPage() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);

  const load = () => api<AuthUser[]>('/api/users').then(setUsers);
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setMsg('');
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, role }),
      });
      setUsername('');
      setPassword('');
      setRole('viewer');
      setMsgOk(true);
      setMsg('User created');
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <>
      <h2 className="page-title">Users</h2>
      <p className="page-sub">Admin and viewer accounts for the web UI</p>
      <div className="grid two">
        <div className="card">
          <h3>Create user</h3>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button className="btn" onClick={() => void create()}>
            Create
          </button>
          {msg && <div className={msgOk ? 'okmsg' : 'error'}>{msg}</div>}
        </div>
        <div className="card">
          <h3>Accounts</h3>
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={(e) => void patch(u.id, { role: e.target.value })}
                    >
                      <option value="viewer">viewer</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${u.enabled !== false ? 'ok' : 'warn'}`}>
                      {u.enabled === false ? 'disabled' : 'enabled'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn secondary"
                      onClick={() => void patch(u.id, { enabled: u.enabled === false })}
                    >
                      {u.enabled === false ? 'Enable' : 'Disable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const SCOPE_OPTIONS = [
  'status:read',
  'filters:read',
  'filters:write',
  'wishlist:read',
  'wishlist:write',
  'history:read',
  'events:read',
  'irc:control',
  'snatch:write',
] as const;

function ApiKeysPage() {
  const [keys, setKeys] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['status:read', 'events:read', 'history:read']);
  const [rawKey, setRawKey] = useState('');
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);

  const load = () =>
    api<{ keys: any[] }>('/api/api-keys').then((r) => setKeys(r.keys));
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setMsg('');
    setRawKey('');
    try {
      const r = await api<{ key: any; raw: string; warning: string }>('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name, scopes }),
      });
      setRawKey(r.raw);
      setName('');
      setMsgOk(true);
      setMsg(r.warning);
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <>
      <h2 className="page-title">API keys</h2>
      <p className="page-sub">Scoped keys for Discord bots and home monitors (`/api/v1`)</p>
      <div className="grid two">
        <div className="card">
          <h3>Create key</h3>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="home-monitor" />
          </div>
          <div className="field">
            <label>Scopes</label>
            <div className="check-grid">
              {SCOPE_OPTIONS.map((s) => (
                <label key={s}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={(e) =>
                      setScopes((prev) =>
                        e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)
                      )
                    }
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <button className="btn" onClick={() => void create()} disabled={!name || !scopes.length}>
            Create key
          </button>
          {rawKey && (
            <div className="card" style={{ marginTop: '0.75rem' }}>
              <p className="detail">Copy now — shown once:</p>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{rawKey}</pre>
              <button className="btn secondary" onClick={() => void navigator.clipboard.writeText(rawKey)}>
                Copy
              </button>
            </div>
          )}
          {msg && <div className={msgOk ? 'okmsg' : 'error'}>{msg}</div>}
        </div>
        <div className="card">
          <h3>Active keys</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <code>{k.keyPrefix}…</code>
                  </td>
                  <td className="detail">{(k.scopes || []).join(', ')}</td>
                  <td>
                    <button
                      className="btn danger"
                      onClick={() =>
                        void api(`/api/api-keys/${k.id}`, { method: 'DELETE' }).then(load)
                      }
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<any>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionOk, setActionOk] = useState(true);
  const [busy, setBusy] = useState<'irc-start' | 'irc-stop' | 'wishlist' | null>(null);

  const load = useCallback(async () => {
    setStatus(await api('/api/status'));
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function runAction(kind: 'irc-start' | 'irc-stop' | 'wishlist', path: string) {
    setBusy(kind);
    setActionMsg('');
    try {
      await api(path, { method: 'POST', body: '{}' });
      await load();
      setActionOk(true);
      setActionMsg(
        kind === 'irc-start' ? 'IRC starting…' : kind === 'irc-stop' ? 'IRC stopped' : 'Wishlist poll started'
      );
    } catch (err) {
      setActionOk(false);
      setActionMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (!status) return <p className="page-sub">Loading…</p>;

  return (
    <>
      <h2 className="page-title">Dashboard</h2>
      <p className="page-sub">IRC announce + wishlist poll status</p>
      {status.unsatisfied?.active && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--danger)' }}>
          <h3 style={{ color: 'var(--danger)' }}>Filters paused — unsatisfied limit</h3>
          <p className="detail">{status.unsatisfied.message}</p>
          <p className="detail">Open Filters to clear the lockout and re-enable rules after seeding.</p>
        </div>
      )}
      <div className="grid stats">
        <div className="card">
          <h3>Snatches</h3>
          <div className="stat-value">{status.snatchCount}</div>
          <div className="stat-label">successful downloads</div>
        </div>
        <div className="card">
          <h3>IRC</h3>
          <div className="stat-value">
            <span className={`badge ${status.irc?.joined ? 'ok' : status.irc?.connected ? 'warn' : 'err'}`}>
              {status.irc?.phase || (status.irc?.connected ? 'connected' : 'offline')}
            </span>
          </div>
          <div className="stat-label">
            {status.irc?.nick} @ {status.irc?.host}:{status.irc?.port}
            <br />
            identified: {status.irc?.identified ? 'yes' : 'no'} · joined: {status.irc?.joined ? 'yes' : 'no'}
            {status.irc?.lastError ? (
              <>
                <br />
                error: {status.irc.lastError}
              </>
            ) : null}
          </div>
        </div>
        <div className="card">
          <h3>Wishlist</h3>
          <div className="stat-value">
            <span className={`badge ${status.wishlist?.enabled ? 'ok' : 'warn'}`}>
              {status.wishlist?.running ? 'polling' : status.wishlist?.enabled ? 'idle' : 'off'}
            </span>
          </div>
          <div className="stat-label">{status.wishlist?.lastPollResult || 'no polls yet'}</div>
        </div>
        <div className="card">
          <h3>MAM</h3>
          <div className="stat-value">
            <span className={`badge ${status.mamConfigured ? 'ok' : 'err'}`}>
              {status.mamConfigured ? 'configured' : 'missing mam_id'}
            </span>
          </div>
          <div className="stat-label">session cookie</div>
        </div>
      </div>
      {status.lastAnnounce && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>Last announce</h3>
          <div className="title">
            {status.lastAnnounce.author} — {status.lastAnnounce.title}
          </div>
          <div className="detail">
            tid {status.lastAnnounce.torrentId} · {status.lastAnnounce.at}
          </div>
        </div>
      )}
      {Array.isArray(status.irc?.recentLines) && status.irc.recentLines.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3>IRC log (redacted)</h3>
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--mono)',
              fontSize: '0.75rem',
              whiteSpace: 'pre-wrap',
              maxHeight: 240,
              overflow: 'auto',
              color: 'var(--muted)',
            }}
          >
            {status.irc.recentLines.slice(-25).join('\n')}
          </pre>
        </div>
      )}
      {isAdmin && (
        <div className="row" style={{ marginTop: '1rem' }}>
          <button
            className="btn secondary"
            disabled={busy !== null || status.irc?.joined}
            onClick={() => void runAction('irc-start', '/api/irc/start')}
          >
            {busy === 'irc-start' ? 'Starting…' : 'Start IRC'}
          </button>
          <button
            className="btn secondary"
            disabled={busy !== null}
            onClick={() => void runAction('irc-stop', '/api/irc/stop')}
          >
            {busy === 'irc-stop' ? 'Stopping…' : 'Stop IRC'}
          </button>
          <button
            className="btn secondary"
            disabled={busy !== null}
            onClick={() => void runAction('wishlist', '/api/wishlist/poll')}
          >
            {busy === 'wishlist' ? 'Polling…' : 'Poll wishlist now'}
          </button>
          {actionMsg && <div className={actionOk ? 'okmsg' : 'error'}>{actionMsg}</div>}
        </div>
      )}
    </>
  );
}

function LiveFeed({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Array<{ type: string; payload: any; createdAt?: string }>>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionOk, setActionOk] = useState(true);

  useEffect(() => {
    void api<any[]>('/api/events').then((evts) => setItems(evts.reverse()));
    const es = new EventSource('/api/events/stream', { withCredentials: true } as any);
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'connected') return;
        setItems((prev) => [...prev.slice(-200), data]);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  async function sendToQbit(release: any, key: string) {
    if (!release?.torrentId) return;
    setBusyKey(key);
    setActionMsg('');
    try {
      const out = await api<{ snatched: boolean; skipped: boolean; reason: string }>('/api/snatch', {
        method: 'POST',
        body: JSON.stringify({
          torrentId: release.torrentId,
          title: release.title,
          author: release.author,
          series: release.series,
          narrator: release.narrator,
          mediaType: release.mediaType,
          format: release.format,
          sizeMB: release.sizeMB,
          sizeStr: release.sizeStr,
          freeleech: release.freeleech,
          vip: release.vip,
          bitrate: release.bitrate,
          torrentUrl: release.torrentUrl,
          year: release.year,
          category: release.category,
          force: true,
        }),
      });
      setActionOk(out.snatched);
      setActionMsg(
        out.snatched
          ? `Sent to download client: ${out.reason}`
          : out.skipped
            ? `Skipped: ${out.reason}`
            : `Failed: ${out.reason}`
      );
    } catch (err) {
      setActionOk(false);
      setActionMsg(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      <h2 className="page-title">Live feed</h2>
      <p className="page-sub">SSE stream of announces, matches, rejects, and snatches</p>
      {actionMsg && <div className={actionOk ? 'okmsg' : 'error'} style={{ marginBottom: '0.75rem' }}>{actionMsg}</div>}
      <div className="feed">
        {items.length === 0 && <div className="card">Waiting for events…</div>}
        {[...items].reverse().map((item, i) => {
          const r = item.payload?.release;
          const key = `${item.type}-${item.createdAt || ''}-${r?.torrentId || i}-${i}`;
          const open = openKey === key;
          return (
            <div className="feed-item" key={key}>
              <div className="meta">
                <span className={`badge ${item.type === 'snatch' ? 'ok' : item.type === 'error' || item.type === 'reject' ? 'warn' : ''}`}>
                  {item.type}
                </span>{' '}
                {item.createdAt || ''}
              </div>
              <div className="title">
                {r ? `${r.author} — ${r.title}` : JSON.stringify(item.payload).slice(0, 120)}
              </div>
              {r && (
                <div className="detail">
                  {r.mediaType}/{r.format} · {r.source} · tid {r.torrentId}
                  {item.payload?.reason || item.payload?.reasons ? (
                    <> · {item.payload.reason || (item.payload.reasons || []).join('; ')}</>
                  ) : null}
                  {item.payload?.clientMessage ? <> · {item.payload.clientMessage}</> : null}
                  {item.payload?.error ? <> · {item.payload.error}</> : null}
                </div>
              )}
              {r && (
                <div className="row" style={{ marginTop: '0.45rem' }}>
                  <button
                    className="btn secondary"
                    onClick={() => setOpenKey(open ? null : key)}
                  >
                    {open ? 'Hide details' : 'Details'}
                  </button>
                  {isAdmin && (
                    <button
                      className="btn"
                      disabled={busyKey === key || !r.torrentId}
                      onClick={() => void sendToQbit(r, key)}
                    >
                      {busyKey === key ? 'Sending…' : 'Send to qBittorrent'}
                    </button>
                  )}
                  {r.torrentUrl ? (
                    <a className="btn secondary" href={r.torrentUrl} target="_blank" rel="noreferrer">
                      Open on MAM
                    </a>
                  ) : null}
                </div>
              )}
              {r && open && (
                <div className="feed-details">
                  <div className="feed-details-grid">
                    <div><span>Author</span>{r.author || '—'}</div>
                    <div><span>Series</span>{r.series || '—'}</div>
                    <div><span>Narrator</span>{r.narrator || '—'}</div>
                    <div><span>Media</span>{r.mediaType || '—'}</div>
                    <div><span>Format</span>{r.format || '—'}</div>
                    <div><span>Size</span>{r.sizeStr || (r.sizeMB ? `${r.sizeMB} MB` : '—')}</div>
                    <div><span>Bitrate</span>{r.bitrate ? `${r.bitrate} kbps` : '—'}</div>
                    <div><span>Year</span>{r.year || '—'}</div>
                    <div><span>Category</span>{r.category || '—'}</div>
                    <div><span>Source</span>{r.source || '—'}</div>
                    <div><span>Torrent ID</span>{r.torrentId || '—'}</div>
                    <div>
                      <span>Flags</span>
                      {[r.freeleech ? 'Freeleech' : null, r.vip ? 'VIP' : null].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {item.payload?.reasons?.length ? (
                    <div className="feed-details-block">
                      <span>Filter notes</span>
                      <div>{(item.payload.reasons || []).join('; ')}</div>
                    </div>
                  ) : null}
                  {item.payload?.evaluationLog?.length ? (
                    <div className="feed-details-block">
                      <span>Evaluation</span>
                      <pre>
                        {item.payload.evaluationLog
                          .map((e: any) => `${e.filterName}: ${(e.failures || []).join('; ') || 'ok'}`)
                          .join('\n')}
                      </pre>
                    </div>
                  ) : null}
                  {item.payload?.error ? (
                    <div className="feed-details-block">
                      <span>Error</span>
                      <div className="error">{item.payload.error}</div>
                    </div>
                  ) : null}
                  {r.raw ? (
                    <div className="feed-details-block">
                      <span>Raw announce</span>
                      <pre>{r.raw}</pre>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

const MAM_EBOOK_FORMATS = ['EPUB', 'AZW3', 'MOBI', 'PDF', 'CBR', 'CBZ'] as const;
const MAM_AUDIO_FORMATS = ['M4B', 'MP3', 'FLAC', 'AAC', 'M4A', 'OGG', 'WMA'] as const;
const MAM_FORMATS = [...MAM_EBOOK_FORMATS, ...MAM_AUDIO_FORMATS] as const;

const emptyFilter = {
  name: '',
  enabled: true,
  priority: 5,
  matchAllReleases: false,
  limitPeriod: 'unlimited' as const,
  maxDownloads: 0,
  mediaTypes: ['eBook', 'Audiobook'] as string[],
  formats: ['EPUB', 'M4B'] as string[],
  authors: [] as string[],
  excludeAuthors: [] as string[],
  narrators: [] as string[],
  series: [] as string[],
  titlePattern: '',
  minBitrate: 0,
  minSizeMB: 0,
  maxSizeMB: 50000,
  freeleechOnly: false,
  vipOnly: false,
  clientType: 'qbittorrent' as const,
  clientCategory: 'books',
  savePath: '',
  discordWebhookUrl: '',
};

function normalizeFormats(formats: unknown): string[] {
  if (Array.isArray(formats)) return formats.map(String);
  if (typeof formats === 'string') {
    return formats
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function toggleFormat(current: string[], format: string, checked: boolean): string[] {
  const withoutAll = current.filter((f) => f.toUpperCase() !== 'ALL');
  if (format.toUpperCase() === 'ALL') {
    return checked ? ['All'] : [];
  }
  const next = checked
    ? Array.from(new Set([...withoutAll, format]))
    : withoutAll.filter((f) => f.toUpperCase() !== format.toUpperCase());
  return next;
}

function FormatCheckboxes({
  formats,
  onChange,
}: {
  formats: string[];
  onChange: (formats: string[]) => void;
}) {
  const allSelected = formats.some((f) => f.toUpperCase() === 'ALL');
  const selected = new Set(formats.map((f) => f.toUpperCase()));

  return (
    <div className="field">
      <label>Formats</label>
      <div className="check-grid">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onChange(toggleFormat(formats, 'All', e.target.checked))}
          />
          All formats
        </label>
      </div>
      <div className="check-group-label">eBooks</div>
      <div className="check-grid">
        {MAM_EBOOK_FORMATS.map((fmt) => (
          <label key={fmt}>
            <input
              type="checkbox"
              disabled={allSelected}
              checked={!allSelected && selected.has(fmt)}
              onChange={(e) => onChange(toggleFormat(formats, fmt, e.target.checked))}
            />
            {fmt}
          </label>
        ))}
      </div>
      <div className="check-group-label">Audiobooks</div>
      <div className="check-grid">
        {MAM_AUDIO_FORMATS.map((fmt) => (
          <label key={fmt}>
            <input
              type="checkbox"
              disabled={allSelected}
              checked={!allSelected && selected.has(fmt)}
              onChange={(e) => onChange(toggleFormat(formats, fmt, e.target.checked))}
            />
            {fmt}
          </label>
        ))}
      </div>
      <p className="detail">
        Use <strong>All formats</strong> with Catch-all to snatch every announce. Otherwise pick specific MAM
        types ({MAM_FORMATS.length} listed).
      </p>
    </div>
  );
}

function FiltersPage({ isAdmin }: { isAdmin: boolean }) {
  const [filters, setFilters] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>({ ...emptyFilter });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [testingHook, setTestingHook] = useState(false);
  const [unsatisfied, setUnsatisfied] = useState<any>(null);
  const [autoDisable, setAutoDisable] = useState(true);

  const load = async () => {
    const [list, guard, settings] = await Promise.all([
      api<any[]>('/api/filters'),
      api<any>('/api/filters/unsatisfied'),
      api<any>('/api/settings'),
    ]);
    setFilters(list);
    setUnsatisfied(guard);
    setAutoDisable(settings.filters_auto_disable_on_unsatisfied !== 'false');
  };
  useEffect(() => {
    void load();
  }, []);

  async function testFilterDiscord(opts?: { url?: string; filterId?: string; filterName?: string }) {
    setTestingHook(true);
    setMsg('');
    try {
      const r = await api<{ ok: boolean; message: string }>('/api/filters/test-discord', {
        method: 'POST',
        body: JSON.stringify({
          url: opts?.url,
          filterId: opts?.filterId,
          filterName: opts?.filterName,
        }),
      });
      setMsgOk(r.ok);
      setMsg(r.message);
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Discord test failed');
    } finally {
      setTestingHook(false);
    }
  }

  async function save() {
    setMsg('');
    try {
      const formats = normalizeFormats(draft.formats);
      if (!formats.length) {
        setMsgOk(false);
        setMsg('Pick at least one format, or All formats');
        return;
      }
      const payload = {
        ...draft,
        authors: typeof draft.authors === 'string' ? draft.authors.split(',').map((s: string) => s.trim()).filter(Boolean) : draft.authors,
        excludeAuthors:
          typeof draft.excludeAuthors === 'string'
            ? draft.excludeAuthors.split(',').map((s: string) => s.trim()).filter(Boolean)
            : draft.excludeAuthors,
        narrators:
          typeof draft.narrators === 'string'
            ? draft.narrators.split(',').map((s: string) => s.trim()).filter(Boolean)
            : draft.narrators,
        series:
          typeof draft.series === 'string' ? draft.series.split(',').map((s: string) => s.trim()).filter(Boolean) : draft.series,
        formats,
        mediaTypes: Array.isArray(draft.mediaTypes) ? draft.mediaTypes : ['eBook', 'Audiobook'],
      };
      if (editingId) {
        await api(`/api/filters/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/filters', { method: 'POST', body: JSON.stringify(payload) });
      }
      setDraft({ ...emptyFilter });
      setEditingId(null);
      setMsgOk(true);
      setMsg('Saved');
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function saveAutoDisable(next: boolean) {
    setAutoDisable(next);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ filters_auto_disable_on_unsatisfied: next ? 'true' : 'false' }),
      });
      setMsgOk(true);
      setMsg(next
        ? 'Filters will auto-disable when MAM unsatisfied limit is hit'
        : 'Auto-disable on unsatisfied limit is off');
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Failed to save setting');
    }
  }

  async function clearUnsatisfied(reenableFilters: boolean) {
    try {
      const r = await api<{ ok: boolean; reenabled: number }>('/api/filters/unsatisfied/clear', {
        method: 'POST',
        body: JSON.stringify({ reenableFilters }),
      });
      setMsgOk(true);
      setMsg(
        reenableFilters
          ? `Lockout cleared — re-enabled ${r.reenabled} filter(s)`
          : 'Lockout cleared — filters left disabled (turn on manually)'
      );
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Failed to clear lockout');
    }
  }

  return (
    <>
      <h2 className="page-title">Filters</h2>
      <p className="page-sub">Autobrr-style snatch rules evaluated against IRC and wishlist releases</p>
      {unsatisfied?.active && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--danger)' }}>
          <h3 style={{ color: 'var(--danger)' }}>Unsatisfied torrent limit</h3>
          <p className="detail">{unsatisfied.message}</p>
          {unsatisfied.at && <p className="detail">Detected at {unsatisfied.at}</p>}
          {isAdmin && (
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button className="btn" onClick={() => void clearUnsatisfied(true)}>
                Clear & re-enable filters
              </button>
              <button className="btn secondary" onClick={() => void clearUnsatisfied(false)}>
                Clear lockout only
              </button>
            </div>
          )}
        </div>
      )}
      {isAdmin && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={autoDisable}
              onChange={(e) => void saveAutoDisable(e.target.checked)}
            />{' '}
            Auto-disable all enabled filters when MAM unsatisfied torrent limit is hit
          </label>
          <p className="detail">
            Prevents repeated download failures / flood while you seed to clear the limit. Filters stay off until you
            re-enable them (or use Clear &amp; re-enable).
          </p>
        </div>
      )}
      <div className="grid two">
        {isAdmin && (
        <div className="card">
          <h3>{editingId ? 'Edit rule' : 'New rule'}</h3>
          <div className="field">
            <label>Name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="row">
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />{' '}
              Enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.matchAllReleases}
                onChange={(e) => {
                  const matchAllReleases = e.target.checked;
                  setDraft({
                    ...draft,
                    matchAllReleases,
                    // Catch-all commonly wants every format unless narrowed intentionally.
                    formats: matchAllReleases && !normalizeFormats(draft.formats).length
                      ? ['All']
                      : draft.formats,
                  });
                }}
              />{' '}
              Catch-all
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.freeleechOnly}
                onChange={(e) => setDraft({ ...draft, freeleechOnly: e.target.checked })}
              />{' '}
              Freeleech only
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.vipOnly}
                onChange={(e) => setDraft({ ...draft, vipOnly: e.target.checked })}
              />{' '}
              VIP only
            </label>
          </div>
          <div className="field">
            <label>Priority</label>
            <input
              type="number"
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Download limit period</label>
            <select
              value={draft.limitPeriod || 'unlimited'}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  limitPeriod: e.target.value as 'unlimited' | 'daily' | 'weekly' | 'monthly',
                })
              }
            >
              <option value="unlimited">Unlimited</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {draft.limitPeriod && draft.limitPeriod !== 'unlimited' && (
            <div className="field">
              <label>Max downloads per {draft.limitPeriod.replace(/ly$/, '')}</label>
              <input
                type="number"
                min={1}
                value={draft.maxDownloads || 1}
                onChange={(e) => setDraft({ ...draft, maxDownloads: Math.max(1, Number(e.target.value) || 1) })}
              />
              <p className="detail">
                Stops snatching for this filter once the cap is hit in the current window. Set period to Unlimited
                to disable.
              </p>
            </div>
          )}
          <div className="field">
            <label>Authors (comma-separated)</label>
            <input
              value={Array.isArray(draft.authors) ? draft.authors.join(', ') : draft.authors}
              onChange={(e) => setDraft({ ...draft, authors: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Series</label>
            <input
              value={Array.isArray(draft.series) ? draft.series.join(', ') : draft.series}
              onChange={(e) => setDraft({ ...draft, series: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Media types</label>
            <div className="check-grid">
              {(['eBook', 'Audiobook'] as const).map((mt) => {
                const selected = Array.isArray(draft.mediaTypes) ? draft.mediaTypes : [];
                return (
                  <label key={mt}>
                    <input
                      type="checkbox"
                      checked={selected.includes(mt)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? Array.from(new Set([...selected, mt]))
                          : selected.filter((x: string) => x !== mt);
                        setDraft({ ...draft, mediaTypes: next });
                      }}
                    />
                    {mt}
                  </label>
                );
              })}
            </div>
          </div>
          <FormatCheckboxes
            formats={normalizeFormats(draft.formats)}
            onChange={(formats) => setDraft({ ...draft, formats })}
          />
          <div className="field">
            <label>Title regex</label>
            <input
              value={draft.titlePattern}
              onChange={(e) => setDraft({ ...draft, titlePattern: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Client category</label>
            <input
              value={draft.clientCategory}
              onChange={(e) => setDraft({ ...draft, clientCategory: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Save path</label>
            <input value={draft.savePath} onChange={(e) => setDraft({ ...draft, savePath: e.target.value })} />
          </div>
          <div className="field">
            <label>Discord snatch webhook (optional)</label>
            <input
              type="url"
              placeholder="https://discord.com/api/webhooks/…"
              value={draft.discordWebhookUrl || ''}
              onChange={(e) => setDraft({ ...draft, discordWebhookUrl: e.target.value })}
            />
            <div className="row" style={{ marginTop: '0.4rem' }}>
              <button
                className="btn secondary"
                disabled={testingHook}
                onClick={() =>
                  void testFilterDiscord({
                    url: draft.discordWebhookUrl || undefined,
                    filterId: editingId || undefined,
                    filterName: draft.name || 'Filter test',
                  })
                }
              >
                {testingHook ? 'Testing…' : 'Test webhook'}
              </button>
            </div>
            <p className="detail">
              Overrides the global snatch webhook for successes from this filter only. Errors still use the global
              errors webhook. Paste a URL (or Save first) then Test.
            </p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void save()}>
              Save
            </button>
            {editingId && (
              <button
                className="btn secondary"
                onClick={() => {
                  setEditingId(null);
                  setDraft({ ...emptyFilter });
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {msg && <div className={msgOk ? 'okmsg' : 'error'}>{msg}</div>}
        </div>
        )}
        <div className="card">
          <h3>Active rules</h3>
          <table className="table">
            <thead>
              <tr>
                <th>On</th>
                <th>Name</th>
                <th>Pri</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {filters.map((f) => (
                <tr key={f.id}>
                  <td>
                    <label title={f.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}>
                      <input
                        type="checkbox"
                        checked={Boolean(f.enabled)}
                        disabled={!isAdmin}
                        onChange={() => {
                          if (!isAdmin) return;
                          void api(`/api/filters/${f.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ enabled: !f.enabled }),
                          })
                            .then(load)
                            .catch((err) => {
                              setMsgOk(false);
                              setMsg(err instanceof Error ? err.message : 'Toggle failed');
                            });
                        }}
                      />
                    </label>
                  </td>
                  <td>
                    {f.name}
                    <div className="detail">
                      {(f.formats || []).join(', ') || 'formats?'}
                      {' · '}
                      {(f.authors || []).join(', ') || (f.matchAllReleases ? 'catch-all' : '—')}
                      {' · '}
                      {f.limitPeriod && f.limitPeriod !== 'unlimited'
                        ? `limit ${f.maxDownloads || 0}/${f.limitPeriod}`
                        : 'no limit'}
                    </div>
                  </td>
                  <td>{f.priority}</td>
                  {isAdmin && (
                    <td>
                      <div className="row">
                        <button
                          className="btn secondary"
                          onClick={() => {
                            setEditingId(f.id);
                            setDraft({
                              ...f,
                              authors: f.authors || [],
                              series: f.series || [],
                              mediaTypes: f.mediaTypes || ['eBook', 'Audiobook'],
                              formats: normalizeFormats(f.formats),
                            });
                          }}
                        >
                          Edit
                        </button>
                        {f.discordWebhookUrl ? (
                          <button
                            className="btn secondary"
                            disabled={testingHook}
                            onClick={() =>
                              void testFilterDiscord({ filterId: f.id, filterName: f.name })
                            }
                          >
                            Test
                          </button>
                        ) : null}
                        <button
                          className="btn danger"
                          onClick={() => api(`/api/filters/${f.id}`, { method: 'DELETE' }).then(load)}
                        >
                          Del
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function WishlistPage({ isAdmin }: { isAdmin: boolean }) {
  const [watches, setWatches] = useState<any[]>([]);
  const [draft, setDraft] = useState({
    name: '',
    enabled: true,
    query: '',
    author: '',
    series: '',
    narrator: '',
    mediaTypes: ['eBook', 'Audiobook'],
    formats: [] as string[],
    intervalMinutes: 30,
  });
  const [msg, setMsg] = useState('');

  const load = () => api<any[]>('/api/wishlist').then(setWatches);
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    await api('/api/wishlist', {
      method: 'POST',
      body: JSON.stringify({
        ...draft,
        formats:
          typeof (draft as any).formats === 'string'
            ? String((draft as any).formats)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : draft.formats,
      }),
    });
    setDraft({
      name: '',
      enabled: true,
      query: '',
      author: '',
      series: '',
      narrator: '',
      mediaTypes: ['eBook', 'Audiobook'],
      formats: [],
      intervalMinutes: 30,
    });
    setMsg('Watch saved');
    await load();
  }

  return (
    <>
      <h2 className="page-title">Wishlist</h2>
      <p className="page-sub">Periodic MAM search watches for authors, series, and titles</p>
      <div className="grid two">
        {isAdmin && (
          <div className="card">
            <h3>New watch</h3>
            <div className="field">
              <label>Name</label>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Query</label>
              <input value={draft.query} onChange={(e) => setDraft({ ...draft, query: e.target.value })} />
            </div>
            <div className="field">
              <label>Author</label>
              <input value={draft.author} onChange={(e) => setDraft({ ...draft, author: e.target.value })} />
            </div>
            <div className="field">
              <label>Series</label>
              <input value={draft.series} onChange={(e) => setDraft({ ...draft, series: e.target.value })} />
            </div>
            <div className="field">
              <label>Narrator</label>
              <input value={draft.narrator} onChange={(e) => setDraft({ ...draft, narrator: e.target.value })} />
            </div>
            <div className="field">
              <label>Interval (minutes)</label>
              <input
                type="number"
                value={draft.intervalMinutes}
                onChange={(e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })}
              />
            </div>
            <button className="btn" onClick={() => void save()}>
              Save watch
            </button>
            {msg && <div className="okmsg">{msg}</div>}
          </div>
        )}
        <div className="card">
          <h3>Watches</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Last run</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {watches.map((w) => (
                <tr key={w.id}>
                  <td>
                    {w.name}
                    <div className="detail">
                      {[w.query, w.author, w.series].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </td>
                  <td>
                    <div>{w.lastRunAt || 'never'}</div>
                    <div className="detail">{w.lastResult}</div>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="row">
                        <button
                          className="btn secondary"
                          onClick={() =>
                            api(`/api/wishlist/${w.id}/run`, { method: 'POST', body: '{}' }).then(load)
                          }
                        >
                          Run
                        </button>
                        <button
                          className="btn danger"
                          onClick={() => api(`/api/wishlist/${w.id}`, { method: 'DELETE' }).then(load)}
                        >
                          Del
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function SearchPage({ isAdmin }: { isAdmin: boolean }) {
  const [text, setText] = useState('');
  const [mainCat, setMainCat] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function search() {
    setBusy(true);
    setMsg('');
    try {
      const q = new URLSearchParams({ text });
      if (mainCat) q.set('mainCat', mainCat);
      const data = await api<any>(`/api/search?${q}`);
      setResults(data.releases || []);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function snatch(r: any) {
    setMsg('');
    try {
      const out = await api<any>('/api/snatch', {
        method: 'POST',
        body: JSON.stringify({
          torrentId: r.torrentId,
          title: r.title,
          author: r.author,
          mediaType: r.mediaType,
          format: r.format,
          force: true,
        }),
      });
      setMsg(out.snatched ? `Snatched: ${out.reason}` : `Not snatched: ${out.reason}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Snatch failed');
    }
  }

  return (
    <>
      <h2 className="page-title">Search</h2>
      <p className="page-sub">Ad-hoc MAM search with one-click snatch</p>
      <div className="card">
        <div className="row">
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>Query</label>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} />
          </div>
          <div className="field" style={{ width: 160, marginBottom: 0 }}>
            <label>Category</label>
            <select value={mainCat} onChange={(e) => setMainCat(e.target.value)}>
              <option value="">All</option>
              <option value="14">E-Books</option>
              <option value="13">Audiobooks</option>
            </select>
          </div>
          <button className="btn" disabled={busy} onClick={() => void search()} style={{ alignSelf: 'end' }}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </div>
        {msg && <div className={msg.startsWith('Snatched') ? 'okmsg' : 'error'}>{msg}</div>}
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.torrentId}>
                <td>
                  <strong>{r.title}</strong>
                  <div className="detail">
                    {r.author}
                    {r.series && r.series !== 'Standalone' ? ` · ${r.series}` : ''}
                  </div>
                </td>
                <td>
                  {r.mediaType}/{r.format}
                  {r.freeleech ? ' · FL' : ''}
                </td>
                <td>{r.sizeStr}</td>
                <td>
                  {isAdmin && (
                    <button className="btn" onClick={() => void snatch(r)}>
                      Snatch
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {results.length === 0 && <div className="detail">No results yet</div>}
      </div>
    </>
  );
}

function HistoryPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    void api<any[]>('/api/snatches').then(setRows);
  }, []);

  return (
    <>
      <h2 className="page-title">History</h2>
      <p className="page-sub">Snatch log</p>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Title</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt}</td>
                <td>
                  {r.title}
                  <div className="detail">
                    {r.author} · {r.format} · filter {r.filterName || 'manual'}
                  </div>
                </td>
                <td>{r.source}</td>
                <td>
                  <span className={`badge ${r.status === 'success' ? 'ok' : 'err'}`}>{r.status}</span>
                  {r.error && <div className="detail">{r.error}</div>}
                  {r.clientMessage && <div className="detail">{r.clientMessage}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SettingsPage() {
  const [settings, setLocal] = useState<any>({});
  const [mamId, setMamId] = useState('');
  const [qbitPass, setQbitPass] = useState('');
  const [nickservPass, setNickservPass] = useState('');
  const [hookStream, setHookStream] = useState('');
  const [hookErrors, setHookErrors] = useState('');
  const [hookSnatch, setHookSnatch] = useState('');
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [mamMsg, setMamMsg] = useState('');
  const [mamOk, setMamOk] = useState(true);
  const [qbitMsg, setQbitMsg] = useState('');
  const [qbitOk, setQbitOk] = useState(true);
  const [discordMsg, setDiscordMsg] = useState('');
  const [discordOk, setDiscordOk] = useState(true);
  const [testingMam, setTestingMam] = useState(false);
  const [testingQbit, setTestingQbit] = useState(false);
  const [testingDiscord, setTestingDiscord] = useState<'stream' | 'errors' | 'snatch' | null>(null);

  useEffect(() => {
    void api<any>('/api/settings').then(setLocal);
  }, []);

  async function save() {
    setMsg('');
    try {
      const body: Record<string, string> = {
        irc_nick: settings.irc_nick || '',
        irc_host: settings.irc_host || 'irc.myanonamouse.net',
        irc_port: settings.irc_port || '6697',
        irc_channel: settings.irc_channel || '#announce',
        qbit_host: settings.qbit_host || '',
        qbit_username: settings.qbit_username || '',
        qbit_category: settings.qbit_category || '',
        qbit_save_path: settings.qbit_save_path || '',
        download_client: settings.download_client || 'qbittorrent',
        watch_folder: settings.watch_folder || '',
        wishlist_poll_enabled: settings.wishlist_poll_enabled || 'true',
        wishlist_default_interval: settings.wishlist_default_interval || '30',
      };
      if (mamId) body.mam_id = mamId;
      if (qbitPass) body.qbit_password = qbitPass;
      if (nickservPass) body.irc_nickserv_password = nickservPass;
      if (hookStream.trim()) body.discord_webhook_stream = hookStream.trim();
      if (hookErrors.trim()) body.discord_webhook_errors = hookErrors.trim();
      if (hookSnatch.trim()) body.discord_webhook_snatch = hookSnatch.trim();
      const saved = await api<{ ok: boolean; discord?: { stream: boolean; errors: boolean; snatch: boolean } }>(
        '/api/settings',
        { method: 'PUT', body: JSON.stringify(body) }
      );
      setMamId('');
      setQbitPass('');
      setNickservPass('');
      setHookStream('');
      setHookErrors('');
      setHookSnatch('');
      setLocal(await api('/api/settings'));
      setMsgOk(true);
      const d = saved.discord;
      setMsg(
        d
          ? `Settings saved — Discord: stream ${d.stream ? 'on' : 'off'}, errors ${d.errors ? 'on' : 'off'}, snatch ${d.snatch ? 'on' : 'off'}`
          : 'Settings saved'
      );
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function testDiscord(channel: 'stream' | 'errors' | 'snatch') {
    setTestingDiscord(channel);
    setDiscordMsg('Sending test embed…');
    setDiscordOk(true);
    const draft =
      channel === 'stream' ? hookStream : channel === 'errors' ? hookErrors : hookSnatch;
    try {
      const r = await api<{ ok: boolean; message: string }>('/api/settings/test-discord', {
        method: 'POST',
        body: JSON.stringify({
          channel,
          url: draft.trim() || undefined,
        }),
      });
      setDiscordOk(r.ok);
      setDiscordMsg(r.message + (draft.trim() ? ' (used unsaved URL — click Save settings to persist)' : ''));
    } catch (err) {
      setDiscordOk(false);
      setDiscordMsg(err instanceof Error ? err.message : 'Discord test failed');
    } finally {
      setTestingDiscord(null);
    }
  }

  async function clearDiscord(channel: 'stream' | 'errors' | 'snatch') {
    const key =
      channel === 'stream'
        ? 'discord_webhook_stream'
        : channel === 'errors'
          ? 'discord_webhook_errors'
          : 'discord_webhook_snatch';
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ [key]: '__clear__' }),
      });
      if (channel === 'stream') setHookStream('');
      if (channel === 'errors') setHookErrors('');
      if (channel === 'snatch') setHookSnatch('');
      setLocal(await api('/api/settings'));
      setDiscordOk(true);
      setDiscordMsg(`Cleared ${channel} webhook`);
    } catch (err) {
      setDiscordOk(false);
      setDiscordMsg(err instanceof Error ? err.message : 'Clear failed');
    }
  }

  async function testMam() {
    setTestingMam(true);
    setMamMsg('Testing…');
    setMamOk(true);
    try {
      const r = await api<{ ok: boolean; message: string }>('/api/settings/test-mam', {
        method: 'POST',
        body: '{}',
      });
      setMamOk(r.ok);
      setMamMsg(r.message);
    } catch (err) {
      setMamOk(false);
      setMamMsg(err instanceof Error ? err.message : 'MAM test failed');
    } finally {
      setTestingMam(false);
    }
  }

  async function testQbit() {
    setTestingQbit(true);
    setQbitMsg('Testing…');
    setQbitOk(true);
    try {
      const r = await api<{ ok: boolean; message: string }>('/api/settings/test-qbit', {
        method: 'POST',
        body: JSON.stringify({
          host: settings.qbit_host || undefined,
          username: settings.qbit_username || undefined,
          password: qbitPass || undefined,
        }),
      });
      setQbitOk(r.ok);
      setQbitMsg(r.message);
    } catch (err) {
      setQbitOk(false);
      setQbitMsg(err instanceof Error ? err.message : 'qBittorrent test failed');
    } finally {
      setTestingQbit(false);
    }
  }

  return (
    <>
      <h2 className="page-title">Settings</h2>
      <p className="page-sub">MAM session, IRC, qBittorrent, Discord</p>
      <div className="grid two">
        <div className="card">
          <h3>MyAnonamouse</h3>
          <div className="field">
            <label>mam_id cookie {settings.mam_id_set ? `(set: ${settings.mam_id})` : '(not set)'}</label>
            <input
              type="password"
              placeholder="Paste dedicated session mam_id"
              value={mamId}
              onChange={(e) => setMamId(e.target.value)}
            />
          </div>
          <p className="detail">
            Create a dedicated session under MAM → Preferences → Security. Use a session only for MyBookBRR —
            MAM rotates mam_id and sharing breaks other apps.
          </p>
          <button className="btn secondary" disabled={testingMam} onClick={() => void testMam()}>
            {testingMam ? 'Testing…' : 'Test MAM'}
          </button>
          {mamMsg && <div className={mamOk ? 'okmsg' : 'error'}>{mamMsg}</div>}
        </div>
        <div className="card">
          <h3>IRC</h3>
          <p className="detail">
            IRC does not start with the server. Use <strong>Start IRC</strong> / <strong>Stop IRC</strong> on the
            Dashboard when you want it connected.
          </p>
          <div className="field">
            <label>Nick</label>
            <input
              value={settings.irc_nick || ''}
              onChange={(e) => setLocal({ ...settings, irc_nick: e.target.value })}
            />
          </div>
          <div className="field">
            <label>
              NickServ password{' '}
              {settings.irc_nickserv_password_set ? '(set)' : '(required for MAM)'}
            </label>
            <input
              type="password"
              placeholder={settings.irc_nickserv_password_set ? '••••••••' : 'IRC NickServ password'}
              value={nickservPass}
              onChange={(e) => setNickservPass(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label>Host</label>
            <input
              value={settings.irc_host || ''}
              onChange={(e) => setLocal({ ...settings, irc_host: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Port</label>
            <input
              value={settings.irc_port || ''}
              onChange={(e) => setLocal({ ...settings, irc_port: e.target.value })}
            />
          </div>
          <p className="detail">
            Use the same nick/password registered on MAM IRC. After connect, MyBookBRR sends{' '}
            <code>NickServ IDENTIFY</code> before joining #announce.
          </p>
        </div>
        <div className="card">
          <h3>qBittorrent</h3>
          <div className="field">
            <label>Host</label>
            <input
              value={settings.qbit_host || ''}
              onChange={(e) => setLocal({ ...settings, qbit_host: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Username</label>
            <input
              value={settings.qbit_username || ''}
              onChange={(e) => setLocal({ ...settings, qbit_username: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={qbitPass} onChange={(e) => setQbitPass(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="field">
            <label>Category</label>
            <input
              value={settings.qbit_category || ''}
              onChange={(e) => setLocal({ ...settings, qbit_category: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Save path</label>
            <input
              value={settings.qbit_save_path || ''}
              onChange={(e) => setLocal({ ...settings, qbit_save_path: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Download client</label>
            <select
              value={settings.download_client || 'qbittorrent'}
              onChange={(e) => setLocal({ ...settings, download_client: e.target.value })}
            >
              <option value="qbittorrent">qbittorrent</option>
              <option value="watchfolder">watchfolder</option>
            </select>
          </div>
          <button className="btn secondary" disabled={testingQbit} onClick={() => void testQbit()}>
            {testingQbit ? 'Testing…' : 'Test qBittorrent'}
          </button>
          {qbitMsg && <div className={qbitOk ? 'okmsg' : 'error'}>{qbitMsg}</div>}
          <p className="detail">Uses the host/user above (and password field if filled). Save settings to persist.</p>
        </div>
        <div className="card">
          <h3>Discord webhooks</h3>
          <p className="detail">
            Paste a webhook URL, click <strong>Test</strong>, then <strong>Save settings</strong> to persist.
            Blank fields keep the currently saved URL.
          </p>
          <div className="field">
            <label>
              Release stream {settings.discord_webhook_stream_set ? '(saved)' : '(not set)'}
            </label>
            <input
              type="url"
              autoComplete="off"
              placeholder={
                settings.discord_webhook_stream_set
                  ? '•••• saved — paste to replace'
                  : 'https://discord.com/api/webhooks/…'
              }
              value={hookStream}
              onChange={(e) => setHookStream(e.target.value)}
            />
            <div className="row" style={{ marginTop: '0.4rem' }}>
              <button
                className="btn secondary"
                disabled={testingDiscord !== null}
                onClick={() => void testDiscord('stream')}
              >
                {testingDiscord === 'stream' ? 'Testing…' : 'Test stream'}
              </button>
              {settings.discord_webhook_stream_set && (
                <button className="btn danger" onClick={() => void clearDiscord('stream')}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <label>Errors {settings.discord_webhook_errors_set ? '(saved)' : '(not set)'}</label>
            <input
              type="url"
              autoComplete="off"
              placeholder={
                settings.discord_webhook_errors_set
                  ? '•••• saved — paste to replace'
                  : 'https://discord.com/api/webhooks/…'
              }
              value={hookErrors}
              onChange={(e) => setHookErrors(e.target.value)}
            />
            <div className="row" style={{ marginTop: '0.4rem' }}>
              <button
                className="btn secondary"
                disabled={testingDiscord !== null}
                onClick={() => void testDiscord('errors')}
              >
                {testingDiscord === 'errors' ? 'Testing…' : 'Test errors'}
              </button>
              {settings.discord_webhook_errors_set && (
                <button className="btn danger" onClick={() => void clearDiscord('errors')}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <label>
              Snatch success (global) {settings.discord_webhook_snatch_set ? '(saved)' : '(not set)'}
            </label>
            <input
              type="url"
              autoComplete="off"
              placeholder={
                settings.discord_webhook_snatch_set
                  ? '•••• saved — paste to replace'
                  : 'https://discord.com/api/webhooks/…'
              }
              value={hookSnatch}
              onChange={(e) => setHookSnatch(e.target.value)}
            />
            <div className="row" style={{ marginTop: '0.4rem' }}>
              <button
                className="btn secondary"
                disabled={testingDiscord !== null}
                onClick={() => void testDiscord('snatch')}
              >
                {testingDiscord === 'snatch' ? 'Testing…' : 'Test snatch'}
              </button>
              {settings.discord_webhook_snatch_set && (
                <button className="btn danger" onClick={() => void clearDiscord('snatch')}>
                  Clear
                </button>
              )}
            </div>
            <p className="detail">Per-filter webhooks on the Filters page override this for that rule’s successes.</p>
          </div>
          {discordMsg && <div className={discordOk ? 'okmsg' : 'error'}>{discordMsg}</div>}
          <div className="field">
            <label>Wishlist polling</label>
            <select
              value={settings.wishlist_poll_enabled || 'true'}
              onChange={(e) => setLocal({ ...settings, wishlist_poll_enabled: e.target.value })}
            >
              <option value="true">enabled</option>
              <option value="false">disabled</option>
            </select>
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: '1rem' }}>
        <button className="btn" onClick={() => void save()}>
          Save settings
        </button>
        {msg && <div className={msgOk ? 'okmsg' : 'error'}>{msg}</div>}
      </div>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [page, setPage] = useState<Page>('dashboard');
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    void api<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/me')
      .then((r) => setUser(r.authenticated && r.user ? r.user : null))
      .catch(() => setUser(null));
  }, []);

  const nav = useMemo(() => {
    const items: Array<[Page, string]> = [
      ['dashboard', 'Dashboard'],
      ['live', 'Live'],
      ['filters', 'Filters'],
      ['wishlist', 'Wishlist'],
      ['search', 'Search'],
      ['history', 'History'],
    ];
    if (isAdmin) {
      items.push(['settings', 'Settings'], ['users', 'Users'], ['api-keys', 'API Keys']);
    }
    return items;
  }, [isAdmin]);

  if (user === undefined) return null;
  if (!user) return <Login onDone={(u) => setUser(u)} />;
  if (user.mustChangePassword) {
    return <ChangePasswordGate user={user} onDone={(u) => setUser(u)} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          MyBook<span>BRR</span>
        </div>
        <div className="detail" style={{ padding: '0 0.75rem 0.5rem', color: 'var(--muted)' }}>
          {user.username} · {user.role}
        </div>
        <nav className="nav">
          {nav.map(([id, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
        </nav>
        <button
          className="btn secondary"
          onClick={() =>
            api('/api/auth/logout', { method: 'POST', body: '{}' }).then(() => setUser(null))
          }
        >
          Sign out
        </button>
      </aside>
      <main className="main">
        {page === 'dashboard' && <Dashboard isAdmin={isAdmin} />}
        {page === 'live' && <LiveFeed isAdmin={isAdmin} />}
        {page === 'filters' && <FiltersPage isAdmin={isAdmin} />}
        {page === 'wishlist' && <WishlistPage isAdmin={isAdmin} />}
        {page === 'search' && <SearchPage isAdmin={isAdmin} />}
        {page === 'history' && <HistoryPage />}
        {page === 'settings' && isAdmin && <SettingsPage />}
        {page === 'users' && isAdmin && <UsersPage />}
        {page === 'api-keys' && isAdmin && <ApiKeysPage />}
      </main>
    </div>
  );
}
