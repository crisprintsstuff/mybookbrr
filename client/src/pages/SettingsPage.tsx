import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function SettingsPage() {
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
  const [backingUp, setBackingUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupOk, setBackupOk] = useState(true);

  useEffect(() => {
    void api<any>('/api/settings').then(setLocal);
  }, []);

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
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3><i className="fa-solid fa-database" /> Database backup</h3>
        <p className="detail">
          SQLite is also backed up nightly into <code>data/backups/</code> (keeps 7). Use this for a manual snapshot before changes.
        </p>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button className="btn secondary" type="button" disabled={backingUp} onClick={() => void runBackup()}>
            {backingUp ? 'Backing up…' : 'Backup now'}
          </button>
        </div>
        {backupMsg && <div className={backupOk ? 'okmsg' : 'error'} style={{ marginTop: '0.5rem' }}>{backupMsg}</div>}
      </div>
      <div className="grid two">
        <div className="card">
          <h3><i className="fa-solid fa-paw" /> MyAnonamouse</h3>
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
          <h3><i className="fa-solid fa-tower-broadcast" /> IRC</h3>
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
          <h3><i className="fa-solid fa-cloud-arrow-down" /> qBittorrent</h3>
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
          <h3><i className="fa-brands fa-discord" /> Discord webhooks</h3>
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

