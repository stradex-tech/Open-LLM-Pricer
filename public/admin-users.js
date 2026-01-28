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

(async () => {
  try {
    await ensureCsrfToken();
  } catch {
    // ignore; will error on first write request
  }
  const me = await ensureAdmin();
  await loadUsers(me);
})().catch(() => (location.href = "/login"));

