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

document.getElementById("auditRefresh")?.addEventListener("click", async () => {
  await loadAudit({ reset: true });
});
document.getElementById("auditMore")?.addEventListener("click", async () => {
  await loadAudit({ reset: false });
});

(async () => {
  await ensureAdmin();
  await loadAudit({ reset: true });
})().catch(() => (location.href = "/login"));

