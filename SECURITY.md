## Security overview

This project is designed for **LAN/self-hosted** deployments. It ships with several security controls enabled by default, plus clear knobs for reverse-proxy + HTTPS setups.

## Threat model (practical)

- **In-scope**: accidental exposure on a LAN, opportunistic access from other machines on the subnet, basic web attacks (CSRF, session fixation), accidental secret exposure via misconfiguration.
- **Out-of-scope**: a fully hostile internet deployment without a firewall/reverse proxy, kernel/container escapes, compromised host.

## Secrets and sensitive data

- **Keep secrets local**:
  - Store secrets in a local `.env` file or environment variables.
  - Treat `data/` as sensitive: it contains the SQLite DB, sessions, and generated secrets.

- **Session signing secret (`SESSION_SECRET`)**
  - Required for stable sessions.
  - If missing/weak, the server generates a strong secret and persists it to `./data/session_secret.txt` (mode `0600`).

## First-run admin takeover protection

Creating the initial admin is protected by a **one-time setup token**:

- On first boot (when no admin exists), the server prints:
  - `SETUP_TOKEN=...`
- `/api/setup/admin` requires this token (supplied by the `/setup` UI).
- Token is persisted best-effort to `./data/setup_token.txt` (mode `0600`).

This prevents a “race” where another LAN user claims the admin account before you finish setup.

## Authentication and sessions

- **Passwords**: bcrypt-hashed (`bcryptjs`).
- **Session cookie** (`express-session`):
  - `httpOnly: true`
  - `sameSite: "lax"`
  - `secure: COOKIE_SECURE === "true"` (enable when serving via HTTPS)
- **Session fixation mitigation**:
  - Session ID is regenerated on login and on initial setup.
- **Privilege-change rotation**:
  - If a user’s `role` or `updated_at` changes in the DB, the next authenticated request rotates the session ID (and preserves CSRF token).

## CSRF protection

- Server generates a per-session CSRF token.
- Client fetches it from `GET /api/csrf`.
- All state-changing `/api/*` requests must include `X-CSRF-Token`.

## Browser security headers / CSP

The server sets:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`
- **CSP**:
  - `script-src 'self'`
  - `style-src 'self'`

The UI avoids inline scripts/styles and avoids `document.write()` in order to keep CSP strict.

## Rate limiting and audit logging

- **Rate limiting**:
  - Login endpoints have per-IP and per-username+IP limits.
  - Pricing endpoint has a conservative limiter (requests are expensive).
- **Audit logs**:
  - Login/logout, pricing requests, admin actions are written to SQLite.
  - Retention caps are available via `AUDIT_LOG_MAX_ROWS` and `AUDIT_LOG_MAX_AGE_DAYS`.

## Reverse proxy / HTTPS guidance

When running behind a reverse proxy (Nginx Proxy Manager, nginx, Caddy, Traefik):

- Set:
  - `TRUST_PROXY=true`
  - `COOKIE_SECURE=true`
- Terminate TLS at the proxy and forward to the app via HTTP on the LAN.
- If proxy and app are on the same host, consider `LISTEN_HOST=127.0.0.1` so the app is only reachable via the proxy.

### X-Forwarded-For safety

This project **only trusts** `X-Forwarded-For` when `TRUST_PROXY=true`. Otherwise, it uses the direct socket IP.

## Container hardening

- Docker image installs `su-exec` and drops privileges to an unprivileged `app` user at runtime.

## Known limitations / operational notes

- If you bind to `LISTEN_HOST=0.0.0.0`, the app is reachable on the LAN. Use firewall rules / subnet segmentation.
- The probe endpoint (`/api/ollama`) can reveal connectivity/model info; it requires a logged-in session and should still be kept LAN-only if deploying more broadly.

