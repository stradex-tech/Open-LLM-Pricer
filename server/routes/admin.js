const bcrypt = require("bcryptjs");

const { db, createUser, listUsers, updateUser, getRules, setRules, getUserByUsername } = require("../db");
const { requireAdmin } = require("../auth");
const { auditFromReqUser } = require("../audit");

function enabledAdminCount() {
  const row = db().prepare(`SELECT COUNT(1) AS c FROM users WHERE role='admin' AND disabled=0`).get();
  return Number(row?.c || 0);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") continue;
    cur += ch;
  }

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  // trim cells
  return rows.map((r) => r.map((c) => String(c ?? "").trim())).filter((r) => r.some((c) => c.length));
}

function asBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return null;
}

function registerAdminRoutes(app, { requireStrongSessionSecret } = {}) {
  // ---- Users
  app.get("/api/admin/users", requireStrongSessionSecret || ((_, __, n) => n()), requireAdmin, (_req, res) => {
    return res.json({ ok: true, users: listUsers() });
  });

  app.post("/api/admin/users", requireStrongSessionSecret || ((_, __, n) => n()), requireAdmin, async (req, res) => {
    try {
      const { username, password, role } = req.body || {};
      const uname = typeof username === "string" ? username.trim() : "";
      if (uname.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
      if (typeof password !== "string" || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      const r = role === "admin" ? "admin" : "user";

      const hash = await bcrypt.hash(password, 10);
      const id = createUser({ username: uname, passwordHash: hash, role: r });
      auditFromReqUser(req, {
        action: "admin.user.create",
        entityType: "user",
        entityId: String(id),
        success: true,
        details: { username: uname, role: r }
      });
      return res.json({ ok: true, user: { id, username: uname, role: r, disabled: 0 } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // likely UNIQUE constraint
      if (message.toLowerCase().includes("unique")) return res.status(400).json({ error: "Username already exists" });
      auditFromReqUser(req, { action: "admin.user.create", success: false, details: { error: message } });
      return res.status(500).json({ error: message });
    }
  });

  app.put("/api/admin/users/:id", requireStrongSessionSecret || ((_, __, n) => n()), requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid user id" });

      const { role, disabled, password } = req.body || {};
      const nextRole = role === "admin" || role === "user" ? role : undefined;
      const nextDisabled =
        disabled === true ? 1 : disabled === false ? 0 : typeof disabled === "number" ? (disabled ? 1 : 0) : undefined;

      // Prevent disabling/demoting the last enabled admin.
      const current = db()
        .prepare(`SELECT id, role, disabled FROM users WHERE id = ?`)
        .get(id);
      if (!current) return res.status(404).json({ error: "User not found" });

      const isAdminAndEnabled = current.role === "admin" && current.disabled === 0;
      const wouldDisable = nextDisabled === 1;
      const wouldDemote = nextRole === "user";
      if (isAdminAndEnabled && (wouldDisable || wouldDemote)) {
        if (enabledAdminCount() <= 1) {
          return res.status(400).json({ error: "Cannot disable/demote the last admin" });
        }
      }

      let passwordHash;
      if (typeof password === "string" && password.length) {
        if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
        passwordHash = await bcrypt.hash(password, 10);
      }

      updateUser({ id, role: nextRole, disabled: nextDisabled, passwordHash });
      auditFromReqUser(req, {
        action: "admin.user.update",
        entityType: "user",
        entityId: String(id),
        success: true,
        details: {
          role: nextRole ?? null,
          disabled: typeof nextDisabled === "number" ? Boolean(nextDisabled) : null,
          password_changed: Boolean(passwordHash)
        }
      });
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      auditFromReqUser(req, { action: "admin.user.update", success: false, details: { error: message } });
      return res.status(500).json({ error: message });
    }
  });

  // Bulk import from CSV text (sent by the browser).
  // Supported columns (header optional):
  // - username (required)
  // - password (optional; if provided must be >= 8 chars)
  // - role (optional; user/admin; default user)
  // - disabled (optional; true/false/1/0)
  app.post("/api/admin/users/import", requireStrongSessionSecret || ((_, __, n) => n()), requireAdmin, async (req, res) => {
    try {
      const { csv } = req.body || {};
      if (typeof csv !== "string" || !csv.trim()) return res.status(400).json({ error: "Missing csv" });
      const maxCsvBytes = Number(process.env.ADMIN_CSV_MAX_BYTES ?? 2_000_000);
      if (Number.isFinite(maxCsvBytes) && maxCsvBytes > 0 && csv.length > maxCsvBytes) {
        return res.status(400).json({ error: `CSV too large (max ${maxCsvBytes} chars)` });
      }

      const rows = parseCsv(csv);
      if (!rows.length) return res.status(400).json({ error: "CSV is empty" });

      const header = rows[0].map((h) => h.toLowerCase());
      const hasHeader = header.includes("username") || header.includes("user") || header.includes("password") || header.includes("role");

      const idx = (name, fallbackIndex) => {
        const i = header.indexOf(name);
        return i !== -1 ? i : fallbackIndex;
      };

      const usernameIdx = hasHeader ? idx("username", idx("user", 0)) : 0;
      const passwordIdx = hasHeader ? idx("password", 1) : 1;
      const roleIdx = hasHeader ? idx("role", 2) : 2;
      const disabledIdx = hasHeader ? idx("disabled", 3) : 3;

      const dataRows = hasHeader ? rows.slice(1) : rows;

      const results = [];
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      for (let line = 0; line < dataRows.length; line++) {
        const r = dataRows[line];
        const username = String(r[usernameIdx] ?? "").trim();
        if (!username) {
          skipped++;
          results.push({ line: line + 1, username: "", action: "skipped", error: "Missing username" });
          continue;
        }
        if (username.length < 3) {
          errors++;
          results.push({ line: line + 1, username, action: "error", error: "Username must be at least 3 characters" });
          continue;
        }

        const password = String(r[passwordIdx] ?? "").trim();
        const roleRaw = String(r[roleIdx] ?? "").trim().toLowerCase();
        const role = roleRaw === "admin" ? "admin" : roleRaw === "user" ? "user" : "user";
        const disabledRaw = r[disabledIdx];
        const disabledBool = asBool(disabledRaw);
        const disabled = disabledBool == null ? undefined : disabledBool ? 1 : 0;

        try {
          const existing = getUserByUsername(username);
          let passwordHash;
          if (password) {
            if (password.length < 8) throw new Error("Password must be at least 8 characters");
            passwordHash = await bcrypt.hash(password, 10);
          }

          if (!existing) {
            if (!passwordHash) throw new Error("Password required for new users");
            const id = createUser({ username, passwordHash, role });
            if (typeof disabled === "number" && disabled === 1) {
              // Avoid disabling the last admin via import.
              if (role === "admin" && enabledAdminCount() <= 1) {
                updateUser({ id, disabled: 0 });
                throw new Error("Cannot disable the last admin");
              }
              updateUser({ id, disabled });
            }
            created++;
            results.push({ line: line + 1, username, action: "created" });
          } else {
            // Prevent disabling/demoting last enabled admin.
            const isAdminAndEnabled = existing.role === "admin" && existing.disabled === 0;
            const wouldDisable = disabled === 1;
            const wouldDemote = role === "user";
            if (isAdminAndEnabled && (wouldDisable || wouldDemote)) {
              if (enabledAdminCount() <= 1) throw new Error("Cannot disable/demote the last admin");
            }

            updateUser({
              id: existing.id,
              role,
              disabled,
              passwordHash
            });
            updated++;
            results.push({ line: line + 1, username, action: "updated" });
          }
        } catch (e) {
          errors++;
          results.push({ line: line + 1, username, action: "error", error: String(e?.message || e) });
        }
      }

      auditFromReqUser(req, {
        action: "admin.user.import_csv",
        entityType: "user",
        success: true,
        details: { summary: { created, updated, skipped, errors }, row_count: dataRows.length }
      });
      return res.json({ ok: true, summary: { created, updated, skipped, errors }, results: results.slice(0, 200) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      auditFromReqUser(req, { action: "admin.user.import_csv", success: false, details: { error: message } });
      return res.status(500).json({ error: message });
    }
  });

  // ---- Rules
  app.get("/api/admin/rules", requireStrongSessionSecret || ((_, __, n) => n()), requireAdmin, (_req, res) => {
    return res.json({ ok: true, rules: getRules() });
  });

  app.put("/api/admin/rules", requireStrongSessionSecret || ((_, __, n) => n()), requireAdmin, (req, res) => {
    try {
      const {
        max_price_without_hints,
        prompt_extra_rules,
        tier_rough_pct,
        tier_good_pct,
        tier_best_pct,
        tier_new_pct,
        price_memory_retention_days
      } = req.body || {};
      let max = max_price_without_hints;
      if (typeof max === "string") max = Number(max);
      if (max != null && (!Number.isFinite(Number(max)) || Number(max) < 0 || Number(max) > 100000)) {
        return res.status(400).json({ error: "Invalid max_price_without_hints" });
      }
      if (prompt_extra_rules != null && typeof prompt_extra_rules !== "string") {
        return res.status(400).json({ error: "Invalid prompt_extra_rules" });
      }

      const toPct = (v) => {
        let n = v;
        if (typeof n === "string") n = Number(n);
        if (n == null || n === "") return undefined;
        if (!Number.isFinite(Number(n))) return NaN;
        return Number(n);
      };
      const roughPct = toPct(tier_rough_pct);
      const goodPct = toPct(tier_good_pct);
      const bestPct = toPct(tier_best_pct);
      const newPct = toPct(tier_new_pct);

      const checkPct = (name, v) => {
        if (v === undefined) return null;
        if (!Number.isFinite(v) || v < 0 || v > 200) return `${name} must be a number between 0 and 200`;
        return null;
      };
      const pctErr =
        checkPct("tier_rough_pct", roughPct) ||
        checkPct("tier_good_pct", goodPct) ||
        checkPct("tier_best_pct", bestPct) ||
        checkPct("tier_new_pct", newPct);
      if (pctErr) return res.status(400).json({ error: pctErr });

      let retentionDays = price_memory_retention_days;
      if (typeof retentionDays === "string") retentionDays = Number(retentionDays);
      if (retentionDays != null && retentionDays !== "") {
        const n = Number(retentionDays);
        if (!Number.isFinite(n) || n < 1 || n > 365) {
          return res.status(400).json({ error: "price_memory_retention_days must be a number between 1 and 365" });
        }
        retentionDays = Math.floor(n);
      } else {
        retentionDays = undefined;
      }

      setRules({
        max_price_without_hints: max != null ? Number(max) : undefined,
        prompt_extra_rules: prompt_extra_rules != null ? prompt_extra_rules : undefined,
        tier_rough_pct: roughPct,
        tier_good_pct: goodPct,
        tier_best_pct: bestPct,
        tier_new_pct: newPct,
        price_memory_retention_days: retentionDays
      });
      auditFromReqUser(req, {
        action: "admin.rules.update",
        entityType: "rules",
        entityId: "global",
        success: true,
        details: {
          max_price_without_hints: max != null ? Number(max) : null,
          prompt_extra_rules_length: typeof prompt_extra_rules === "string" ? prompt_extra_rules.length : null,
          tier_rough_pct: roughPct ?? null,
          tier_good_pct: goodPct ?? null,
          tier_best_pct: bestPct ?? null,
          tier_new_pct: newPct ?? null,
          price_memory_retention_days: retentionDays ?? null
        }
      });
      return res.json({ ok: true, rules: getRules() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      auditFromReqUser(req, { action: "admin.rules.update", success: false, details: { error: message } });
      return res.status(500).json({ error: message });
    }
  });
}

module.exports = { registerAdminRoutes };

