import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function HistoryPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    void api<any[]>('/api/snatches').then(setRows);
  }, []);

  return (
    <>
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

