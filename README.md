# Newbookbot

Autobrr-style MyAnonamouse auto-downloader with **IRC `#announce` snatching** and **wishlist/search polling**. Snatches push to **qBittorrent** (or a watch folder).

## Features

- Live IRC announce listener (direct TLS to `irc.myanonamouse.net`)
- Filter rules (authors, series, formats, freeleech, size, regex, rate limits)
- Wishlist watches that poll MAM JSON search on an interval
- Manual search + one-click snatch
- Cookie rotation persistence for `mam_id`
- Discord webhook notifications
- Single-user password auth + SQLite

## Quick start (local)

```bash
cd newbookbot
cp .env.example .env
# edit AUTH_PASSWORD
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
cd newbookbot
export AUTH_PASSWORD='your-password'
docker compose up -d --build
```

UI: http://127.0.0.1:7480

Set qBittorrent host to `http://host.docker.internal:8080` (or your LAN IP) in Settings.

## MAM session setup (important)

1. Log into [MyAnonamouse](https://www.myanonamouse.net/)
2. **Preferences → Security** → create a **new session** dedicated to Newbookbot
3. Bind the IP of the machine that will run Newbookbot (or enable dynamic seedbox IP if needed)
4. Copy the `mam_id` cookie value into **Settings → mam_id**
5. Do **not** share this session with Autobrr, browser, Prowlarr, etc. — MAM rotates `mam_id` and concurrent clients will invalidate each other

Also authorize your public IP for IRC under MAM security if `#announce` connections reset.

## First-run checklist

1. Sign in with `AUTH_PASSWORD`
2. Paste `mam_id` → **Test MAM**
3. Configure qBittorrent → **Test qBittorrent**
4. Create at least one filter (or a catch-all)
5. Enable IRC and/or add wishlist watches
6. Optional: Discord webhook URL

## Architecture

```
IRC #announce ─┐
Wishlist poll ─┼→ normalize → filters → dedup → MAM download → qBittorrent
Manual search ─┘
```

Data lives in `DATA_DIR` (`./data/newbookbot.db` by default). Downloaded `.torrent` files land in `DOWNLOADS_DIR`.

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
