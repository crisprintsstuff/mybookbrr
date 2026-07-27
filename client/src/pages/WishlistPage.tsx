import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function WishlistPage({ isAdmin }: { isAdmin: boolean }) {
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
      <div className="grid two">
        {isAdmin && (
          <div className="card">
            <h3><i className="fa-solid fa-plus" /> New watch</h3>
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
          <h3><i className="fa-solid fa-list-check" /> Watches</h3>
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

