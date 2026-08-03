#!/usr/bin/env python3
"""MyBookBRR Discord control bot — talks to /api/v1 and heartbeats the portal."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from typing import Any, Optional

import aiohttp
import discord
import psutil
from discord import app_commands
from discord.ext import commands

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.log"),
            encoding="utf-8",
        ),
    ],
)
logger = logging.getLogger("mybookbrr_discord")

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        logger.error("Config not found at %s — copy config.example.json to config.json", CONFIG_PATH)
        sys.exit(1)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


config = load_config()
DISCORD_TOKEN = (config.get("DISCORD_TOKEN") or "").strip()
ALLOWED_ROLE_ID = int(config.get("ALLOWED_ROLE_ID") or 0)
MYBOOKBRR_URL = (
    config.get("MYBOOKBRR_URL") or config.get("NEWBOOKBOT_URL") or "http://127.0.0.1:7480"
).rstrip("/")
MYBOOKBRR_API_KEY = (
    config.get("MYBOOKBRR_API_KEY") or config.get("NEWBOOKBOT_API_KEY") or ""
).strip()
PORTAL_HEARTBEAT_URL = config.get("PORTAL_HEARTBEAT_URL", "http://localhost:5000/api/heartbeat")
BOT_ID = config.get("BOT_ID", "mybookbrr")
BOT_SOCKET_PORT = int(config.get("IPC_PORT") or config.get("BOT_SOCKET_PORT") or 9998)
# Optional path to JSON with flask_secret_key (or similar) for portal heartbeats.
# Leave unset / empty to skip portal auth headers.
PORTAL_AUTH_CONFIG = (config.get("PORTAL_AUTH_CONFIG") or "").strip()


def get_portal_auth_headers() -> dict[str, str]:
    if not PORTAL_AUTH_CONFIG:
        return {}
    try:
        with open(PORTAL_AUTH_CONFIG, "r", encoding="utf-8") as f:
            data = json.load(f)
        token = (data.get("flask_secret_key") or "").strip()
        if token:
            return {"X-Portal-Auth": token}
    except Exception as e:
        logger.warning("Could not load portal auth header: %s", e)
    return {}


def has_allowed_role(interaction: discord.Interaction) -> bool:
    if not ALLOWED_ROLE_ID:
        return True
    user = interaction.user
    roles = getattr(user, "roles", None)
    if not roles:
        return False
    return any(role.id == ALLOWED_ROLE_ID for role in roles)


async def deny_if_unauthorized(interaction: discord.Interaction) -> bool:
    """Return True if denied (caller should return)."""
    if has_allowed_role(interaction):
        return False
    msg = "Access denied: missing required management role."
    if interaction.response.is_done():
        await interaction.followup.send(msg, ephemeral=True)
    else:
        await interaction.response.send_message(msg, ephemeral=True)
    return True


# ----------------------------------------------------
# MyBookBRR /api/v1 client
# ----------------------------------------------------
async def mbb_request(
    method: str,
    path: str,
    *,
    json_data: Optional[dict] = None,
    params: Optional[dict] = None,
) -> tuple[Any, int]:
    url = f"{MYBOOKBRR_URL}/api/v1{path}"
    headers = {
        "Authorization": f"Bearer {MYBOOKBRR_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method,
                url,
                headers=headers,
                json=json_data,
                params=params,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as response:
                if response.status == 204:
                    return None, response.status
                ctype = response.headers.get("Content-Type", "")
                if "application/json" in ctype:
                    return await response.json(), response.status
                text = await response.text()
                try:
                    return json.loads(text), response.status
                except Exception:
                    return text, response.status
    except Exception as e:
        logger.error("MyBookBRR API error %s %s: %s", method, path, e)
        return None, 500


def status_embed(data: dict) -> discord.Embed:
    irc = data.get("irc") or {}
    wishlist = data.get("wishlist") or {}
    unsatisfied = data.get("unsatisfied") or {}
    joined = irc.get("joined")
    color = discord.Color.green() if joined else discord.Color.orange()
    if unsatisfied.get("active"):
        color = discord.Color.red()

    embed = discord.Embed(title="MyBookBRR status", color=color)
    embed.add_field(
        name="IRC",
        value=(
            f"{irc.get('phase') or ('joined' if joined else 'offline')}\n"
            f"`{irc.get('nick') or '?'}@{irc.get('host') or '?'}:{irc.get('port') or '?'}`\n"
            f"identified: {'yes' if irc.get('identified') else 'no'} · "
            f"joined: {'yes' if joined else 'no'}"
        ),
        inline=True,
    )
    wl_state = "polling" if wishlist.get("running") else ("idle" if wishlist.get("enabled") else "off")
    embed.add_field(
        name="Wishlist",
        value=f"{wl_state}\n{wishlist.get('lastPollResult') or 'no polls yet'}",
        inline=True,
    )
    embed.add_field(name="Snatches", value=str(data.get("snatchCount", 0)), inline=True)
    embed.add_field(
        name="MAM",
        value="configured" if data.get("mamConfigured") else "missing mam_id",
        inline=True,
    )
    if unsatisfied.get("active"):
        embed.add_field(
            name="Unsatisfied lockout",
            value=unsatisfied.get("message") or "active",
            inline=False,
        )
    last = data.get("lastAnnounce")
    if last:
        embed.add_field(
            name="Last announce",
            value=f"{last.get('author')} — {last.get('title')}\ntid {last.get('torrentId')} · {last.get('at')}",
            inline=False,
        )
    return embed


# ----------------------------------------------------
# Persistent control panel
# ----------------------------------------------------
class FilterDropdown(discord.ui.Select):
    def __init__(self, filters: list):
        options = []
        for f in filters[:25]:
            fid = str(f.get("id", ""))
            name = str(f.get("name") or "Unknown")[:80]
            enabled = bool(f.get("enabled", True))
            emoji = "🟢" if enabled else "🔴"
            options.append(
                discord.SelectOption(
                    label=f"{name}"[:100],
                    value=f"{fid}|{enabled}",
                    emoji=emoji,
                    description=("enabled" if enabled else "disabled")[:100],
                )
            )
        if not options:
            options.append(discord.SelectOption(label="No filters found", value="none"))
        super().__init__(
            placeholder="Select a filter to toggle…",
            min_values=1,
            max_values=1,
            options=options,
            custom_id="mbb:filter_select",
        )

    async def callback(self, interaction: discord.Interaction):
        if await deny_if_unauthorized(interaction):
            return
        await interaction.response.defer(ephemeral=True)
        if self.values[0] == "none":
            await interaction.followup.send("No filters available.", ephemeral=True)
            return
        filter_id, current = self.values[0].split("|", 1)
        new_state = current.lower() != "true"
        _, code = await mbb_request("PUT", f"/filters/{filter_id}", json_data={"enabled": new_state})
        if code in (200, 201, 204):
            await interaction.followup.send(
                f"Filter `{filter_id}` → {'enabled' if new_state else 'disabled'}.",
                ephemeral=True,
            )
            await self.view.refresh_panel(interaction.message)
        else:
            await interaction.followup.send(f"API error updating filter (HTTP {code}).", ephemeral=True)


class IrcButton(discord.ui.Button):
    def __init__(self, action: str):
        if action == "start":
            super().__init__(
                label="Start IRC",
                style=discord.ButtonStyle.success,
                custom_id="mbb:irc_start",
                emoji="▶️",
            )
        else:
            super().__init__(
                label="Stop IRC",
                style=discord.ButtonStyle.danger,
                custom_id="mbb:irc_stop",
                emoji="⏹️",
            )
        self.action = action

    async def callback(self, interaction: discord.Interaction):
        if await deny_if_unauthorized(interaction):
            return
        await interaction.response.defer(ephemeral=True)
        path = "/irc/start" if self.action == "start" else "/irc/stop"
        data, code = await mbb_request("POST", path, json_data={})
        if code in (200, 201, 204):
            phase = (data or {}).get("phase") if isinstance(data, dict) else None
            await interaction.followup.send(
                f"IRC {self.action} OK{f' ({phase})' if phase else ''}.",
                ephemeral=True,
            )
            await self.view.refresh_panel(interaction.message)
        else:
            await interaction.followup.send(f"IRC {self.action} failed (HTTP {code}).", ephemeral=True)


class RefreshButton(discord.ui.Button):
    def __init__(self):
        super().__init__(
            label="Refresh",
            style=discord.ButtonStyle.primary,
            custom_id="mbb:refresh",
            emoji="🔄",
        )

    async def callback(self, interaction: discord.Interaction):
        if await deny_if_unauthorized(interaction):
            return
        await interaction.response.defer(ephemeral=True)
        await self.view.refresh_panel(interaction.message)
        await interaction.followup.send("Panel refreshed.", ephemeral=True)


class MyBookControlView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    async def refresh_panel(self, message: discord.Message):
        status_data, status_code = await mbb_request("GET", "/status")
        filters_data, filters_code = await mbb_request("GET", "/filters")
        if filters_code != 200 or not isinstance(filters_data, list):
            filters_data = []

        self.clear_items()
        self.add_item(FilterDropdown(filters_data))
        self.add_item(IrcButton("start"))
        self.add_item(IrcButton("stop"))
        self.add_item(RefreshButton())

        if status_code == 200 and isinstance(status_data, dict):
            embed = status_embed(status_data)
            embed.title = "MyBookBRR control panel"
        else:
            embed = discord.Embed(
                title="MyBookBRR control panel",
                description=f"Could not load status (HTTP {status_code}).",
                color=discord.Color.red(),
            )

        lines = []
        for f in filters_data[:12]:
            icon = "🟢" if f.get("enabled") else "🔴"
            lines.append(f"{icon} **{f.get('name')}** (`{f.get('id')}`)")
        if lines:
            embed.add_field(name="Filters", value="\n".join(lines)[:1024], inline=False)
        embed.set_footer(text="Toggle filters · IRC start/stop · authorized role only")
        await message.edit(embed=embed, view=self)



async def build_control_panel():
    """Shared embed+view for slash deploy and portal IPC."""
    status_data, status_code = await mbb_request("GET", "/status")
    filters_data, filters_code = await mbb_request("GET", "/filters")
    if filters_code != 200 or not isinstance(filters_data, list):
        filters_data = []

    view = MyBookControlView()
    view.add_item(FilterDropdown(filters_data))
    view.add_item(IrcButton("start"))
    view.add_item(IrcButton("stop"))
    view.add_item(RefreshButton())

    if status_code == 200 and isinstance(status_data, dict):
        embed = status_embed(status_data)
        embed.title = "MyBookBRR control panel"
    else:
        embed = discord.Embed(
            title="MyBookBRR control panel",
            description=f"Could not load status (HTTP {status_code}).",
            color=discord.Color.red(),
        )

    lines = []
    for f in filters_data[:12]:
        icon = "🟢" if f.get("enabled") else "🔴"
        lines.append(f"{icon} **{f.get('name')}** (`{f.get('id')}`)")
    if lines:
        embed.add_field(name="Filters", value="\n".join(lines)[:1024], inline=False)
    embed.set_footer(text="Toggle filters · IRC start/stop · authorized role only")
    return embed, view, status_code


# ----------------------------------------------------
# Bot core
# ----------------------------------------------------
class MyBookBrrBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)

    async def setup_hook(self):
        view = MyBookControlView()
        view.add_item(FilterDropdown([]))
        view.add_item(IrcButton("start"))
        view.add_item(IrcButton("stop"))
        view.add_item(RefreshButton())
        self.add_view(view)
        await self.tree.sync()
        logger.info("Slash commands and persistent views synced.")
        self.loop.create_task(self.start_dashboard_heartbeat())
        self.loop.create_task(self.start_web_listener())

    async def start_web_listener(self):
        """Local IPC for portal panel deploy (autobrr parity)."""
        server = await asyncio.start_server(self.handle_web_request, "127.0.0.1", BOT_SOCKET_PORT)
        logger.info("IPC communication backend actively routing via port %s", BOT_SOCKET_PORT)
        async with server:
            await server.serve_forever()

    async def handle_web_request(self, reader, writer):
        data = await reader.read(4096)
        try:
            req = json.loads(data.decode())
            action = req.get("action")
            if action == "deploy_panel":
                channel_id = int(req.get("channel_id"))
                channel = self.get_channel(channel_id) or await self.fetch_channel(channel_id)
                embed, view, status_code = await build_control_panel()
                if status_code != 200:
                    response = {
                        "status": "error",
                        "message": f"Cannot reach MyBookBRR API (HTTP {status_code}).",
                    }
                else:
                    await channel.send(embed=embed, view=view)
                    response = {
                        "status": "success",
                        "message": "MyBookBRR control panel deployed.",
                    }
            else:
                response = {"status": "error", "message": "Unknown IPC action."}
        except Exception as e:
            response = {"status": "error", "message": f"Execution failed: {e}"}

        writer.write(json.dumps(response).encode())
        await writer.drain()
        writer.close()

    async def start_dashboard_heartbeat(self):
        await self.wait_until_ready()
        logger.info("Dashboard heartbeat started → %s", PORTAL_HEARTBEAT_URL)
        start_time = time.time()
        process = psutil.Process(os.getpid())
        process.cpu_percent(interval=None)
        banner_url = None
        try:
            user_profile = await self.fetch_user(self.user.id)
            if user_profile.banner:
                banner_url = str(user_profile.banner.url)
        except Exception as e:
            logger.warning("Could not fetch banner: %s", e)

        async with aiohttp.ClientSession() as session:
            while not self.is_closed():
                try:
                    payload = {
                        "bot_id": BOT_ID,
                        "status": "online",
                        "ping": round(self.latency * 1000, 2) if self.latency else 0.0,
                        "guilds": len(self.guilds),
                        "users": sum(g.member_count for g in self.guilds if g.member_count) if self.guilds else 0,
                        "username": str(self.user),
                        "uptime": int(time.time() - start_time),
                        "memory_mb": round(process.memory_info().rss / (1024 * 1024), 2),
                        "cpu_percent": round(process.cpu_percent(interval=None), 2),
                        "avatar_url": str(self.user.display_avatar.url) if self.user else None,
                        "banner_url": banner_url,
                    }
                    async with session.post(
                        PORTAL_HEARTBEAT_URL,
                        json=payload,
                        headers=get_portal_auth_headers(),
                        timeout=aiohttp.ClientTimeout(total=5),
                    ) as response:
                        if response.status != 200:
                            logger.warning("Heartbeat HTTP %s", response.status)
                except Exception as e:
                    logger.error("Heartbeat error: %s", e)
                await asyncio.sleep(10)


bot = MyBookBrrBot()


@bot.event
async def on_ready():
    logger.info("Logged in as %s (%s)", bot.user, bot.user.id if bot.user else "?")


# ----------------------------------------------------
# Slash commands
# ----------------------------------------------------
@bot.tree.command(name="mbb_status", description="MyBookBRR IRC / wishlist / snatch status")
async def mbb_status(interaction: discord.Interaction):
    await interaction.response.defer()
    data, code = await mbb_request("GET", "/status")
    if code != 200 or not isinstance(data, dict):
        await interaction.followup.send(f"Failed to fetch status (HTTP {code}).")
        return
    await interaction.followup.send(embed=status_embed(data))


@bot.tree.command(name="mbb_irc", description="Start or stop MyBookBRR IRC announce listener")
@app_commands.describe(action="start or stop IRC")
@app_commands.choices(
    action=[
        app_commands.Choice(name="start", value="start"),
        app_commands.Choice(name="stop", value="stop"),
    ]
)
async def mbb_irc(interaction: discord.Interaction, action: app_commands.Choice[str]):
    if await deny_if_unauthorized(interaction):
        return
    await interaction.response.defer(ephemeral=True)
    path = "/irc/start" if action.value == "start" else "/irc/stop"
    data, code = await mbb_request("POST", path, json_data={})
    if code in (200, 201, 204):
        phase = (data or {}).get("phase") if isinstance(data, dict) else None
        await interaction.followup.send(
            f"IRC {action.value} OK{f' — phase: {phase}' if phase else ''}.",
            ephemeral=True,
        )
    else:
        err = data.get("error") if isinstance(data, dict) else data
        await interaction.followup.send(f"Failed (HTTP {code}): {err}", ephemeral=True)


@bot.tree.command(
    name="mbb_unsatisfied_clear",
    description="Clear MAM unsatisfied-limit lockout and optionally re-enable filters",
)
@app_commands.describe(reenable_filters="Re-enable filters that were auto-disabled (default: yes)")
async def mbb_unsatisfied_clear(
    interaction: discord.Interaction,
    reenable_filters: Optional[bool] = True,
):
    if await deny_if_unauthorized(interaction):
        return
    await interaction.response.defer(ephemeral=True)
    data, code = await mbb_request(
        "POST",
        "/filters/unsatisfied/clear",
        json_data={"reenableFilters": bool(reenable_filters if reenable_filters is not None else True)},
    )
    if code not in (200, 201):
        err = data.get("error") if isinstance(data, dict) else data
        await interaction.followup.send(f"Failed (HTTP {code}): {err}", ephemeral=True)
        return
    reenabled = (data or {}).get("reenabled", 0) if isinstance(data, dict) else 0
    enabled = (data or {}).get("enabledCount", "?") if isinstance(data, dict) else "?"
    active = ((data or {}).get("unsatisfied") or {}).get("active") if isinstance(data, dict) else None
    await interaction.followup.send(
        f"Lockout cleared. Re-enabled {reenabled} filter(s); {enabled} enabled now"
        f"{' · still active? ' + str(active) if active is not None else ''}.",
        ephemeral=True,
    )


@bot.tree.command(name="mbb_snatches", description="Recent MyBookBRR snatches")
@app_commands.describe(limit="How many to show (default 10, max 25)")
async def mbb_snatches(interaction: discord.Interaction, limit: Optional[int] = 10):
    await interaction.response.defer()
    limit = max(1, min(25, int(limit or 10)))
    data, code = await mbb_request("GET", "/snatches", params={"limit": str(limit)})
    if code != 200 or not isinstance(data, list):
        await interaction.followup.send(f"Failed to fetch snatches (HTTP {code}).")
        return
    if not data:
        await interaction.followup.send("No snatches recorded yet.")
        return
    embed = discord.Embed(title=f"Recent snatches ({len(data[:limit])})", color=discord.Color.blue())
    for s in data[:limit]:
        title = s.get("title") or s.get("torrentId") or "—"
        author = s.get("author") or ""
        when = s.get("createdAt") or s.get("snatchedAt") or ""
        tid = s.get("torrentId") or ""
        embed.add_field(
            name=f"{author} — {title}"[:256],
            value=f"tid `{tid}` · {when}"[:1024],
            inline=False,
        )
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="mbb_events", description="Recent MyBookBRR events")
@app_commands.describe(limit="How many to show (default 10, max 25)")
async def mbb_events(interaction: discord.Interaction, limit: Optional[int] = 10):
    await interaction.response.defer()
    limit = max(1, min(25, int(limit or 10)))
    data, code = await mbb_request("GET", "/events", params={"limit": str(limit)})
    if code != 200 or not isinstance(data, list):
        await interaction.followup.send(f"Failed to fetch events (HTTP {code}).")
        return
    if not data:
        await interaction.followup.send("No events yet.")
        return
    # API often returns oldest-first; show newest
    items = list(reversed(data[-limit:])) if data else []
    embed = discord.Embed(title=f"Recent events ({len(items)})", color=discord.Color.dark_teal())
    for ev in items:
        etype = ev.get("type") or "?"
        when = ev.get("createdAt") or ""
        payload = ev.get("payload") or {}
        release = payload.get("release") or {}
        summary = (
            f"{release.get('author', '')} — {release.get('title', '')}".strip(" —")
            or payload.get("reason")
            or payload.get("error")
            or json.dumps(payload)[:120]
        )
        embed.add_field(name=f"{etype} · {when}"[:256], value=str(summary)[:1024] or "—", inline=False)
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="mbb_filters", description="List MyBookBRR filters")
async def mbb_filters(interaction: discord.Interaction):
    await interaction.response.defer()
    data, code = await mbb_request("GET", "/filters")
    if code != 200 or not isinstance(data, list):
        await interaction.followup.send(f"Failed to fetch filters (HTTP {code}).")
        return
    if not data:
        await interaction.followup.send("No filters configured.")
        return
    embed = discord.Embed(title=f"Filters ({len(data)})", color=discord.Color.dark_grey())
    for f in data[:25]:
        icon = "🟢" if f.get("enabled") else "🔴"
        pri = f.get("priority", "?")
        embed.add_field(
            name=f"{icon} {f.get('name')}"[:256],
            value=f"id `{f.get('id')}` · priority {pri}"[:1024],
            inline=False,
        )
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="mbb_wishlist", description="List MyBookBRR wishlist watches")
async def mbb_wishlist(interaction: discord.Interaction):
    await interaction.response.defer()
    data, code = await mbb_request("GET", "/wishlist")
    if code != 200 or not isinstance(data, list):
        await interaction.followup.send(f"Failed to fetch wishlist (HTTP {code}).")
        return
    if not data:
        await interaction.followup.send("No wishlist watches.")
        return
    embed = discord.Embed(title=f"Wishlist ({len(data)})", color=discord.Color.purple())
    for w in data[:25]:
        icon = "🟢" if w.get("enabled") else "🔴"
        detail = " · ".join(
            x for x in [w.get("query"), w.get("author"), w.get("series")] if x
        ) or "—"
        last = w.get("lastRunAt") or "never"
        embed.add_field(
            name=f"{icon} {w.get('name')}"[:256],
            value=f"`{w.get('id')}` · {detail}\nlast: {last}\n{w.get('lastResult') or ''}"[:1024],
            inline=False,
        )
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="mbb_wishlist_run", description="Run a wishlist watch by id or name")
@app_commands.describe(watch="Watch id or exact name")
async def mbb_wishlist_run(interaction: discord.Interaction, watch: str):
    if await deny_if_unauthorized(interaction):
        return
    await interaction.response.defer(ephemeral=True)
    watches, code = await mbb_request("GET", "/wishlist")
    if code != 200 or not isinstance(watches, list):
        await interaction.followup.send(f"Could not list watches (HTTP {code}).", ephemeral=True)
        return
    needle = watch.strip().lower()
    match = next(
        (
            w
            for w in watches
            if str(w.get("id", "")).lower() == needle or str(w.get("name", "")).lower() == needle
        ),
        None,
    )
    if not match:
        await interaction.followup.send(f"No watch matching `{watch}`.", ephemeral=True)
        return
    data, run_code = await mbb_request("POST", f"/wishlist/{match['id']}/run", json_data={})
    if run_code in (200, 201, 204):
        result = (data or {}).get("lastResult") if isinstance(data, dict) else None
        await interaction.followup.send(
            f"Ran **{match.get('name')}** (`{match.get('id')}`)"
            + (f"\n{result}" if result else ""),
            ephemeral=True,
        )
    else:
        err = data.get("error") if isinstance(data, dict) else data
        await interaction.followup.send(f"Run failed (HTTP {run_code}): {err}", ephemeral=True)


@bot.tree.command(name="mbb_setup_panel", description="Deploy MyBookBRR interactive control panel")
@app_commands.describe(target_channel="Channel for the management panel")
async def mbb_setup_panel(interaction: discord.Interaction, target_channel: discord.TextChannel):
    if await deny_if_unauthorized(interaction):
        return
    await interaction.response.defer(ephemeral=True)
    embed, view, status_code = await build_control_panel()
    if status_code != 200:
        await interaction.followup.send(
            f"Cannot reach MyBookBRR API (status HTTP {status_code}). Check URL/API key.",
            ephemeral=True,
        )
        return
    await target_channel.send(embed=embed, view=view)
    await interaction.followup.send(f"Control panel deployed to {target_channel.mention}.", ephemeral=True)



def main():
    if not DISCORD_TOKEN:
        logger.error("DISCORD_TOKEN is empty in config.json")
        sys.exit(1)
    if not MYBOOKBRR_API_KEY:
        logger.warning("MYBOOKBRR_API_KEY is empty — API calls will fail until set")
    bot.run(DISCORD_TOKEN)


if __name__ == "__main__":
    main()
