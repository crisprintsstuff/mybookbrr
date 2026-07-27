# MyBookBRR Discord Bot

Lives in the MyBookBRR monorepo under `discord-bot/`. Talks to the local `/api/v1` API and heartbeats the OmegaBot portal.

## Setup

1. Create a Discord application + bot; invite with `applications.commands` + `bot`.

2. In MyBookBRR UI → **API Keys**, create a key with scopes:

   `status:read`, `filters:read`, `filters:write`, `wishlist:read`, `wishlist:write`, `history:read`, `events:read`, `irc:control`

3. Configure and run:

   ```bash
   cd /home/cris/newprojects/mybookbrr/discord-bot
   cp config.example.json config.json
   # edit DISCORD_TOKEN + MYBOOKBRR_API_KEY
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   python bot.py
   ```

4. Portal: entry id `mybookbrr` points at this directory (or the symlink at `/home/cris/discordbots/mybookbrr`).

## Commands

| Command | Description |
|---------|-------------|
| `/mbb_status` | IRC, wishlist, snatch count, unsatisfied lockout |
| `/mbb_irc` | Start or stop IRC |
| `/mbb_snatches` | Recent snatches |
| `/mbb_events` | Recent events |
| `/mbb_filters` | List filters |
| `/mbb_wishlist` | List wishlist watches |
| `/mbb_wishlist_run` | Run a watch by id or name |
| `/mbb_setup_panel` | Deploy interactive control panel (role-gated) |

Mutating actions require the Discord role in `ALLOWED_ROLE_ID`.
