import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { UsersPage } from './UsersPage';
import { ApiKeysPage } from './ApiKeysPage';

type AdminTab = 'notify' | 'maintenance' | 'logs' | 'users' | 'api-keys';
type LogsPane = 'audit' | 'versions';

type AuditEntry = {
  id: number;
  action: string;
  summary: string;
  detail: unknown;
  username: string;
  source: string;
  createdAt: string;
};

type SettingsVersion = {
  id: number;
  version: number;
  summary: string;
  changedKeys: string[];
  diff: Record<string, { from: string; to: string }>;
  snapshot?: Record<string, string | boolean>;
  username: string;
  source: string;
  createdAt: string;
};

const TABS: { id: AdminTab; label: string; icon: string; hint: string }[] = [
  {
    id: 'notify',
    label: 'Notifications',
    icon: 'fa-brands fa-discord',
    hint: 'Discord webhooks and wishlist poll defaults',
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: 'fa-solid fa-database',
    hint: 'Database backups',
  },
  {
    id: 'logs',
    label: 'Logs',
    icon: 'fa-solid fa-clipboard-list',
    hint: 'Audit trail and settings version history',
  },
  {
    id: 'users',
    label: 'Users',
    icon: 'fa-solid fa-users',
    hint: 'Admin and viewer accounts for the web UI',
  },
  {
    id: 'api-keys',
    label: 'API keys',
    icon: 'fa-solid fa-key',
    hint: 'Scoped keys for Discord bots and home monitors (/api/v1)',
  },
];

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('notify');
  const [settings, setLocal] = useState<any>({});
  const [hookStream, setHookStream] = useState('');
  const [hookErrors, setHookErrors] = useState('');
  const [hookSnatch, setHookSnatch] = useState('');
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [discordMsg, setDiscordMsg] = useState('');
  const [discordOk, setDiscordOk] = useState(true);
  const [testingDiscord, setTestingDiscord] = useState<'stream' | 'errors' | 'snatch' | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupOk, setBackupOk] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logsPane, setLogsPane] = useState<LogsPane>('audit');
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [versions, setVersions] = useState<SettingsVersion[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [expandedAudit, setExpandedAudit] = useState<number | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [versionMsg, setVersionMsg] = useState('');
  const [versionOk, setVersionOk] = useState(true);

  useEffect(() => {
    if (tab === 'notify') {
      void api<any>('/api/settings').then(setLocal);
    }
  }, [tab]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError('');
    try {
      const [audit, ver] = await Promise.all([
        api<{ entries: AuditEntry[] }>('/api/audit?limit=150'),
        api<{ versions: SettingsVersion[] }>('/api/settings/versions?limit=50'),
      ]);
      setAuditEntries(audit.entries || []);
      setVersions(ver.versions || []);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'logs') void loadLogs();
  }, [tab, loadLogs]);

  async function reload() {
    setLocal(await api('/api/settings'));
  }

  async function putSettings(body: Record<string, string>, successHint?: string) {
    setSaving(true);
    setMsg('');
    try {
      const saved = await api<{
        ok: boolean;
        discord?: { stream: boolean; errors: boolean; snatch: boolean };
      }>('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      await reload();
      setMsgOk(true);
      if (successHint) {
        setMsg(successHint);
      } else if (saved.discord) {
        const d = saved.discord;
        setMsg(
          `Saved — Discord: stream ${d.stream ? 'on' : 'off'}, errors ${d.errors ? 'on' : 'off'}, snatch ${d.snatch ? 'on' : 'off'}`,
        );
      } else {
        setMsg('Saved');
      }
      return true;
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveNotify() {
    const body: Record<string, string> = {
      wishlist_poll_enabled: settings.wishlist_poll_enabled || 'true',
      wishlist_default_interval: settings.wishlist_default_interval || '30',
    };
    if (hookStream.trim()) body.discord_webhook_stream = hookStream.trim();
    if (hookErrors.trim()) body.discord_webhook_errors = hookErrors.trim();
    if (hookSnatch.trim()) body.discord_webhook_snatch = hookSnatch.trim();
    const ok = await putSettings(body);
    if (ok) {
      setHookStream('');
      setHookErrors('');
      setHookSnatch('');
    }
  }

  async function runBackup() {
    setBackingUp(true);
    setBackupMsg('');
    try {
      const r = await api<{ ok: boolean; file?: string; message?: string }>('/api/backup', {
        method: 'POST',
        body: '{}',
      });
      setBackupOk(true);
      setBackupMsg(r.file ? `Backup saved: ${r.file}` : 'Backup complete');
    } catch (err) {
      setBackupOk(false);
      setBackupMsg(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBackingUp(false);
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
      setDiscordMsg(r.message + (draft.trim() ? ' (used unsaved URL — click Save to persist)' : ''));
    } catch (err) {
      setDiscordOk(false);
      setDiscordMsg(err instanceof Error ? err.message : 'Discord test failed');
    } finally {
      setTestingDiscord(null);
    }
  }

  async function restoreVersion(version: number) {
    if (
      !window.confirm(
        `Restore non-secret settings from v${version}?\n\nSecrets (mam_id, passwords, webhooks) are not restored. A new version will be created.`,
      )
    ) {
      return;
    }
    setRestoringVersion(version);
    setVersionMsg('');
    try {
      const r = await api<{
        ok: boolean;
        message?: string;
        new_version?: number;
        restored_keys?: string[];
        error?: string;
      }>(`/api/settings/versions/${version}/restore`, {
        method: 'POST',
        body: '{}',
      });
      setVersionOk(true);
      setVersionMsg(r.message || `Restored from v${version}`);
      await loadLogs();
      if (r.new_version) setExpandedVersion(r.new_version);
    } catch (err) {
      setVersionOk(false);
      setVersionMsg(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoringVersion(null);
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
      await reload();
      setDiscordOk(true);
      setDiscordMsg(`Cleared ${channel} webhook`);
    } catch (err) {
      setDiscordOk(false);
      setDiscordMsg(err instanceof Error ? err.message : 'Clear failed');
    }
  }

  const activeTab = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <>
      <nav className="settings-tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`settings-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => {
              setTab(t.id);
              setMsg('');
            }}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <i className={t.icon} aria-hidden />
            <span className="settings-tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <p className="settings-tab-hint detail">{activeTab.hint}</p>

      {tab === 'notify' && (
        <>
          <div className="grid two">
            <div className="card">
              <h3>
                <i className="fa-brands fa-discord" /> Discord webhooks
              </h3>
              <p className="detail">
                Paste a webhook URL, click <strong>Test</strong>, then <strong>Save</strong> to
                persist. Blank fields keep the currently saved URL.
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
                  Snatch success (global){' '}
                  {settings.discord_webhook_snatch_set ? '(saved)' : '(not set)'}
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
                <p className="detail">
                  Per-filter webhooks on the Filters page override this for that rule’s successes.
                </p>
              </div>
              {discordMsg && <div className={discordOk ? 'okmsg' : 'error'}>{discordMsg}</div>}
            </div>
            <div className="card">
              <h3>
                <i className="fa-solid fa-magnifying-glass" /> Wishlist poll
              </h3>
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
              <div className="field">
                <label>Default interval (minutes)</label>
                <input
                  type="number"
                  min={5}
                  step={1}
                  value={settings.wishlist_default_interval || '30'}
                  onChange={(e) =>
                    setLocal({ ...settings, wishlist_default_interval: e.target.value })
                  }
                />
              </div>
              <p className="detail">
                Global default for new wishlist watches. Individual watches can override interval on
                the Wishlist page.
              </p>
            </div>
          </div>
          <div className="row settings-save-row">
            <button className="btn" disabled={saving} onClick={() => void saveNotify()}>
              {saving ? 'Saving…' : 'Save notifications'}
            </button>
            {msg && <div className={msgOk ? 'okmsg' : 'error'}>{msg}</div>}
          </div>
        </>
      )}

      {tab === 'maintenance' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h3>
            <i className="fa-solid fa-database" /> Database backup
          </h3>
          <p className="detail">
            SQLite is also backed up nightly into <code>data/backups/</code> (keeps 7). Use this for a
            manual snapshot before changes.
          </p>
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button
              className="btn secondary"
              type="button"
              disabled={backingUp}
              onClick={() => void runBackup()}
            >
              {backingUp ? 'Backing up…' : 'Backup now'}
            </button>
          </div>
          {backupMsg && (
            <div className={backupOk ? 'okmsg' : 'error'} style={{ marginTop: '0.5rem' }}>
              {backupMsg}
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <>
          <div className="logs-subnav row">
            <button
              type="button"
              className={`settings-tab ${logsPane === 'audit' ? 'active' : ''}`}
              onClick={() => setLogsPane('audit')}
            >
              <i className="fa-solid fa-list" aria-hidden />
              Audit log
            </button>
            <button
              type="button"
              className={`settings-tab ${logsPane === 'versions' ? 'active' : ''}`}
              onClick={() => setLogsPane('versions')}
            >
              <i className="fa-solid fa-code-branch" aria-hidden />
              Settings versions
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={logsLoading}
              onClick={() => void loadLogs()}
              style={{ marginLeft: 'auto' }}
            >
              {logsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {logsError && (
            <div className="error" style={{ marginBottom: '0.75rem' }}>
              {logsError}
            </div>
          )}

          {logsPane === 'audit' && (
            <div className="card">
              <h3>
                <i className="fa-solid fa-list" /> Audit log
              </h3>
              <p className="detail">
                Admin and API actions: settings, filters (start/stop/limits), IRC, backups, lockouts.
                Secrets are redacted. Keeps the last 1000 entries.
              </p>
              {auditEntries.length === 0 && !logsLoading ? (
                <p className="detail" style={{ marginTop: '0.75rem' }}>
                  No audit entries yet.
                </p>
              ) : (
                <div className="log-table-wrap">
                  <table className="table log-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Action</th>
                        <th>Summary</th>
                        <th>Who</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEntries.map((e) => (
                        <Fragment key={e.id}>
                          <tr
                            className="log-row"
                            onClick={() =>
                              setExpandedAudit((id) => (id === e.id ? null : e.id))
                            }
                          >
                            <td className="mono">{formatWhen(e.createdAt)}</td>
                            <td>
                              <span className="badge warn">{e.action}</span>
                            </td>
                            <td>{e.summary}</td>
                            <td className="detail">
                              {e.username}
                              <span className="muted"> · {e.source}</span>
                            </td>
                          </tr>
                          {expandedAudit === e.id && (
                            <tr className="log-detail-row">
                              <td colSpan={4}>
                                <pre className="log-json">
                                  {JSON.stringify(e.detail ?? {}, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {logsPane === 'versions' && (
            <div className="card">
              <h3>
                <i className="fa-solid fa-code-branch" /> Settings version history
              </h3>
              <p className="detail">
                Every save of Connections or Admin settings creates a version with a redacted field
                diff. Click a row to expand. <strong>Restore</strong> re-applies non-secret fields
                (nick, hosts, intervals, etc.) and writes a new version. Passwords, mam_id, and
                webhooks are never restored from history.
              </p>
              {versionMsg && (
                <div className={versionOk ? 'okmsg' : 'error'} style={{ marginTop: '0.5rem' }}>
                  {versionMsg}
                </div>
              )}
              {versions.length === 0 && !logsLoading ? (
                <p className="detail" style={{ marginTop: '0.75rem' }}>
                  Loading baseline… try Refresh if this stays empty.
                </p>
              ) : (
                <div className="log-table-wrap">
                  <table className="table log-table">
                    <thead>
                      <tr>
                        <th>Ver</th>
                        <th>When</th>
                        <th>Summary</th>
                        <th>Who</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v, idx) => (
                        <Fragment key={v.id}>
                          <tr
                            className="log-row"
                            onClick={() =>
                              setExpandedVersion((n) => (n === v.version ? null : v.version))
                            }
                          >
                            <td>
                              <strong>v{v.version}</strong>
                              {idx === 0 && (
                                <span className="badge ok" style={{ marginLeft: 6 }}>
                                  latest
                                </span>
                              )}
                            </td>
                            <td className="mono">{formatWhen(v.createdAt)}</td>
                            <td>
                              {v.summary}
                              {v.changedKeys?.length > 0 && (
                                <div className="detail">{v.changedKeys.join(', ')}</div>
                              )}
                            </td>
                            <td className="detail">
                              {v.username}
                              <span className="muted"> · {v.source}</span>
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="btn secondary"
                                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                                disabled={restoringVersion !== null || idx === 0}
                                title={
                                  idx === 0
                                    ? 'Already the latest snapshot'
                                    : `Restore non-secret settings from v${v.version}`
                                }
                                onClick={() => void restoreVersion(v.version)}
                              >
                                {restoringVersion === v.version ? '…' : 'Restore'}
                              </button>
                            </td>
                          </tr>
                          {expandedVersion === v.version && (
                            <tr className="log-detail-row">
                              <td colSpan={5}>
                                <div className="version-diff">
                                  {Object.entries(v.diff || {}).map(([key, d]) => (
                                    <div key={key} className="version-diff-row">
                                      <code>{key}</code>
                                      <span className="diff-from">{d.from === '' ? '∅' : d.from}</span>
                                      <span className="diff-arrow">→</span>
                                      <span className="diff-to">{d.to === '' ? '∅' : d.to}</span>
                                    </div>
                                  ))}
                                  {(!v.diff || Object.keys(v.diff).length === 0) && (
                                    <span className="detail">
                                      Snapshot only (no field-level diff — baseline or identical
                                      re-save).
                                    </span>
                                  )}
                                </div>
                                <div className="detail" style={{ marginTop: '0.5rem' }}>
                                  Snapshot keys:{' '}
                                  {Object.keys(v.snapshot || {})
                                    .filter((k) => !k.endsWith('_set'))
                                    .slice(0, 12)
                                    .join(', ')}
                                  {Object.keys(v.snapshot || {}).filter((k) => !k.endsWith('_set'))
                                    .length > 12
                                    ? '…'
                                    : ''}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'users' && <UsersPage />}
      {tab === 'api-keys' && <ApiKeysPage />}
    </>
  );
}

function formatWhen(iso: string): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}
