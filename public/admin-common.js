let csrfToken = "";

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  const r = await fetch("/api/csrf", { method: "GET" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Failed to fetch CSRF token (${r.status})`);
  csrfToken = String(data?.csrfToken || "");
  if (!csrfToken) throw new Error("Missing CSRF token");
  return csrfToken;
}

async function ensureAdmin() {
  const r = await fetch("/api/auth/me");
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return (location.href = "/login");
  if (data?.user?.role !== "admin") return (location.href = "/app");
  return data.user;
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(method, url, body) {
  const m = String(method || "GET").toUpperCase();
  const isWrite = m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
  const token = isWrite ? await ensureCsrfToken() : "";
  const r = await fetch(url, {
    method,
    headers: body
      ? { "Content-Type": "application/json", ...(token ? { "X-CSRF-Token": token } : {}) }
      : token
        ? { "X-CSRF-Token": token }
        : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
  return data;
}

document.getElementById("logout")?.addEventListener("click", async () => {
  try {
    await api("POST", "/api/auth/logout");
  } catch {
    // ignore
  } finally {
    location.href = "/login";
  }
});

