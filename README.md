# Open LLM Pricer

Simple web app that uses your **local Ollama vision model** to estimate used/new resale prices from a webcam photo.

## What it outputs

Each photo starts a **fresh** Ollama chat and returns prices in tiers:

```
Rough: $$
Good: $$
Best: $$
New: $$
```

- Rough = 50% of used price
- Good = 25% off used price (75% of used)
- Best = used price
- New = sold-as-new price

> Note: these tier percentages are configurable in the admin console (`/admin` → Pricing rules).

## UI features

- Webcam preview + **Last capture** thumbnail
- Optional hint inputs: **Brand / Model / SKU**
- Press **Spacebar** to take a picture (won’t trigger while typing in inputs)
- Double-click the live camera view to take a picture
- Output card with **confidence** badge
- Admin console supports **CSV user import**

## Guardrails

- **Price cap**: prices above **$20** are only allowed when either:
  - the user provides Brand/Model/SKU, **or**
  - the model reports it can clearly see identifying text/labels in the image (`identifiers_seen: true`)
- **Hint consistency**: if Brand/Model/SKU is provided, the returned object name is forced to stay consistent with those hints

## Features (so far)

- **Pricing UI**
  - Webcam capture + last capture preview
  - Optional hints: Brand / Model / SKU
  - Spacebar capture shortcut (won’t trigger while typing)
  - Double-click capture on the live camera view
  - Confidence badge and printable price labels
  - Pricing memory (cache) to stabilize repeated scans
- **Auth + roles**
  - First-run **admin setup** flow (`/setup`)
  - Login (`/login`) with **admin/user** roles
  - Admin UI: Pricing rules (`/admin`), Users (`/admin/users`), Audit logs (`/admin/audit`)
  - User UI (`/app`)
  - Passwords are **bcrypt-hashed**; sessions use secure cookie defaults
- **Admin console**
  - Create/update/disable users
  - Bulk **CSV user import**
  - Configure pricing rules (price cap + extra prompt rules)
  - Configure tier percentages for Rough/Good/Best/New
  - Configure pricing memory retention (default **7 days**)
- **Audit logging**
  - Admin audit view and user “my activity” view
  - Retention controls via env vars

## Requirements

- Docker / Docker Compose
- Ollama running and reachable from the web server
- A **vision-capable** Ollama model pulled (set `OLLAMA_MODEL`)

## Full setup guide

See `SETUP_SINGLE_MACHINE.md` for step-by-step instructions to set up **Ollama + Open LLM Pricer** on one machine.

## One-time Ollama setup

Start Ollama and pull your model (example):

```bash
ollama serve
ollama pull ministral-3:8b
```

## Quickstart (one-liner)

With Ollama already running on `http://localhost:11434`:

```bash
curl -fsSL "https://github.com/stradex-tech/Open-LLM-Pricer/archive/refs/heads/main.tar.gz" | tar -xz && cd "Open-LLM-Pricer-main" && docker compose build && docker compose up
```

## Run with Docker Compose (Linux host networking)

```bash
docker compose build
docker compose up
```

Open `http://localhost:3000`.

### (Recommended) Create a local `.env` for stable sessions

```bash
cd "/path/to/Open-LLM-Pricer"
cp .env.example .env
sed -i "s|^SESSION_SECRET=.*$|SESSION_SECRET=$(openssl rand -hex 32)|" .env
```

### First-run setup token

On first boot (when no admin exists), the server prints a **setup token** to the `docker compose up` logs:

- `SETUP_TOKEN=...`

You must paste it into `/setup` to create the initial admin account.

### Run behind a reverse proxy (HTTPS)

See `REVERSE-PROXY.md`.

### Persistence

User accounts, sessions, and admin rules are stored in a SQLite DB at:

- `./data/app.db`

This is mounted into the container via Docker Compose.

### Ollama connectivity notes (Linux)

This compose file uses **host networking** (`network_mode: "host"`), so `OLLAMA_BASE_URL` is set to:

- `http://localhost:11434`

If Ollama runs elsewhere, change `OLLAMA_BASE_URL` accordingly (example: `http://192.168.1.50:11434`).

Env vars:

- `PORT` (default `3000`)
- `SESSION_SECRET` (recommended; used to sign login sessions. If unset, a strong secret is generated and persisted under `./data/session_secret.txt`.)
- `LISTEN_HOST` (default `0.0.0.0`; firewall to trusted subnets)
- `TRUST_PROXY` (set `true` behind a reverse proxy)
- `COOKIE_SECURE` (set `true` when serving via HTTPS)
- `OLLAMA_BASE_URL` (default `http://host.docker.internal:11434`, for Docker)
- `OLLAMA_MODEL` (default `ministral-3:8b`)

## Credits

This project is built with:

- **[Ollama](https://ollama.com/)** (local LLM runtime + API)
- **[Node.js](https://nodejs.org/)** (runtime)
- **[Express](https://expressjs.com/)** (web server)
- **Docker / Docker Compose** (containerized deployment)

## Third-party notices

See `THIRD_PARTY_NOTICES.md`.

