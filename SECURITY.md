# Security policy

## Supported versions

Security fixes are applied on a best-effort basis to the latest `main` branch and tagged releases when published.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for sensitive reports.

Prefer a private channel (email the repository owner, or GitHub Security Advisories if enabled on the repo). Include:

- Affected version / commit
- Steps to reproduce
- Impact (auth bypass, secret leak, RCE, etc.)

## Self-hosters: secrets checklist

| Secret | Where it lives | Notes |
|--------|----------------|--------|
| Admin password | SQLite `users` table after bootstrap | Change away from `changeme` immediately |
| `mam_id` cookie | Settings UI / SQLite `settings` | **Dedicated MAM security session only** — never share with browser, Autobrr, or other apps |
| qBittorrent password | Settings (encrypted at rest as stored value) | Prefer a local-only qBit WebUI |
| Discord / OIDC client secrets | `.env` | Never commit `.env` |
| API keys (`mbb_…`) | Created in UI; raw key shown once | Scope narrowly for bots |
| Session cookie | `mbb_session` httpOnly | Set `COOKIE_SECURE=true` behind HTTPS |

`.env`, `data/*`, and `downloads/*` are gitignored by default. Do not force-add them.

## Hardening recommendations

1. Bind to loopback and put a reverse proxy (Caddy/nginx/Traefik) in front for TLS.
2. Use `TRUST_PROXY=true` only when the proxy strips/sets `X-Forwarded-*` correctly.
3. Prefer password login + optional OIDC/Discord; keep API keys out of chat logs.
4. Keep MyBookBRR and qBittorrent off the public internet when possible (VPN / Tailscale / tunnel auth).
5. Rotate `mam_id` if you suspect compromise; create a fresh MAM security session.

## Scope of this project

MyBookBRR is a **self-hosted automation client** for users who already have legitimate MyAnonamouse access. It does not distribute tracker content. Follow MAM rules and your local laws.
