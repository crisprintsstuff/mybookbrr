import { useEffect, useState } from 'react';
import { api, formatResetsInClient } from '../lib/api';
import { FilterLimitBanner } from '../components/FilterLimitBanner';

export function normalizeFormats(formats: unknown): string[] {
  if (Array.isArray(formats)) return formats.map(String);
  if (typeof formats === 'string') {
    return formats
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function toggleFormat(current: string[], format: string, checked: boolean): string[] {
  const withoutAll = current.filter((f) => f.toUpperCase() !== 'ALL');
  if (format.toUpperCase() === 'ALL') {
    return checked ? ['All'] : [];
  }
  const next = checked
    ? Array.from(new Set([...withoutAll, format]))
    : withoutAll.filter((f) => f.toUpperCase() !== format.toUpperCase());
  return next;
}

export function FormatCheckboxes({
  formats,
  onChange,
}: {
  formats: string[];
  onChange: (formats: string[]) => void;
}) {
  const allSelected = formats.some((f) => f.toUpperCase() === 'ALL');
  const selected = new Set(formats.map((f) => f.toUpperCase()));

  return (
    <div className="field">
      <label>Formats</label>
      <div className="check-grid">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onChange(toggleFormat(formats, 'All', e.target.checked))}
          />
          All formats
        </label>
      </div>
      <div className="check-group-label">eBooks</div>
      <div className="check-grid">
        {MAM_EBOOK_FORMATS.map((fmt) => (
          <label key={fmt}>
            <input
              type="checkbox"
              disabled={allSelected}
              checked={!allSelected && selected.has(fmt)}
              onChange={(e) => onChange(toggleFormat(formats, fmt, e.target.checked))}
            />
            {fmt}
          </label>
        ))}
      </div>
      <div className="check-group-label">Audiobooks</div>
      <div className="check-grid">
        {MAM_AUDIO_FORMATS.map((fmt) => (
          <label key={fmt}>
            <input
              type="checkbox"
              disabled={allSelected}
              checked={!allSelected && selected.has(fmt)}
              onChange={(e) => onChange(toggleFormat(formats, fmt, e.target.checked))}
            />
            {fmt}
          </label>
        ))}
      </div>
      <p className="detail">
        Use <strong>All formats</strong> with Catch-all to snatch every announce. Otherwise pick specific MAM
        types ({MAM_FORMATS.length} listed).
      </p>
    </div>
  );
}

export function FiltersPage({ isAdmin }: { isAdmin: boolean }) {
  const [filters, setFilters] = useState<any[]>([]);
  const [draft, setDraft] = useState<any>({ ...emptyFilter });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);
  const [testingHook, setTestingHook] = useState(false);
  const [unsatisfied, setUnsatisfied] = useState<any>(null);
  const [timedLockout, setTimedLockout] = useState<any>(null);
  const [lockoutHours, setLockoutHours] = useState('6');
  const [lockoutNote, setLockoutNote] = useState('');
  const [autoDisable, setAutoDisable] = useState(true);

  const load = async () => {
    const [list, guard, timed, settings] = await Promise.all([
      api<any[]>('/api/filters'),
      api<any>('/api/filters/unsatisfied'),
      api<any>('/api/filters/timed-lockout'),
      api<any>('/api/settings'),
    ]);
    setFilters(list);
    setUnsatisfied(guard);
    setTimedLockout(timed);
    setAutoDisable(settings.filters_auto_disable_on_unsatisfied !== 'false');
  };
  useEffect(() => {
    void load();
  }, []);

  async function testFilterDiscord(opts?: { url?: string; filterId?: string; filterName?: string }) {
    setTestingHook(true);
    setMsg('');
    try {
      const r = await api<{ ok: boolean; message: string }>('/api/filters/test-discord', {
        method: 'POST',
        body: JSON.stringify({
          url: opts?.url,
          filterId: opts?.filterId,
          filterName: opts?.filterName,
        }),
      });
      setMsgOk(r.ok);
      setMsg(r.message);
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Discord test failed');
    } finally {
      setTestingHook(false);
    }
  }

  async function save() {
    setMsg('');
    try {
      const formats = normalizeFormats(draft.formats);
      if (!formats.length) {
        setMsgOk(false);
        setMsg('Pick at least one format, or All formats');
        return;
      }
      const payload = {
        ...draft,
        authors: typeof draft.authors === 'string' ? draft.authors.split(',').map((s: string) => s.trim()).filter(Boolean) : draft.authors,
        excludeAuthors:
          typeof draft.excludeAuthors === 'string'
            ? draft.excludeAuthors.split(',').map((s: string) => s.trim()).filter(Boolean)
            : draft.excludeAuthors,
        narrators:
          typeof draft.narrators === 'string'
            ? draft.narrators.split(',').map((s: string) => s.trim()).filter(Boolean)
            : draft.narrators,
        series:
          typeof draft.series === 'string' ? draft.series.split(',').map((s: string) => s.trim()).filter(Boolean) : draft.series,
        formats,
        mediaTypes: Array.isArray(draft.mediaTypes) ? draft.mediaTypes : ['eBook', 'Audiobook'],
      };
      if (editingId) {
        await api(`/api/filters/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/filters', { method: 'POST', body: JSON.stringify(payload) });
      }
      setDraft({ ...emptyFilter });
      setEditingId(null);
      setMsgOk(true);
      setMsg('Saved');
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function saveAutoDisable(next: boolean) {
    setAutoDisable(next);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ filters_auto_disable_on_unsatisfied: next ? 'true' : 'false' }),
      });
      setMsgOk(true);
      setMsg(next
        ? 'Filters will auto-disable when MAM unsatisfied limit is hit'
        : 'Auto-disable on unsatisfied limit is off');
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Failed to save setting');
    }
  }

  async function clearUnsatisfied(reenableFilters: boolean) {
    try {
      const r = await api<{ ok: boolean; reenabled: number }>('/api/filters/unsatisfied/clear', {
        method: 'POST',
        body: JSON.stringify({ reenableFilters }),
      });
      setMsgOk(true);
      setMsg(
        reenableFilters
          ? `Lockout cleared — re-enabled ${r.reenabled} filter(s)`
          : 'Lockout cleared — filters left disabled (turn on manually)'
      );
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Failed to clear lockout');
    }
  }

  async function setManualLockout() {
    const hours = Number(lockoutHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      setMsgOk(false);
      setMsg('Enter a positive number of hours');
      return;
    }
    try {
      const r = await api<{ ok: boolean; timedLockout: any }>('/api/filters/timed-lockout', {
        method: 'POST',
        body: JSON.stringify({ hours, note: lockoutNote || undefined }),
      });
      setMsgOk(true);
      setMsg(`Timed lockout set until ${r.timedLockout?.until || 'scheduled'}`);
      setLockoutNote('');
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Failed to set timed lockout');
    }
  }

  async function clearTimed(reenableFilters: boolean) {
    try {
      const r = await api<{ ok: boolean; reenabled: number }>('/api/filters/timed-lockout/clear', {
        method: 'POST',
        body: JSON.stringify({ reenableFilters }),
      });
      setMsgOk(true);
      setMsg(
        reenableFilters
          ? `Timed lockout cleared — re-enabled ${r.reenabled} filter(s)`
          : 'Timed lockout cleared — filters left disabled'
      );
      await load();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : 'Failed to clear timed lockout');
    }
  }

  function formatRemaining(ms: number | null | undefined) {
    if (ms == null || ms < 0) return '';
    const totalMin = Math.ceil(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m}m remaining`;
    return `${h}h ${m}m remaining`;
  }

  // Only enabled filters drive the banner — disabled caps are not blocking snatches.
  const atLimitFilters = filters
    .filter((f) => f.atLimit && f.enabled !== false)
    .map((f) => ({
      id: f.id,
      name: f.name,
      used: f.limitUsed ?? f.snatchCount,
      max: f.limitMax ?? f.maxDownloads,
      period: f.limitPeriod,
      resetsAt: f.resetsAt,
      enabled: f.enabled,
    }));

  return (
    <>
      {unsatisfied?.active && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--danger)' }}>
          <h3 style={{ color: 'var(--danger)' }}>Unsatisfied torrent limit</h3>
          <p className="detail">{unsatisfied.message}</p>
          {unsatisfied.at && <p className="detail">Detected at {unsatisfied.at}</p>}
          {isAdmin && (
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button className="btn" onClick={() => void clearUnsatisfied(true)}>
                Clear & re-enable filters
              </button>
              <button className="btn secondary" onClick={() => void clearUnsatisfied(false)}>
                Clear lockout only
              </button>
            </div>
          )}
        </div>
      )}
      <FilterLimitBanner filtersAtLimit={atLimitFilters} />
      {timedLockout?.active && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--accent-orange, #c4783a)' }}>
          <h3 style={{ color: 'var(--accent-orange, #c4783a)' }}>Manual MAM lockout timer</h3>
          <p className="detail">{timedLockout.message}</p>
          {timedLockout.until && (
            <p className="detail">
              Until {timedLockout.until}
              {timedLockout.remainingMs != null ? ` · ${formatRemaining(timedLockout.remainingMs)}` : ''}
            </p>
          )}
          {isAdmin && (
            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button className="btn" onClick={() => void clearTimed(true)}>
                Clear early & re-enable
              </button>
              <button className="btn secondary" onClick={() => void clearTimed(false)}>
                Clear early only
              </button>
            </div>
          )}
        </div>
      )}
      {isAdmin && !timedLockout?.active && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3>
            <i className="fa-solid fa-hourglass-half" /> Set manual MAM lockout timer
          </h3>
          <p className="detail">
            Use when MAM shows a website lockout timer (not visible to IRC/API). Disables enabled filters and
            skips auto-snatch until the timer ends, then re-enables those filters automatically.
          </p>
          <div className="row" style={{ marginTop: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label>
              Hours{' '}
              <input
                type="number"
                min={0.25}
                step={0.25}
                value={lockoutHours}
                onChange={(e) => setLockoutHours(e.target.value)}
                style={{ width: '5rem' }}
              />
            </label>
            <button type="button" className="btn secondary" onClick={() => setLockoutHours('1')}>
              1h
            </button>
            <button type="button" className="btn secondary" onClick={() => setLockoutHours('6')}>
              6h
            </button>
            <button type="button" className="btn secondary" onClick={() => setLockoutHours('12')}>
              12h
            </button>
            <button type="button" className="btn secondary" onClick={() => setLockoutHours('24')}>
              24h
            </button>
          </div>
          <label style={{ display: 'block', marginTop: '0.6rem' }}>
            Note (optional)
            <input
              type="text"
              value={lockoutNote}
              onChange={(e) => setLockoutNote(e.target.value)}
              placeholder="e.g. MAM site timer shows 6h"
              style={{ width: '100%', marginTop: '0.25rem' }}
            />
          </label>
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button className="btn" onClick={() => void setManualLockout()}>
              Start lockout
            </button>
          </div>
        </div>
      )}
      {isAdmin && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={autoDisable}
              onChange={(e) => void saveAutoDisable(e.target.checked)}
            />{' '}
            Auto-disable all enabled filters when MAM unsatisfied torrent limit is hit
          </label>
          <p className="detail">
            Prevents repeated download failures / flood while you seed to clear the limit. Filters stay off until you
            re-enable them (or use Clear &amp; re-enable).
          </p>
        </div>
      )}
      <div className="grid two">
        {isAdmin && (
        <div className="card">
          <h3><i className="fa-solid fa-filter" /> {editingId ? 'Edit rule' : 'New rule'}</h3>
          <div className="field">
            <label>Name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="row">
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />{' '}
              Enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.matchAllReleases}
                onChange={(e) => {
                  const matchAllReleases = e.target.checked;
                  setDraft({
                    ...draft,
                    matchAllReleases,
                    // Catch-all commonly wants every format unless narrowed intentionally.
                    formats: matchAllReleases && !normalizeFormats(draft.formats).length
                      ? ['All']
                      : draft.formats,
                  });
                }}
              />{' '}
              Catch-all
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.freeleechOnly}
                onChange={(e) => setDraft({ ...draft, freeleechOnly: e.target.checked })}
              />{' '}
              Freeleech only
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.vipOnly}
                onChange={(e) => setDraft({ ...draft, vipOnly: e.target.checked })}
              />{' '}
              VIP only
            </label>
          </div>
          <div className="field">
            <label>Priority</label>
            <input
              type="number"
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Download limit period</label>
            <select
              value={draft.limitPeriod || 'unlimited'}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  limitPeriod: e.target.value as 'unlimited' | 'daily' | 'weekly' | 'monthly',
                })
              }
            >
              <option value="unlimited">Unlimited</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {draft.limitPeriod && draft.limitPeriod !== 'unlimited' && (
            <div className="field">
              <label>Max downloads per {draft.limitPeriod.replace(/ly$/, '')}</label>
              <input
                type="number"
                min={1}
                value={draft.maxDownloads || 1}
                onChange={(e) => setDraft({ ...draft, maxDownloads: Math.max(1, Number(e.target.value) || 1) })}
              />
              <p className="detail">
                Stops snatching for this filter once the cap is hit in the current window. Set period to Unlimited
                to disable.
              </p>
            </div>
          )}
          <div className="field">
            <label>Authors (comma-separated)</label>
            <input
              value={Array.isArray(draft.authors) ? draft.authors.join(', ') : draft.authors}
              onChange={(e) => setDraft({ ...draft, authors: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Series</label>
            <input
              value={Array.isArray(draft.series) ? draft.series.join(', ') : draft.series}
              onChange={(e) => setDraft({ ...draft, series: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Media types</label>
            <div className="check-grid">
              {(['eBook', 'Audiobook'] as const).map((mt) => {
                const selected = Array.isArray(draft.mediaTypes) ? draft.mediaTypes : [];
                return (
                  <label key={mt}>
                    <input
                      type="checkbox"
                      checked={selected.includes(mt)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? Array.from(new Set([...selected, mt]))
                          : selected.filter((x: string) => x !== mt);
                        setDraft({ ...draft, mediaTypes: next });
                      }}
                    />
                    {mt}
                  </label>
                );
              })}
            </div>
          </div>
          <FormatCheckboxes
            formats={normalizeFormats(draft.formats)}
            onChange={(formats) => setDraft({ ...draft, formats })}
          />
          <div className="field">
            <label>Title regex</label>
            <input
              value={draft.titlePattern}
              onChange={(e) => setDraft({ ...draft, titlePattern: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Client category</label>
            <input
              value={draft.clientCategory}
              onChange={(e) => setDraft({ ...draft, clientCategory: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Save path</label>
            <input value={draft.savePath} onChange={(e) => setDraft({ ...draft, savePath: e.target.value })} />
          </div>
          <div className="field">
            <label>Discord snatch webhook (optional)</label>
            <input
              type="url"
              placeholder="https://discord.com/api/webhooks/…"
              value={draft.discordWebhookUrl || ''}
              onChange={(e) => setDraft({ ...draft, discordWebhookUrl: e.target.value })}
            />
            <div className="row" style={{ marginTop: '0.4rem' }}>
              <button
                className="btn secondary"
                disabled={testingHook}
                onClick={() =>
                  void testFilterDiscord({
                    url: draft.discordWebhookUrl || undefined,
                    filterId: editingId || undefined,
                    filterName: draft.name || 'Filter test',
                  })
                }
              >
                {testingHook ? 'Testing…' : 'Test webhook'}
              </button>
            </div>
            <p className="detail">
              Overrides the global snatch webhook for successes from this filter only. Errors still use the global
              errors webhook. Paste a URL (or Save first) then Test.
            </p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void save()}>
              Save
            </button>
            {editingId && (
              <button
                className="btn secondary"
                onClick={() => {
                  setEditingId(null);
                  setDraft({ ...emptyFilter });
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {msg && <div className={msgOk ? 'okmsg' : 'error'}>{msg}</div>}
        </div>
        )}
        <div className="card">
          <h3><i className="fa-solid fa-table-list" /> Active rules</h3>
          <table className="table">
            <thead>
              <tr>
                <th>On</th>
                <th>Name</th>
                <th>Pri</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {filters.map((f) => (
                <tr key={f.id}>
                  <td>
                    <label title={f.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}>
                      <input
                        type="checkbox"
                        checked={Boolean(f.enabled)}
                        disabled={!isAdmin}
                        onChange={() => {
                          if (!isAdmin) return;
                          void api(`/api/filters/${f.id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ enabled: !f.enabled }),
                          })
                            .then(load)
                            .catch((err) => {
                              setMsgOk(false);
                              setMsg(err instanceof Error ? err.message : 'Toggle failed');
                            });
                        }}
                      />
                    </label>
                  </td>
                  <td>
                    {f.name}{' '}
                    {f.limitPeriod && f.limitPeriod !== 'unlimited' && (f.limitMax > 0 || f.maxDownloads > 0) ? (
                      <span className={`badge ${f.atLimit ? 'err' : (f.limitUsed ?? 0) >= (f.limitMax || f.maxDownloads) * 0.8 ? 'warn' : 'ok'}`}>
                        {f.limitUsed ?? 0}/{f.limitMax || f.maxDownloads} {f.limitPeriod}
                        {f.atLimit && f.resetsAt ? ` · resets ${formatResetsInClient(f.resetsAt)}` : ''}
                      </span>
                    ) : null}
                    {f.limitPeriod && f.limitPeriod !== 'unlimited' && (f.limitMax > 0 || f.maxDownloads > 0) ? (
                      <div
                        className="limit-meter"
                        title={`${f.limitUsed ?? 0} of ${f.limitMax || f.maxDownloads} in ${f.limitPeriod} window`}
                        style={{
                          marginTop: '0.35rem',
                          height: 6,
                          borderRadius: 999,
                          background: 'rgba(255,255,255,0.08)',
                          overflow: 'hidden',
                          maxWidth: 220,
                        }}
                      >
                        <i
                          style={{
                            display: 'block',
                            height: '100%',
                            width: `${Math.min(
                              100,
                              Math.round(
                                ((f.limitUsed ?? 0) / Math.max(1, f.limitMax || f.maxDownloads || 1)) * 100
                              )
                            )}%`,
                            background:
                              f.atLimit
                                ? 'var(--danger, #c44)'
                                : (f.limitUsed ?? 0) >= (f.limitMax || f.maxDownloads) * 0.8
                                  ? 'var(--accent-orange, #c4783a)'
                                  : 'var(--ok, #3a9)',
                            borderRadius: 999,
                            transition: 'width 0.25s ease',
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="detail">
                      {(f.formats || []).join(', ') || 'formats?'}
                      {' · '}
                      {(f.authors || []).join(', ') || (f.matchAllReleases ? 'catch-all' : '—')}
                      {' · '}
                      {f.limitPeriod && f.limitPeriod !== 'unlimited'
                        ? `cap ${f.limitMax || f.maxDownloads || 0}/${f.limitPeriod} (lifetime snatches ${f.snatchCount || 0})`
                        : 'no limit'}
                      {f.atLimit && f.enabled
                        ? ' · blocking snatches'
                        : f.limitPeriod &&
                            f.limitPeriod !== 'unlimited' &&
                            (f.limitUsed ?? 0) >= (f.limitMax || f.maxDownloads) * 0.8 &&
                            !f.atLimit
                          ? ' · nearing cap'
                          : ''}
                    </div>
                  </td>
                  <td>{f.priority}</td>
                  {isAdmin && (
                    <td>
                      <div className="row">
                        <button
                          className="btn secondary"
                          onClick={() => {
                            setEditingId(f.id);
                            setDraft({
                              ...f,
                              authors: f.authors || [],
                              series: f.series || [],
                              mediaTypes: f.mediaTypes || ['eBook', 'Audiobook'],
                              formats: normalizeFormats(f.formats),
                            });
                          }}
                        >
                          Edit
                        </button>
                        {f.discordWebhookUrl ? (
                          <button
                            className="btn secondary"
                            disabled={testingHook}
                            onClick={() =>
                              void testFilterDiscord({ filterId: f.id, filterName: f.name })
                            }
                          >
                            Test
                          </button>
                        ) : null}
                        <button
                          className="btn danger"
                          onClick={() => api(`/api/filters/${f.id}`, { method: 'DELETE' }).then(load)}
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

