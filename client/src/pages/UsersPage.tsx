import { useCallback, useEffect, useState } from 'react';
import { api, type AuthUser } from '../lib/api';

export function UsersPage() {
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
      <div className="grid two">
        <div className="card">
          <h3><i className="fa-solid fa-user-plus" /> Create user</h3>
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
          <h3><i className="fa-solid fa-users" /> Accounts</h3>
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

