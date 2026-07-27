# MyBookBRR

Autobrr-style MyAnonamouse auto-downloader with **IRC `#announce` snatching** and **wishlist/search polling**. Snatches push to **qBittorrent** (or a watch folder).

## Features

- Live IRC announce listener (direct TLS to `irc.myanonamouse.net`)
- Filter rules (authors, series, formats, freeleech, size, regex, rate limits)
- Wishlist watches that poll MAM JSON search on an interval
- Manual search + one-click snatch
- Cookie rotation persistence for `mam_id`
- Discord webhook notifications
- Multi-user auth (`admin` / `viewer`) with SQLite sessions
- Scoped API keys + versioned external API (`/api/v1`) for bots and monitors
- Companion Discord control bot (same repo: [`discord-bot/`](discord-bot/))

## Quick start (local)

```bash
cd mybookbrr
cp .env.example .env
# set BOOTSTRAP_ADMIN_PASSWORD (first boot only)
npm install
# Debian/Ubuntu Node: native modules often need a local rebuild
npm run rebuild:native
npm run build && npm start   # http://127.0.0.1:7480
# or:
npm run dev                  # API on :7480
npm run dev:client           # Vite UI on :5174 (proxies /api)
```

If you see `NODE_MODULE_VERSION` / `better_sqlite3.node` errors, you switched Node versions — run `npm run rebuild:native` again with the same `node` you use to start the app.

Open http://127.0.0.1:7480 (after `npm run build`) or http://127.0.0.1:5174 in dev.

## Docker

```bash
cd mybookbrr
export BOOTSTRAP_ADMIN_PASSWORD='your-password'
docker compose up -d --build
```

UI: http://127.0.0.1:7480

Set qBittorrent host to `http://host.docker.internal:8080` (or your LAN IP) in Settings.

## MAM session setup (important)

1. Log into [MyAnonamouse](https://www.myanonamouse.net/)
2. **Preferences → Security** → create a **new session** dedicated to MyBookBRR
3. Bind the IP of the machine that will run MyBookBRR (or enable dynamic seedbox IP if needed)
4. Copy the `mam_id` cookie value into **Settings → mam_id**
5. Do **not** share this session with Autobrr, browser, Prowlarr, etc. — MAM rotates `mam_id` and concurrent clients will invalidate each other

Also authorize your public IP for IRC under MAM security if `#announce` connections reset.

## First-run checklist

1. Sign in as `admin` with `BOOTSTRAP_ADMIN_PASSWORD` (default `changeme`) — you will be prompted to change it if still on the default
2. Paste `mam_id` → **Test MAM**
3. Configure qBittorrent → **Test qBittorrent**
4. Create at least one filter (or a catch-all)
5. Start IRC from the Dashboard and/or add wishlist watches
6. Optional: Discord webhook URL
7. Optional: create a **viewer** user and/or scoped **API keys** for bots

## Auth model

| Actor | How they authenticate | Access |
|---|---|---|
| Web UI | Username + password → httpOnly cookie session | `admin` full control; `viewer` read-only |
| Discord bot / monitor | `Authorization: Bearer mbb_…` or `X-API-Key` | Scopes assigned per key |

Bootstrap: on first start with an empty `users` table, an admin is created from `BOOTSTRAP_ADMIN_PASSWORD` (or legacy `AUTH_PASSWORD`). Env passwords are not used for day-to-day login after that.

## Discord bot

The Discord control bot lives in [`discord-bot/`](discord-bot/) in this monorepo (slash commands, control panel, portal heartbeat). See [discord-bot/README.md](discord-bot/README.md) for setup.

On this host it is also symlinked to `/home/cris/discordbots/mybookbrr` for the OmegaBot portal.

## External API (`/api/v1`)

Create keys under **API Keys** in the UI (admin). Raw key is shown once (`mbb_…`).

### Scopes

| Scope | Access |
|---|---|
| `status:read` | Status + public settings summary |
| `filters:read` / `filters:write` | List / mutate filters |
| `wishlist:read` / `wishlist:write` | List / mutate / run watches |
| `history:read` | Recent snatches |
| `events:read` | Recent events + SSE stream |
| `irc:control` | Start / stop IRC |
| `snatch:write` | Manual snatch |

### Endpoints

| Method | Path | Scope |
|---|---|---|
| GET | `/api/v1/health` | none |
| GET | `/api/v1/status` | `status:read` |
| GET | `/api/v1/settings/public` | `status:read` |
| GET | `/api/v1/filters` | `filters:read` |
| POST/PUT/DELETE | `/api/v1/filters…` | `filters:write` |
| GET | `/api/v1/wishlist` | `wishlist:read` |
| POST… | `/api/v1/wishlist…` | `wishlist:write` |
| GET | `/api/v1/snatches` | `history:read` |
| GET | `/api/v1/events` | `events:read` |
| GET | `/api/v1/events/stream` | `events:read` |
| POST | `/api/v1/irc/start` \| `/stop` | `irc:control` |
| POST | `/api/v1/snatch` | `snatch:write` |

Secrets (`mam_id`, passwords, webhooks) are not exposed on v1.

### Examples

```bash
# Status
curl -sS -H "Authorization: Bearer mbb_YOUR_KEY" \
  http://127.0.0.1:7480/api/v1/status

# Or X-API-Key
curl -sS -H "X-API-Key: mbb_YOUR_KEY" \
  http://127.0.0.1:7480/api/v1/events

# SSE (prefer header; query allowed when headers are awkward)
curl -N -H "Authorization: Bearer mbb_YOUR_KEY" \
  http://127.0.0.1:7480/api/v1/events/stream
# curl -N 'http://127.0.0.1:7480/api/v1/events/stream?api_key=mbb_YOUR_KEY'
```

UI routes remain under `/api/*` (same cookie / API-key middleware, role-gated).

## Architecture

```
IRC #announce ─┐
Wishlist poll ─┼→ normalize → filters → dedup → MAM download → qBittorrent
Manual search ─┘
```

Data lives in `DATA_DIR` (`./data/mybookbrr.db` by default). Downloaded `.torrent` files land in `DOWNLOADS_DIR`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | API with hot reload (`tsx watch`) |
| `npm run dev:client` | Vite React UI |
| `npm run build` | Compile server + client |
| `npm start` | Run compiled server |

## Notes

- IRC uses direct TLS (ports 6697/7000). ZNC is out of scope for v1.
- Wishlist polls check due watches every 2 minutes; each watch has its own interval (default 30m).
- Manual snatches skip filters (`skipFilters`) so search UI always downloads when you click Snatch.
