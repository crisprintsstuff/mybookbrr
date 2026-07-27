import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type LiveChip = 'all' | 'snatch' | 'reject' | 'limit' | 'seen' | 'error';

export function liveEventMatches(
  item: { type: string; payload?: any },
  chip: LiveChip,
  q: string
): boolean {
  const outcome = item.payload?.outcome as string | undefined;
  const r = item.payload?.release;
  if (q) {
    const hay = `${r?.title || ''} ${r?.author || ''} ${item.payload?.reason || ''} ${(item.payload?.reasons || []).join(' ')}`.toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  if (chip === 'all') return true;
  if (chip === 'snatch') return item.type === 'snatch' || outcome === 'snatched';
  if (chip === 'reject') return item.type === 'reject' && outcome !== 'limit';
  if (chip === 'limit')
    return outcome === 'limit' || (item.payload?.atLimitFilters?.length > 0);
  if (chip === 'seen') return outcome === 'already_seen' || /already seen/i.test(item.payload?.reason || '');
  if (chip === 'error') return item.type === 'error';
  return true;
}

export function LiveFeed({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<Array<{ type: string; payload: any; createdAt?: string }>>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionOk, setActionOk] = useState(true);
  const [chip, setChip] = useState<LiveChip>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void api<any[]>('/api/events').then((evts) => setItems(evts.reverse()));
    const es = new EventSource('/api/events/stream', { withCredentials: true } as any);
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'connected') return;
        setItems((prev) => [...prev.slice(-200), data]);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  async function sendToQbit(release: any, key: string) {
    if (!release?.torrentId) return;
    setBusyKey(key);
    setActionMsg('');
    try {
      const out = await api<{ snatched: boolean; skipped: boolean; reason: string }>('/api/snatch', {
        method: 'POST',
        body: JSON.stringify({
          torrentId: release.torrentId,
          title: release.title,
          author: release.author,
          series: release.series,
          narrator: release.narrator,
          mediaType: release.mediaType,
          format: release.format,
          sizeMB: release.sizeMB,
          sizeStr: release.sizeStr,
          freeleech: release.freeleech,
          vip: release.vip,
          bitrate: release.bitrate,
          torrentUrl: release.torrentUrl,
          year: release.year,
          category: release.category,
          force: true,
        }),
      });
      setActionOk(out.snatched);
      setActionMsg(
        out.snatched
          ? `Sent to download client: ${out.reason}`
          : out.skipped
            ? `Skipped: ${out.reason}`
            : `Failed: ${out.reason}`
      );
    } catch (err) {
      setActionOk(false);
      setActionMsg(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusyKey(null);
    }
  }

  const visible = [...items].reverse().filter((item) => liveEventMatches(item, chip, query.trim()));

  return (
    <>
      {actionMsg && <div className={actionOk ? 'okmsg' : 'error'} style={{ marginBottom: '0.75rem' }}>{actionMsg}</div>}
      <p className="page-sub" style={{ marginBottom: '0.75rem' }}>
        Expand an announce for per-filter pass/fail reasons (limits, format, author, already seen, etc.).
      </p>
      <div className="live-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search title / author…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: '1 1 180px', minWidth: '140px', maxWidth: '280px' }}
        />
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
          {(
            [
              ['all', 'All'],
              ['snatch', 'Snatches'],
              ['reject', 'Rejects'],
              ['limit', 'At limit'],
              ['seen', 'Already seen'],
              ['error', 'Errors'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn ${chip === id ? '' : 'secondary'}`}
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
              onClick={() => setChip(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="feed">
        {items.length === 0 && <div className="card">Waiting for events…</div>}
        {items.length > 0 && visible.length === 0 && (
          <div className="card">
            No events match this filter
            {(query || chip !== 'all') && (
              <>
                {' · '}
                <button type="button" className="btn secondary" onClick={() => { setQuery(''); setChip('all'); }}>
                  Clear
                </button>
              </>
            )}
          </div>
        )}
        {visible.map((item, i) => {
          const r = item.payload?.release;
          const key = `${item.type}-${item.createdAt || ''}-${r?.torrentId || i}-${i}`;
          const open = openKey === key;
          const outcome = item.payload?.outcome as string | undefined;
          const outcomeLabel =
            item.payload?.outcomeLabel ||
            (item.type === 'snatch'
              ? 'Snatched'
              : item.type === 'reject'
                ? 'Rejected'
                : item.type === 'skip'
                  ? 'Skipped'
                  : item.type === 'error'
                    ? 'Error'
                    : item.type);
          const badgeClass =
            item.type === 'snatch' || outcome === 'snatched'
              ? 'ok'
              : outcome === 'already_seen'
                ? ''
                : outcome === 'limit' || item.type === 'reject' || item.type === 'error'
                  ? 'warn'
                  : item.type === 'skip'
                    ? 'warn'
                    : '';
          return (
            <div className="feed-item" key={key}>
              <div className="meta">
                <span className={`badge ${badgeClass}`}>{outcomeLabel}</span>{' '}
                <span className="detail" style={{ display: 'inline' }}>
                  {item.type}
                </span>{' '}
                {item.createdAt || ''}
              </div>
              <div className="title">
                {r ? `${r.author} — ${r.title}` : JSON.stringify(item.payload).slice(0, 120)}
              </div>
              {r && (
                <div className="detail">
                  {r.mediaType}/{r.format} · {r.source} · tid {r.torrentId}
                  {item.payload?.reason || item.payload?.reasons ? (
                    <> · {item.payload.reason || (item.payload.reasons || []).join('; ')}</>
                  ) : null}
                  {item.payload?.clientMessage ? <> · {item.payload.clientMessage}</> : null}
                  {item.payload?.error ? <> · {item.payload.error}</> : null}
                  {item.payload?.atLimitFilters?.length ? (
                    <> · at limit: {(item.payload.atLimitFilters as string[]).join(', ')}</>
                  ) : null}
                </div>
              )}
              {r && (
                <div className="row" style={{ marginTop: '0.45rem' }}>
                  <button
                    className="btn secondary"
                    onClick={() => setOpenKey(open ? null : key)}
                  >
                    {open ? 'Hide details' : 'Details'}
                  </button>
                  {isAdmin && (
                    <button
                      className="btn"
                      disabled={busyKey === key || !r.torrentId}
                      onClick={() => void sendToQbit(r, key)}
                    >
                      {busyKey === key ? 'Sending…' : 'Send to qBittorrent'}
                    </button>
                  )}
                  {r.torrentUrl ? (
                    <a className="btn secondary" href={r.torrentUrl} target="_blank" rel="noreferrer">
                      Open on MAM
                    </a>
                  ) : null}
                </div>
              )}
              {r && open && (
                <div className="feed-details">
                  <div className="feed-details-grid">
                    <div><span>Author</span>{r.author || '—'}</div>
                    <div><span>Series</span>{r.series || '—'}</div>
                    <div><span>Narrator</span>{r.narrator || '—'}</div>
                    <div><span>Media</span>{r.mediaType || '—'}</div>
                    <div><span>Format</span>{r.format || '—'}</div>
                    <div><span>Size</span>{r.sizeStr || (r.sizeMB ? `${r.sizeMB} MB` : '—')}</div>
                    <div><span>Bitrate</span>{r.bitrate ? `${r.bitrate} kbps` : '—'}</div>
                    <div><span>Year</span>{r.year || '—'}</div>
                    <div><span>Category</span>{r.category || '—'}</div>
                    <div><span>Source</span>{r.source || '—'}</div>
                    <div><span>Torrent ID</span>{r.torrentId || '—'}</div>
                    <div>
                      <span>Flags</span>
                      {[r.freeleech ? 'Freeleech' : null, r.vip ? 'VIP' : null].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {item.payload?.reason && !item.payload?.reasons?.length ? (
                    <div className="feed-details-block">
                      <span>Why</span>
                      <div>{item.payload.reason}</div>
                    </div>
                  ) : null}
                  {item.payload?.reasons?.length ? (
                    <div className="feed-details-block">
                      <span>Filter notes</span>
                      <div>{(item.payload.reasons || []).join('; ')}</div>
                    </div>
                  ) : null}
                  {item.payload?.evaluationLog?.length ? (
                    <div className="feed-details-block">
                      <span>Per-filter evaluation</span>
                      <pre>
                        {item.payload.evaluationLog
                          .map((e: any) => {
                            const fails = e.failures || [];
                            if (!fails.length) return `✓ ${e.filterName}: ok`;
                            return `✗ ${e.filterName}: ${fails.join('; ')}`;
                          })
                          .join('\n')}
                      </pre>
                    </div>
                  ) : null}
                  {item.payload?.error ? (
                    <div className="feed-details-block">
                      <span>Error</span>
                      <div className="error">{item.payload.error}</div>
                    </div>
                  ) : null}
                  {r.raw ? (
                    <div className="feed-details-block">
                      <span>Raw announce</span>
                      <pre>{r.raw}</pre>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

const MAM_EBOOK_FORMATS = ['EPUB', 'AZW3', 'MOBI', 'PDF', 'CBR', 'CBZ'] as const;
const MAM_AUDIO_FORMATS = ['M4B', 'MP3', 'FLAC', 'AAC', 'M4A', 'OGG', 'WMA'] as const;
const MAM_FORMATS = [...MAM_EBOOK_FORMATS, ...MAM_AUDIO_FORMATS] as const;

const emptyFilter = {
  name: '',
  enabled: true,
  priority: 5,
  matchAllReleases: false,
  limitPeriod: 'unlimited' as const,
  maxDownloads: 0,
  mediaTypes: ['eBook', 'Audiobook'] as string[],
  formats: ['EPUB', 'M4B'] as string[],
  authors: [] as string[],
  excludeAuthors: [] as string[],
  narrators: [] as string[],
  series: [] as string[],
  titlePattern: '',
  minBitrate: 0,
  minSizeMB: 0,
  maxSizeMB: 50000,
  freeleechOnly: false,
  vipOnly: false,
  clientType: 'qbittorrent' as const,
  clientCategory: 'books',
  savePath: '',
  discordWebhookUrl: '',
};

