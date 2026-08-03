# MyBookBRR Discord Bot

Optional companion bot in this monorepo. Talks to the local MyBookBRR `/api/v1` API (slash commands + control panel). Optional heartbeat to a separate control portal if you run one.

## Setup

1. Create a Discord application + bot; invite with `applications.commands` + `bot`.

2. In MyBookBRR UI → **Admin → API keys**, create a key with scopes:

   `status:read`, `filters:read`, `filters:write`, `wishlist:read`, `wishlist:write`, `history:read`, `events:read`, `irc:control`

3. Configure and run:

   ```bash
   cd discord-bot
   cp config.example.json config.json
   # edit DISCORD_TOKEN + MYBOOKBRR_API_KEY
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   python bot.py
   ```

`config.json` is gitignored. See `config.example.json` for keys.

## Commands

| Command | Description |
|---------|-------------|
| `/mbb_status` | IRC, wishlist, snatch count, unsatisfied lockout |
| `/mbb_irc` | Start or stop IRC |
| `/mbb_unsatisfied_clear` | Clear MAM lockout and re-enable auto-disabled filters |
| `/mbb_snatches` | Recent snatches |
| `/mbb_events` | Recent events |
| `/mbb_filters` | List filters |
| `/mbb_wishlist` | List wishlist watches |
| `/mbb_wishlist_run` | Run a watch by id or name |
| `/mbb_setup_panel` | Deploy interactive control panel (role-gated) |

Mutating actions require the Discord role in `ALLOWED_ROLE_ID`.

## Optional portal IPC

Listens on `127.0.0.1:9998` (config `IPC_PORT`) for `{ "action": "deploy_panel", "channel_id": "..." }` from an external portal if you use one.

Optional `PORTAL_AUTH_CONFIG` in `config.json` points at a JSON file that may contain an auth token for portal heartbeats. Leave empty for standalone use.
