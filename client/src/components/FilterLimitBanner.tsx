import { formatResetsInClient } from '../lib/api';

export function FilterLimitBanner({ filtersAtLimit }: { filtersAtLimit?: Array<any> }) {
  if (!filtersAtLimit?.length) return null;
  return (
    <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--accent-orange, #c4783a)' }}>
      <h3 style={{ color: 'var(--accent-orange, #c4783a)' }}>
        <i className="fa-solid fa-gauge-high" /> Filter download limit reached
      </h3>
      <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
        {filtersAtLimit.map((f) => (
          <li key={f.id || f.name} className="detail">
            <strong>{f.name}</strong> at {f.used}/{f.max} {f.period}
            {f.resetsAt ? ` · resets ${formatResetsInClient(f.resetsAt)}` : ''}
            {f.enabled === false ? ' (disabled)' : ''}
          </li>
        ))}
      </ul>
      <p className="detail" style={{ marginTop: '0.5rem' }}>
        Matching announces are rejected until the period window rolls, or raise max downloads under Filters.
      </p>
    </div>
  );
}

