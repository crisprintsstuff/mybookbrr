import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type ConnTab = 'mam' | 'clients';

const TABS: { id: ConnTab; label: string; icon: string; hint: string }[] = [
  {
    id: 'mam',
    label: 'MAM & IRC',
    icon: 'fa-solid fa-paw',
    hint: 'MyAnonamouse session cookie and announce IRC — feeds filters and snatches',
  },
  {
    id: 'clients',
    label: 'Download client',
    icon: 'fa-solid fa-cloud-arrow-down',
    hint: 'Where snatches go after a filter match (qBittorrent or watch folder)',
  },
];

export function ConnectionsPage() {
  const [tab, setTab] = useState<ConnTab>('mam');
  const [settings, setLocal] = useState<any>({});
  const [mamId, setMamId] = useState('');
  const [qbitPass, setQbitPass] = useState('');
  const [nickservPass, setNickservPass] = useState('');
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [mamMsg, setMamMsg] = useState('');
  const [mamOk, setMamOk] = useState(true);
  const [qbitMsg, setQbitMsg] = useState('');
  const [qbitOk, setQbitOk] = useState(true);
  const [testingMam, setTestingMam] = useState(false);
  const [testingQbit, setTestingQbit] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<any>('/api/settings').then(setLocal);
  }, []);

  async function reload() {
    setLocal(await api('/api/settings'));
  }

  async function putSettings(body: Record<string, string>, successHint?: string) {
    setSaving(true);
    setMsg('');
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      await reload();
      setMsgOk(true);
      setMsg(successHint || 'Saved');
      return true;
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveMamIrc() {
    const body: Record<string, string> = {
      irc_nick: settings.irc_nick || '',
      irc_host: settings.irc_host || 'irc.myanonamouse.net',
      irc_port: settings.irc_port || '6697',
      irc_channel: settings.irc_channel || '#announce',
    };
    if (mamId) body.mam_id = mamId;
    if (nickservPass) body.irc_nickserv_password = nickservPass;
    const ok = await putSettings(body, 'MAM & IRC settings saved');
    if (ok) {
      setMamId('');
      setNickservPass('');
    }
  }

  async function saveClients() {
    const body: Record<string, string> = {
      qbit_host: settings.qbit_host || '',
      qbit_username: settings.qbit_username || '',
      qbit_category: settings.qbit_category || '',
      qbit_save_path: settings.qbit_save_path || '',
      download_client: settings.download_client || 'qbittorrent',
      watch_folder: settings.watch_folder || '',
    };
    if (qbitPass) body.qbit_password = qbitPass;
    const ok = await putSettings(body, 'Download client settings saved');
    if (ok) setQbitPass('');
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

  const activeTab = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <>
      <nav className="settings-tabs" aria-label="Connection settings">
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

      {tab === 'mam' && (
        <>
          <div className="grid two">
            <div className="card">
              <h3>
                <i className="fa-solid fa-paw" /> MyAnonamouse
              </h3>
              <div className="field">
                <label>
                  mam_id cookie {settings.mam_id_set ? `(set: ${settings.mam_id})` : '(not set)'}
                </label>
                <input
                  type="password"
                  placeholder="Paste dedicated session mam_id"
                  value={mamId}
                  onChange={(e) => setMamId(e.target.value)}
                />
              </div>
              <p className="detail">
                Create a dedicated session under MAM → Preferences → Security. Use a session only for
                MyBookBRR — MAM rotates mam_id and sharing breaks other apps.
              </p>
              <button className="btn secondary" disabled={testingMam} onClick={() => void testMam()}>
                {testingMam ? 'Testing…' : 'Test MAM'}
              </button>
              {mamMsg && <div className={mamOk ? 'okmsg' : 'error'}>{mamMsg}</div>}
            </div>
            <div className="card">
              <h3>
                <i className="fa-solid fa-tower-broadcast" /> IRC
              </h3>
              <p className="detail">
                IRC does not start with the server. Use <strong>Start IRC</strong> /{' '}
                <strong>Stop IRC</strong> on the Dashboard when you want it connected.
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
                  placeholder={
                    settings.irc_nickserv_password_set ? '••••••••' : 'IRC NickServ password'
                  }
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
              <div className="field">
                <label>Channel</label>
                <input
                  value={settings.irc_channel || '#announce'}
                  onChange={(e) => setLocal({ ...settings, irc_channel: e.target.value })}
                />
              </div>
              <p className="detail">
                Use the same nick/password registered on MAM IRC. After connect, MyBookBRR sends{' '}
                <code>NickServ IDENTIFY</code> before joining #announce.
              </p>
            </div>
          </div>
          <div className="row settings-save-row">
            <button className="btn" disabled={saving} onClick={() => void saveMamIrc()}>
              {saving ? 'Saving…' : 'Save MAM & IRC'}
            </button>
            {msg && <div className={msgOk ? 'okmsg' : 'error'}>{msg}</div>}
          </div>
        </>
      )}

      {tab === 'clients' && (
        <>
          <div className="card" style={{ maxWidth: 640 }}>
            <h3>
              <i className="fa-solid fa-cloud-arrow-down" /> Download client
            </h3>
            <div className="field">
              <label>Client type</label>
              <select
                value={settings.download_client || 'qbittorrent'}
                onChange={(e) => setLocal({ ...settings, download_client: e.target.value })}
              >
                <option value="qbittorrent">qbittorrent</option>
                <option value="watchfolder">watchfolder</option>
              </select>
            </div>
            {(settings.download_client || 'qbittorrent') === 'watchfolder' ? (
              <div className="field">
                <label>Watch folder path</label>
                <input
                  value={settings.watch_folder || ''}
                  onChange={(e) => setLocal({ ...settings, watch_folder: e.target.value })}
                  placeholder="/path/to/watch"
                />
              </div>
            ) : (
              <>
                <div className="field">
                  <label>qBittorrent host</label>
                  <input
                    value={settings.qbit_host || ''}
                    onChange={(e) => setLocal({ ...settings, qbit_host: e.target.value })}
                    placeholder="http://127.0.0.1:8080"
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
                  <input
                    type="password"
                    value={qbitPass}
                    onChange={(e) => setQbitPass(e.target.value)}
                    placeholder="••••••••"
                  />
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
                <button className="btn secondary" disabled={testingQbit} onClick={() => void testQbit()}>
                  {testingQbit ? 'Testing…' : 'Test qBittorrent'}
                </button>
                {qbitMsg && <div className={qbitOk ? 'okmsg' : 'error'}>{qbitMsg}</div>}
                <p className="detail">
                  Uses the host/user above (and password field if filled). Save to persist.
                </p>
              </>
            )}
          </div>
          <div className="row settings-save-row">
            <button className="btn" disabled={saving} onClick={() => void saveClients()}>
              {saving ? 'Saving…' : 'Save download client'}
            </button>
            {msg && <div className={msgOk ? 'okmsg' : 'error'}>{msg}</div>}
          </div>
        </>
      )}
    </>
  );
}
