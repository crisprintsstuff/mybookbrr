import { useEffect, useMemo, useState } from 'react';
import { api, type AuthUser, type Page } from './lib/api';
import { BackToHubLink } from './components/BackToHubLink';
import { Login, ChangePasswordGate } from './pages/Login';
import { UsersPage } from './pages/UsersPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { Dashboard } from './pages/Dashboard';
import { LiveFeed } from './pages/LiveFeed';
import { FiltersPage } from './pages/FiltersPage';
import { WishlistPage } from './pages/WishlistPage';
import { SearchPage } from './pages/SearchPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [page, setPage] = useState<Page>('dashboard');
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    void api<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/me')
      .then((r) => setUser(r.authenticated && r.user ? r.user : null))
      .catch(() => setUser(null));
  }, []);

  const nav = useMemo(() => {
    const items: Array<[Page, string, string]> = [
      ['dashboard', 'Dashboard', 'fa-solid fa-gauge-high'],
      ['live', 'Live', 'fa-solid fa-bolt'],
      ['filters', 'Filters', 'fa-solid fa-filter'],
      ['wishlist', 'Wishlist', 'fa-solid fa-heart'],
      ['search', 'Search', 'fa-solid fa-magnifying-glass'],
      ['history', 'History', 'fa-solid fa-clock-rotate-left'],
    ];
    if (isAdmin) {
      items.push(
        ['settings', 'Settings', 'fa-solid fa-gear'],
        ['users', 'Users', 'fa-solid fa-users'],
        ['api-keys', 'API Keys', 'fa-solid fa-key']
      );
    }
    return items;
  }, [isAdmin]);

  const pageMeta = useMemo(() => {
    const meta: Record<Page, { title: string; subtitle: string }> = {
      dashboard: { title: 'Dashboard', subtitle: 'IRC announce + wishlist poll status' },
      live: { title: 'Live feed', subtitle: 'SSE stream of announces, matches, rejects, and snatches' },
      filters: {
        title: 'Filters',
        subtitle: 'Autobrr-style snatch rules evaluated against IRC and wishlist releases',
      },
      wishlist: {
        title: 'Wishlist',
        subtitle: 'Periodic MAM search watches for authors, series, and titles',
      },
      search: { title: 'Search', subtitle: 'Ad-hoc MAM search with one-click snatch' },
      history: { title: 'History', subtitle: 'Snatch log' },
      settings: { title: 'Settings', subtitle: 'MAM session, IRC, qBittorrent, Discord' },
      users: { title: 'Users', subtitle: 'Admin and viewer accounts for the web UI' },
      'api-keys': {
        title: 'API keys',
        subtitle: 'Scoped keys for Discord bots and home monitors (/api/v1)',
      },
    };
    return meta[page];
  }, [page]);

  if (user === undefined) return null;
  if (!user) return <Login onDone={(u) => setUser(u)} />;
  if (user.mustChangePassword) {
    return <ChangePasswordGate user={user} onDone={(u) => setUser(u)} />;
  }

  const initials = user.username.slice(0, 2).toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-logo">
            <span className="logo-icon">
              <i className="fa-solid fa-book-open" />
            </span>
            <div className="brand-text">
              <h2>
                MyBook<span>BRR</span>
              </h2>
              <p>Control Console</p>
            </div>
          </div>
        </div>
        <nav className="nav">
          {nav.map(([id, label, icon]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
              <i className={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            Signed in as <strong>{user.username}</strong> · {user.role}
          </div>
          <BackToHubLink className="btn secondary hub-back-btn" />
          <button
            className="btn secondary"
            style={{ width: '100%' }}
            onClick={() =>
              api('/api/auth/logout', { method: 'POST', body: '{}' }).then(() => setUser(null))
            }
          >
            <i className="fa-solid fa-right-from-bracket" /> Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div>
            <h1>{pageMeta.title}</h1>
            <p className="page-sub">{pageMeta.subtitle}</p>
          </div>
          <div className="header-right">
            <BackToHubLink className="btn secondary hub-back-header" />
            <div className="status-indicator" title="Application online">
              <span className="status-dot green animate-pulse" />
              <span>Engine Active</span>
            </div>
            <div className="header-user-card">
              <span className="avatar">{initials}</span>
              <span>{user.username}</span>
              <button
                type="button"
                className="btn-logout"
                title="Sign out"
                onClick={() =>
                  api('/api/auth/logout', { method: 'POST', body: '{}' }).then(() => setUser(null))
                }
              >
                <i className="fa-solid fa-right-from-bracket" />
              </button>
            </div>
          </div>
        </header>
        <div className="content-area">
          {page === 'dashboard' && <Dashboard isAdmin={isAdmin} />}
          {page === 'live' && <LiveFeed isAdmin={isAdmin} />}
          {page === 'filters' && <FiltersPage isAdmin={isAdmin} />}
          {page === 'wishlist' && <WishlistPage isAdmin={isAdmin} />}
          {page === 'search' && <SearchPage isAdmin={isAdmin} />}
          {page === 'history' && <HistoryPage />}
          {page === 'settings' && isAdmin && <SettingsPage />}
          {page === 'users' && isAdmin && <UsersPage />}
          {page === 'api-keys' && isAdmin && <ApiKeysPage />}
        </div>
      </div>
    </div>
  );
}
