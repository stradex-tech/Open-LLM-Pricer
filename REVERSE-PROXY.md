## Reverse proxy + HTTPS (secure setup)

This guide shows how to run Open LLM Pricer behind a reverse proxy so users access it via **HTTPS**, while the app itself can stay on plain HTTP inside your LAN.

## Goals

- Serve the UI over **HTTPS** (protects cookies + prevents sniffing/MITM).
- Keep the app reachable only from **trusted networks** (or only from the proxy).
- Set the correct app env vars so sessions/cookies behave properly.

## Recommended app environment variables

Set these in your `.env` (or container environment) when using a reverse proxy:

- `TRUST_PROXY=true`
  - Allows the app to safely honor proxy headers for client IP (rate limiting + audit logging).
- `COOKIE_SECURE=true`
  - Ensures the session cookie is only sent over HTTPS.

### Binding advice

- If the reverse proxy runs on the **same machine** as the app:
  - Set `LISTEN_HOST=127.0.0.1` so the app is only reachable via the proxy.
- If the reverse proxy runs on a **different machine**:
  - Keep `LISTEN_HOST=0.0.0.0`, but restrict inbound `3000/tcp` on the app host firewall to only the proxy’s IP/subnet.

## Nginx Proxy Manager (NPM) setup

### 1) Create a Proxy Host

In NPM, go to **Hosts → Proxy Hosts → Add Proxy Host**:

- **Domain Names**: `pricer.your.lan` (or any internal DNS name you control)
- **Scheme**: `http`
- **Forward Hostname / IP**: the app server LAN IP (example: `192.168.1.50`)
- **Forward Port**: `3000`

Options:

- **Block Common Exploits**: recommended
- **Websockets Support**: optional (this app doesn’t rely on websockets)

### 2) Enable HTTPS

In the same Proxy Host, go to the **SSL** tab:

- If you have a domain that can be validated, use **Let’s Encrypt**.
- Otherwise:
  - Use your LAN’s local CA (recommended), or
  - Use a self-signed cert (users will need to trust/accept it).

Enable:

- **Force SSL** (redirect HTTP → HTTPS)

Optional:

- **HTTP/2 Support**
- **HSTS** (only if you understand the impact; can be annoying on internal hostnames)

### 3) Firewall recommendation (important)

If the app is reachable on `0.0.0.0:3000`, limit access:

- Allow `3000/tcp` only from:
  - your reverse proxy host IP (best), or
  - trusted subnets (acceptable)

Do not expose `3000/tcp` broadly if you can avoid it—let the proxy be the public entry point.

## Generic reverse proxy (nginx) example

This is an example nginx server block (adjust hostnames/certs/paths):

```nginx
server {
  listen 443 ssl;
  server_name pricer.your.lan;

  ssl_certificate     /etc/ssl/certs/pricer.crt;
  ssl_certificate_key /etc/ssl/private/pricer.key;

  location / {
    proxy_pass http://192.168.1.50:3000;
    proxy_http_version 1.1;

    # Preserve host and client details
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Make sure the app has:

- `TRUST_PROXY=true`
- `COOKIE_SECURE=true`

## Notes and pitfalls

- **Initial setup token**: on first boot, the app prints `SETUP_TOKEN=...` to logs. You’ll still need that to create the initial admin at `/setup`.
- **Camera permissions**: browsers typically require **HTTPS** (or `http://localhost`) to allow camera access. Reverse proxy HTTPS solves this for LAN users.
- **If you get “Not logged in” loops behind the proxy**: double-check `COOKIE_SECURE=true` and that users are actually hitting `https://...` (not `http://...`).

