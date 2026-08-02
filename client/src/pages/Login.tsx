import { useEffect, useState } from 'react';
import { api, type AuthUser } from '../lib/api';
import { BackToHubLink } from '../components/BackToHubLink';

export function Login({ onDone }: { onDone: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);

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
    const oidcError = params.get('oidc_error') || params.get('sso_error');
    if (oidcError) {
      const messages: Record<string, string> = {
        denied: 'SSO was cancelled.',
        missing_code: 'SSO incomplete. Try again.',
        invalid_state: 'SSO session expired. Try again.',
        exchange_failed: 'SSO token exchange failed.',
        disabled: 'Your account is disabled.',
        not_configured: 'SSO is not configured.',
        redeem_failed: 'Hub SSO ticket invalid or expired.',
        redeem_unreachable: 'Could not reach Hub for SSO.',
        missing_ticket: 'Missing SSO ticket.',
      };
      setError(messages[oidcError] || `SSO failed (${oidcError})`);
      window.history.replaceState({}, '', window.location.pathname);
    }
    void api<{ discord: boolean; oidc?: boolean }>('/api/auth/providers')
      .then((r) => {
        setDiscordEnabled(Boolean(r.discord));
        setOidcEnabled(Boolean(r.oidc));
      })
      .catch(() => {
        setDiscordEnabled(false);
        setOidcEnabled(false);
      });
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
        <div className="brand-logo-large" aria-hidden>
          <img src="/logo.png?v=1" width={88} height={88} alt="" />
        </div>
        <h1>
          MyBook<span>BRR</span>
        </h1>
        <p>MAM auto-snatch & wishlist downloader</p>
        {oidcEnabled && (
          <>
            <a className="btn primary" href="/api/auth/oidc" style={{ width: '100%', justifyContent: 'center' }}>
              Continue with Authentik
            </a>
            <div className="login-divider">
              <span>or</span>
            </div>
          </>
        )}
        {discordEnabled && (
          <>
            <a className="btn btn-discord" href="/api/auth/discord">
              <i className="fa-brands fa-discord" /> Continue with Discord
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
            autoFocus={!discordEnabled && !oidcEnabled}
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
        <div className="login-hub-link">
          <BackToHubLink className="hub-link" />
        </div>
      </form>
    </div>
  );
}

export function ChangePasswordGate({ user, onDone }: { user: AuthUser; onDone: (user: AuthUser) => void }) {
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
        <div className="brand-logo-large" aria-hidden>
          <i className="fa-solid fa-key" />
        </div>
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

