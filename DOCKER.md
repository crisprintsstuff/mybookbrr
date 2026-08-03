# Docker

## Quick start

```bash
cp .env.example .env
# set a strong BOOTSTRAP_ADMIN_PASSWORD
export BOOTSTRAP_ADMIN_PASSWORD='your-secure-password'
docker compose up -d --build
```

UI: http://127.0.0.1:7480

Sign in as `admin` with the bootstrap password, then change it if prompted.

## Volumes

| Volume / path | Purpose |
|---------------|---------|
| `mbb_data` → `/app/data` | SQLite DB, backups, logs |
| `mbb_downloads` → `/app/downloads` | Optional watch-folder mode |

## qBittorrent on the host

The compose file adds `host.docker.internal` via `extra_hosts`.

In **Connections → Download client**, set host to:

```text
http://host.docker.internal:8080
```

(or your LAN IP). On pure Linux without Docker Desktop, that host entry is already set to `host-gateway`.

## Environment

Pass through from `.env` or compose `environment:` — see [`.env.example`](.env.example).

Common production flags:

```bash
COOKIE_SECURE=true
TRUST_PROXY=true
CORS_ORIGINS=https://mybookbrr.example.com
```

## Reverse proxy

Point TLS to `127.0.0.1:7480`. Forward `Host` and `X-Forwarded-Proto`. WebSockets are not required for core UI; SSE event stream uses long-lived HTTP.

## Health

Container healthcheck hits `/api/auth/me` (returns 401 when logged out — ensure your healthcheck treats that as healthy, or use `/api/v1/health` if you switch the Dockerfile check).

Current Dockerfile:

```text
curl -f http://localhost:7480/api/auth/me || exit 1
```

`/api/v1/health` is a better liveness target (no auth). You can override:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:7480/api/v1/health"]
```

## Multi-arch

Images build on the architecture you run `docker compose build` on (amd64 / arm64). For Raspberry Pi, build on the Pi or use `docker buildx` with `linux/arm64`.
