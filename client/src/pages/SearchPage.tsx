import { useState } from 'react';
import { api } from '../lib/api';

export function SearchPage({ isAdmin }: { isAdmin: boolean }) {
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

