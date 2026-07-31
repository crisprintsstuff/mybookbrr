# AGENTS.md

## Cursor Cloud specific instructions

MyBookBRR is a single Node.js/TypeScript + React (Vite) app with an embedded SQLite DB
(`better-sqlite3`). The optional Python `discord-bot/` is a companion that just calls the
app's `/api/v1`. See `README.md` for the full feature/setup docs and `package.json` for scripts.

### Services

- MyBookBRR API + UI — the only local service you need. `npm run dev` serves both the API and
  (in prod) the built UI on `http://127.0.0.1:7480` (`PORT`). For UI hot-reload, run
  `npm run dev` (API :7480) plus `npm run dev:client` (Vite :5174, proxies `/api` → 7480).
- qBittorrent / MAM / Discord are external dependencies (not run from this repo) and are only
  needed for the full snatch flow, not to start or use the app.

### Non-obvious caveats

- Native module: `better-sqlite3` prebuilds do not match the Ubuntu Node ABI. After any Node
  version change or fresh `npm install`, run `npm run rebuild:native` or the server crashes with
  a `NODE_MODULE_VERSION` / `better_sqlite3.node` error. This is handled by the startup update script.
- Local `.env`: the committed `.env.example` sets `COOKIE_SECURE=true` (for HTTPS behind
  Cloudflare). Over plain local HTTP that breaks cookie login — use `COOKIE_SECURE=false` and
  `TRUST_PROXY=false` locally. `.env` is gitignored, so create it once per VM (copy from
  `.env.example` and flip those two flags).
- First admin: on first boot with an empty `users` table, an admin is bootstrapped from
  `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` (defaults `admin` / `changeme`). The
  account is flagged `mustChangePassword` until you change it in the UI. The DB persists in
  `./data/mybookbrr.db`; delete it to re-bootstrap.
- No lint script exists. `npm run typecheck` (`tsc --noEmit`) is the static check;
  `npm run build` compiles server (`dist/`) + client (`client/dist/`).
