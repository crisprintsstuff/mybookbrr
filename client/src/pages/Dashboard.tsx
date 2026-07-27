import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { FilterLimitBanner } from '../components/FilterLimitBanner';

export function Dashboard({ isAdmin }: { isAdmin: boolean }) {
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

  const qbit = status.qbit;
  const qbitIcon =
    !qbit?.applicable ? 'orange' : qbit.ok ? 'green' : 'red';
  const qbitBadge =
    !qbit?.applicable ? 'warn' : qbit.ok ? 'ok' : 'err';
  const qbitLabel =
    !qbit?.applicable ? 'watch folder' : qbit.ok ? qbit.version || 'online' : 'down';

  return (
    <>
      {status.unsatisfied?.active && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--danger)' }}>
          <h3 style={{ color: 'var(--danger)' }}>
            <i className="fa-solid fa-triangle-exclamation" /> Filters paused — unsatisfied limit
          </h3>
          <p className="detail">{status.unsatisfied.message}</p>
          <p className="detail">Open Filters to clear the lockout and re-enable rules after seeding.</p>
        </div>
      )}
      {status.timedLockout?.active && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--accent-orange, #c4783a)' }}>
          <h3 style={{ color: 'var(--accent-orange, #c4783a)' }}>
            <i className="fa-solid fa-hourglass-half" /> Filters paused — manual MAM lockout timer
          </h3>
          <p className="detail">{status.timedLockout.message}</p>
          <p className="detail">
            Filters re-enable automatically when the timer ends. Manage under Filters.
          </p>
        </div>
      )}
      <FilterLimitBanner filtersAtLimit={status.filtersAtLimit} />
      <div className="grid stats">
        <div className="card metric-card">
          <div className="card-icon blue">
            <i className="fa-solid fa-download" />
          </div>
          <div className="card-data">
            <span className="label">Snatches</span>
            <h3>{status.snatchCount}</h3>
            <div className="sub-label">successful downloads</div>
          </div>
        </div>
        <div className="card metric-card">
          <div className={`card-icon ${status.irc?.joined ? 'green' : status.irc?.connected ? 'orange' : 'red'}`}>
            <i className="fa-solid fa-tower-broadcast" />
          </div>
          <div className="card-data">
            <span className="label">IRC</span>
            <h3>
              <span className={`badge ${status.irc?.joined ? 'ok' : status.irc?.connected ? 'warn' : 'err'}`}>
                {status.irc?.phase || (status.irc?.connected ? 'connected' : 'offline')}
              </span>
            </h3>
            <div className="sub-label">
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
        </div>
        <div className="card metric-card">
          <div className={`card-icon ${status.wishlist?.enabled ? 'green' : 'orange'}`}>
            <i className="fa-solid fa-list-check" />
          </div>
          <div className="card-data">
            <span className="label">Wishlist</span>
            <h3>
              <span className={`badge ${status.wishlist?.enabled ? 'ok' : 'warn'}`}>
                {status.wishlist?.running ? 'polling' : status.wishlist?.enabled ? 'idle' : 'off'}
              </span>
            </h3>
            <div className="sub-label">{status.wishlist?.lastPollResult || 'no polls yet'}</div>
          </div>
        </div>
        <div className="card metric-card">
          <div className={`card-icon ${status.mamConfigured ? 'green' : 'red'}`}>
            <i className="fa-solid fa-paw" />
          </div>
          <div className="card-data">
            <span className="label">MAM</span>
            <h3>
              <span className={`badge ${status.mamConfigured ? 'ok' : 'err'}`}>
                {status.mamConfigured ? 'configured' : 'missing mam_id'}
              </span>
            </h3>
            <div className="sub-label">session cookie</div>
          </div>
        </div>
        <div className="card metric-card">
          <div className={`card-icon ${qbitIcon}`}>
            <i className="fa-solid fa-hard-drive" />
          </div>
          <div className="card-data">
            <span className="label">qBittorrent</span>
            <h3>
              <span className={`badge ${qbitBadge}`}>{qbitLabel}</span>
            </h3>
            <div className="sub-label">{qbit?.message || status.downloadClient || '—'}</div>
          </div>
        </div>
      </div>
      {status.lastAnnounce && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3><i className="fa-solid fa-bullhorn" /> Last announce</h3>
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
          <h3><i className="fa-solid fa-terminal" /> IRC log (redacted)</h3>
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

