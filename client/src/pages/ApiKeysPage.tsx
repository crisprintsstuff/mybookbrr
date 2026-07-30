import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

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

export function ApiKeysPage() {
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
      <div className="grid two">
        <div className="card">
          <h3><i className="fa-solid fa-key" /> Create key</h3>
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
          <h3><i className="fa-solid fa-shield-halved" /> Active keys</h3>
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

