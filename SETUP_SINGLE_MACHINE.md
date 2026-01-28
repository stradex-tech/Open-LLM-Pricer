# Single-machine setup (Ollama + Open LLM Pricer)

These steps set everything up on **one machine** using Docker for the web app. Ollama can be installed normally (recommended).

## 1) Install prerequisites

- **Docker + Docker Compose**
- **Ollama** installed on the host

## 2) Start Ollama and pull a vision model

```bash
ollama serve
ollama pull ministral-3:8b
```

Verify Ollama works:

```bash
curl -sSf http://localhost:11434/api/tags
```

## 3) Run Open LLM Pricer (Docker)

From the project folder:

Optional (recommended): create a local `.env` file (not committed) to persist sessions across restarts:

```bash
cd "/path/to/Open-LLM-Pricer"
cp .env.example .env
sed -i "s|^SESSION_SECRET=.*$|SESSION_SECRET=$(openssl rand -hex 32)|" .env
```

If you skip this, the app will auto-generate a random `SESSION_SECRET` on startup (sessions reset on restart).

```bash
docker compose down
docker compose build
docker compose up
```

Open:

- `http://localhost:3000`

### First-time admin setup

On first run (when no admin exists), visiting `http://localhost:3000` will redirect you to:

- `/setup`

Create the admin user there, then you’ll be sent to the admin console.

#### Setup token (first run)

On first boot, the server prints a **one-time setup token** to the `docker compose up` logs:

- `SETUP_TOKEN=...`

Copy/paste that value into the **Setup token** field on `/setup` to create the initial admin.

> The token is also persisted (best-effort) to `./data/setup_token.txt` so it survives restarts.

#### LAN exposure

By default, the web server binds to **0.0.0.0** so other machines on your LAN can access it.
Make sure your host firewall only allows the subnets you intend.

If you want to restrict access to the local machine only, set:

- `LISTEN_HOST=127.0.0.1` (in `.env`)

#### Run behind a reverse proxy (HTTPS)

See `REVERSE-PROXY.md`.

## Troubleshooting

- **Camera blocked**: use `http://localhost` or HTTPS so the browser allows webcam access.

