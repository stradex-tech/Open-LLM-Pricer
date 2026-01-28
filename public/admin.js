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

async function loadUsers(me) {
  const box = document.getElementById("usersTable");
  const msg = document.getElementById("usersMsg");
  if (msg) msg.textContent = "";
  const data = await api("GET", "/api/admin/users");
  const users = data?.users || [];

  const rows = users
    .map((u) => {
      const disabled = u.disabled ? "Yes" : "No";
      const isSelf = me && u.id === me.id;
      return `
        <div class="priceCell uGrid uGap8">
          <div class="uFlex uJustifyBetween uGap10 uAlignBaseline">
            <div class="uFw800">${esc(u.username)}</div>
            <div class="sourceMeta">id ${esc(u.id)}</div>
          </div>
          <div class="sourceMeta">role: <b>${esc(u.role)}</b> · disabled: <b>${disabled}</b></div>
          <div class="uFlex uWrap uGap8 uAlignCenter">
            <label class="sourceMeta">Role:</label>
            <select data-role="${esc(u.id)}" class="adminControl adminSelect">
              <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
            </select>
            <label class="sourceMeta">Disabled:</label>
            <select data-disabled="${esc(u.id)}" class="adminControl adminSelect">
              <option value="0" ${u.disabled ? "" : "selected"}>no</option>
              <option value="1" ${u.disabled ? "selected" : ""}>yes</option>
            </select>
            <input data-pass="${esc(u.id)}" placeholder="New password (optional)" type="password" class="adminControl adminInput uFlex1 uMinW180" />
            <button data-save="${esc(u.id)}" class="ghostBtn" type="button" ${isSelf ? "" : ""}>Save</button>
          </div>
        </div>
      `;
    })
    .join("");

  if (box) {
    box.innerHTML = `<div class="priceGrid oneCol">${rows}</div>`;

    box.querySelectorAll("[data-save]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-save");
        const roleEl = box.querySelector(`[data-role="${CSS.escape(id)}"]`);
        const disEl = box.querySelector(`[data-disabled="${CSS.escape(id)}"]`);
        const passEl = box.querySelector(`[data-pass="${CSS.escape(id)}"]`);
        const body = {
          role: roleEl?.value,
          disabled: disEl?.value === "1",
          password: passEl?.value || ""
        };
        if (msg) msg.textContent = "Saving...";
        try {
          await api("PUT", `/api/admin/users/${id}`, body);
          if (msg) msg.textContent = "Saved.";
          await loadUsers(me);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (msg) msg.textContent = `Error: ${message}`;
        }
      });
    });
  }
}

async function loadRules() {
  const msg = document.getElementById("rulesMsg");
  if (msg) msg.textContent = "";
  const data = await api("GET", "/api/admin/rules");
  const maxPrice = document.getElementById("maxPrice");
  const retentionDays = document.getElementById("priceMemoryRetentionDays");
  const extraRules = document.getElementById("extraRules");
  const tierRough = document.getElementById("tierRoughPct");
  const tierGood = document.getElementById("tierGoodPct");
  const tierBest = document.getElementById("tierBestPct");
  const tierNew = document.getElementById("tierNewPct");
  if (maxPrice) maxPrice.value = data?.rules?.max_price_without_hints ?? 20;
  if (retentionDays) retentionDays.value = data?.rules?.price_memory_retention_days ?? 7;
  if (extraRules) extraRules.value = data?.rules?.prompt_extra_rules ?? "";
  if (tierRough) tierRough.value = data?.rules?.tier_rough_pct ?? 50;
  if (tierGood) tierGood.value = data?.rules?.tier_good_pct ?? 75;
  if (tierBest) tierBest.value = data?.rules?.tier_best_pct ?? 100;
  if (tierNew) tierNew.value = data?.rules?.tier_new_pct ?? 100;
}

let auditOffset = 0;

function fmtTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  try {
    return new Date(n * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

function safeJsonPreview(s) {
  try {
    const o = JSON.parse(String(s || "{}"));
    const str = JSON.stringify(o);
    return str.length > 220 ? str.slice(0, 220) + "…" : str;
  } catch {
    const str = String(s || "");
    return str.length > 220 ? str.slice(0, 220) + "…" : str;
  }
}

async function loadAudit({ reset } = {}) {
  const msg = document.getElementById("auditMsg");
  const box = document.getElementById("auditTable");
  const actor = document.getElementById("auditActor")?.value?.trim?.() || "";
  const action = document.getElementById("auditAction")?.value?.trim?.() || "";
  const limit = document.getElementById("auditLimit")?.value;

  if (reset) {
    auditOffset = 0;
    if (box) box.innerHTML = "";
  }

  if (msg) msg.textContent = auditOffset === 0 ? "Loading..." : "Loading more...";
  const qs = new URLSearchParams();
  qs.set("limit", String(limit || "50"));
  qs.set("offset", String(auditOffset));
  if (actor) qs.set("actor", actor);
  if (action) qs.set("action", action);

  try {
    const data = await api("GET", `/api/admin/audit?${qs.toString()}`);
    const logs = data?.logs || [];
    auditOffset += logs.length;

    const rows = logs
      .map((l) => {
        const actorText =
          l.actor_username != null && l.actor_username !== ""
            ? `${esc(l.actor_username)}`
            : l.actor_user_id != null
              ? `id ${esc(l.actor_user_id)}`
              : "—";
        const role = l.actor_role ? ` · <b>${esc(l.actor_role)}</b>` : "";
        const ok = l.success ? "ok" : "error";
        const detail = safeJsonPreview(l.details_json);
        return `
          <div class="priceCell uGrid uGap6">
            <div class="uFlex uJustifyBetween uGap10 uAlignBaseline">
              <div class="uFw800">${esc(l.action || "")}</div>
              <div class="sourceMeta">${esc(fmtTs(l.ts))}</div>
            </div>
            <div class="sourceMeta">actor: <b>${actorText}</b>${role} · status: <b>${esc(ok)}</b></div>
            <div class="sourceMeta">entity: <b>${esc(l.entity_type || "—")}</b> · id: <b>${esc(l.entity_id || "—")}</b></div>
            <div class="sourceMeta">details: ${esc(detail)}</div>
          </div>
        `;
      })
      .join("");

    const html = rows
      ? `<div class="priceGrid oneCol">${rows}</div>`
      : `<div class="sourceMeta">No logs found.</div>`;

    if (box) {
      if (reset) box.innerHTML = html;
      else box.innerHTML = box.innerHTML + html;
    }

    if (msg) msg.textContent = logs.length ? `Showing ${auditOffset} log(s).` : "No more logs.";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (msg) msg.textContent = `Error: ${message}`;
  }
}

document.getElementById("logout")?.addEventListener("click", async () => {
  await api("POST", "/api/auth/logout").catch(() => {});
  location.href = "/login";
});

document.getElementById("createUser")?.addEventListener("click", async () => {
  const msg = document.getElementById("usersMsg");
  if (msg) msg.textContent = "Creating...";
  try {
    const username = document.getElementById("newUsername")?.value;
    const password = document.getElementById("newPassword")?.value;
    const role = document.getElementById("newRole")?.value;
    await api("POST", "/api/admin/users", { username, password, role });
    const u = document.getElementById("newUsername");
    const p = document.getElementById("newPassword");
    if (u) u.value = "";
    if (p) p.value = "";
    if (msg) msg.textContent = "Created.";
    const me = await ensureAdmin();
    await loadUsers(me);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (msg) msg.textContent = `Error: ${message}`;
  }
});

document.getElementById("importCsv")?.addEventListener("click", async () => {
  const msg = document.getElementById("csvMsg");
  if (msg) msg.textContent = "";
  const file = document.getElementById("csvFile")?.files?.[0];
  if (!file) {
    if (msg) msg.textContent = "Pick a .csv file first.";
    return;
  }
  if (msg) msg.textContent = "Reading file...";
  try {
    const text = await file.text();
    if (msg) msg.textContent = "Importing...";
    const data = await api("POST", "/api/admin/users/import", { csv: text });
    const s = data?.summary || {};
    if (msg) msg.textContent = `Imported. created=${s.created ?? 0}, updated=${s.updated ?? 0}, skipped=${s.skipped ?? 0}, errors=${s.errors ?? 0}`;
    const me = await ensureAdmin();
    await loadUsers(me);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (msg) msg.textContent = `Error: ${message}`;
  }
});

document.getElementById("saveRules")?.addEventListener("click", async () => {
  const msg = document.getElementById("rulesMsg");
  if (msg) msg.textContent = "Saving...";
  try {
    const maxPrice = document.getElementById("maxPrice")?.value;
    const priceMemoryRetentionDays = document.getElementById("priceMemoryRetentionDays")?.value;
    const extra = document.getElementById("extraRules")?.value;
    const tierRoughPct = document.getElementById("tierRoughPct")?.value;
    const tierGoodPct = document.getElementById("tierGoodPct")?.value;
    const tierBestPct = document.getElementById("tierBestPct")?.value;
    const tierNewPct = document.getElementById("tierNewPct")?.value;
    await api("PUT", "/api/admin/rules", {
      max_price_without_hints: maxPrice,
      price_memory_retention_days: priceMemoryRetentionDays,
      prompt_extra_rules: extra,
      tier_rough_pct: tierRoughPct,
      tier_good_pct: tierGoodPct,
      tier_best_pct: tierBestPct,
      tier_new_pct: tierNewPct
    });
    if (msg) msg.textContent = "Saved.";
    await loadRules();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (msg) msg.textContent = `Error: ${message}`;
  }
});

document.getElementById("auditRefresh")?.addEventListener("click", async () => {
  await loadAudit({ reset: true });
});
document.getElementById("auditMore")?.addEventListener("click", async () => {
  await loadAudit({ reset: false });
});

(async () => {
  try {
    await ensureCsrfToken();
  } catch {
    // ignore; will error on first write request
  }
  const me = await ensureAdmin();
  await loadRules();
  await loadUsers(me);
  await loadAudit({ reset: true });
})().catch(() => (location.href = "/login"));

