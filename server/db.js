const fs = require("fs");
const path = require("path");

const Database = require("better-sqlite3");

function getDbPath() {
  // Persisted via docker volume: ./data -> /app/data
  const dataDir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "app.db");
}

let _db = null;
let _auditWriteCounter = 0;
let _priceMemoryWriteCounter = 0;

function db() {
  if (_db) return _db;
  const file = getDbPath();
  _db = new Database(file);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

    CREATE TABLE IF NOT EXISTS rules (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      memory_key TEXT NOT NULL,
      result_json TEXT NOT NULL,
      hints_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_price_memory_key_ts ON price_memory(memory_key, ts);
    CREATE INDEX IF NOT EXISTS idx_price_memory_ts ON price_memory(ts);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      actor_user_id INTEGER,
      actor_username TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      ip TEXT,
      user_agent TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      details_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs(ts);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
  `);

  const now = Math.floor(Date.now() / 1000);
  const defaults = [
    ["max_price_without_hints", "20"],
    ["prompt_extra_rules", ""],
    // Tier percentages (used to compute Rough/Good/Best/New tiers).
    // Rough/Good/Best are percentages of used_price_usd; New is percentage of new_price_usd.
    ["tier_rough_pct", "50"],
    ["tier_good_pct", "75"],
    ["tier_best_pct", "100"],
    ["tier_new_pct", "100"],
    // Pricing memory retention window (days)
    ["price_memory_retention_days", "7"]
  ];
  const upsert = d.prepare(`INSERT OR IGNORE INTO rules(key, value) VALUES (?, ?)`);
  const tx = d.transaction(() => {
    for (const [k, v] of defaults) upsert.run(k, v);
  });
  tx();

  // Ensure timestamps exist for legacy rows (if any).
  d.prepare(`UPDATE users SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?)`).run(now, now);
}

// ---- Setup helpers
function adminExists() {
  const row = db().prepare(`SELECT 1 AS ok FROM users WHERE role='admin' AND disabled=0 LIMIT 1`).get();
  return Boolean(row?.ok);
}

function getUserByUsername(username) {
  return db()
    .prepare(`SELECT id, username, password_hash, role, disabled, created_at, updated_at FROM users WHERE username = ?`)
    .get(username);
}

function getUserById(id) {
  return db()
    .prepare(`SELECT id, username, role, disabled, created_at, updated_at FROM users WHERE id = ?`)
    .get(id);
}

function createUser({ username, passwordHash, role }) {
  const now = Math.floor(Date.now() / 1000);
  const info = db()
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`
    )
    .run(username, passwordHash, role, now, now);
  return Number(info.lastInsertRowid);
}

function listUsers() {
  return db()
    .prepare(`SELECT id, username, role, disabled, created_at, updated_at FROM users ORDER BY role DESC, username ASC`)
    .all();
}

function updateUser({ id, role, disabled, passwordHash }) {
  const now = Math.floor(Date.now() / 1000);
  const fields = [];
  const params = [];

  if (typeof role === "string") {
    fields.push("role = ?");
    params.push(role);
  }
  if (typeof disabled === "number") {
    fields.push("disabled = ?");
    params.push(disabled);
  }
  if (typeof passwordHash === "string") {
    fields.push("password_hash = ?");
    params.push(passwordHash);
  }

  fields.push("updated_at = ?");
  params.push(now);

  params.push(id);
  db().prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

// ---- Rules
function getRules() {
  const rows = db().prepare(`SELECT key, value FROM rules`).all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;

  const maxPriceWithoutHints = Number(map.max_price_without_hints);
  const clampPct = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    if (n < 0) return 0;
    if (n > 200) return 200;
    return n;
  };
  return {
    max_price_without_hints: Number.isFinite(maxPriceWithoutHints) ? maxPriceWithoutHints : 20,
    prompt_extra_rules: typeof map.prompt_extra_rules === "string" ? map.prompt_extra_rules : "",
    tier_rough_pct: clampPct(map.tier_rough_pct, 50),
    tier_good_pct: clampPct(map.tier_good_pct, 75),
    tier_best_pct: clampPct(map.tier_best_pct, 100),
    tier_new_pct: clampPct(map.tier_new_pct, 100),
    price_memory_retention_days: (() => {
      const n = Number(map.price_memory_retention_days);
      if (!Number.isFinite(n)) return 7;
      if (n < 1) return 1;
      if (n > 365) return 365;
      return Math.floor(n);
    })()
  };
}

function setRule(key, value) {
  db()
    .prepare(`INSERT INTO rules(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(key, value);
}

function setRules({
  max_price_without_hints,
  prompt_extra_rules,
  tier_rough_pct,
  tier_good_pct,
  tier_best_pct,
  tier_new_pct,
  price_memory_retention_days
}) {
  const tx = db().transaction(() => {
    if (max_price_without_hints != null) setRule("max_price_without_hints", String(max_price_without_hints));
    if (prompt_extra_rules != null) setRule("prompt_extra_rules", String(prompt_extra_rules));
    if (tier_rough_pct != null) setRule("tier_rough_pct", String(tier_rough_pct));
    if (tier_good_pct != null) setRule("tier_good_pct", String(tier_good_pct));
    if (tier_best_pct != null) setRule("tier_best_pct", String(tier_best_pct));
    if (tier_new_pct != null) setRule("tier_new_pct", String(tier_new_pct));
    if (price_memory_retention_days != null) setRule("price_memory_retention_days", String(price_memory_retention_days));
  });
  tx();
}

// ---- Price memory (pricing cache)
function getPriceMemoryRetentionDays() {
  const row = db().prepare(`SELECT value FROM rules WHERE key = ?`).get("price_memory_retention_days");
  const n = Number(row?.value);
  if (!Number.isFinite(n)) return 7;
  if (n < 1) return 1;
  if (n > 365) return 365;
  return Math.floor(n);
}

function getPriceMemoryHit(memoryKey, retentionDays) {
  const key = String(memoryKey || "").trim();
  if (!key) return null;
  const days = Number.isFinite(Number(retentionDays)) ? Number(retentionDays) : 7;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - Math.max(1, Math.floor(days)) * 86400;
  const row = db()
    .prepare(
      `
      SELECT id, ts, memory_key, result_json
      FROM price_memory
      WHERE memory_key = ? AND ts >= ?
      ORDER BY ts DESC, id DESC
      LIMIT 1
    `
    )
    .get(key, cutoff);
  if (!row?.result_json) return null;
  try {
    return JSON.parse(String(row.result_json));
  } catch {
    return null;
  }
}

function prunePriceMemory(retentionDays) {
  try {
    const days = Number.isFinite(Number(retentionDays)) ? Number(retentionDays) : 7;
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - Math.max(1, Math.floor(days)) * 86400;
    db().prepare(`DELETE FROM price_memory WHERE ts < ?`).run(cutoff);
  } catch {
    // ignore
  }
}

function putPriceMemory(memoryKey, result, hints, retentionDays) {
  const key = String(memoryKey || "").trim();
  if (!key) return;
  const ts = Math.floor(Date.now() / 1000);
  const resultJson = JSON.stringify(result ?? null);
  const hintsJson = JSON.stringify(hints ?? {});
  db()
    .prepare(`INSERT INTO price_memory (ts, memory_key, result_json, hints_json) VALUES (?, ?, ?, ?)`)
    .run(ts, key, resultJson, hintsJson);

  _priceMemoryWriteCounter++;
  if (_priceMemoryWriteCounter % 25 === 0) {
    prunePriceMemory(retentionDays);
  }
}

// ---- Audit logs
function createAuditLog({
  actorUserId,
  actorUsername,
  actorRole,
  action,
  entityType,
  entityId,
  ip,
  userAgent,
  success,
  detailsJson
}) {
  const ts = Math.floor(Date.now() / 1000);
  db()
    .prepare(
      `INSERT INTO audit_logs (
        ts, actor_user_id, actor_username, actor_role, action,
        entity_type, entity_id, ip, user_agent, success, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ts,
      actorUserId ?? null,
      actorUsername ?? null,
      actorRole ?? null,
      String(action || "unknown"),
      entityType ?? null,
      entityId ?? null,
      ip ?? null,
      userAgent ?? null,
      typeof success === "number" ? success : 1,
      typeof detailsJson === "string" ? detailsJson : "{}"
    );

  // Retention: keep the audit table bounded.
  // Defaults are intentionally conservative; override via env vars:
  // - AUDIT_LOG_MAX_ROWS (default 20000; set 0 to disable row cap)
  // - AUDIT_LOG_MAX_AGE_DAYS (default 90; set 0 to disable age cap)
  _auditWriteCounter++;
  if (_auditWriteCounter % 25 === 0) {
    pruneAuditLogs({
      maxRows: Number(process.env.AUDIT_LOG_MAX_ROWS ?? 20000),
      maxAgeDays: Number(process.env.AUDIT_LOG_MAX_AGE_DAYS ?? 90)
    });
  }
}

function pruneAuditLogs({ maxRows, maxAgeDays } = {}) {
  try {
    const d = db();

    const now = Math.floor(Date.now() / 1000);
    const maxAgeSeconds =
      Number.isFinite(Number(maxAgeDays)) && Number(maxAgeDays) > 0 ? Math.floor(Number(maxAgeDays) * 86400) : 0;
    const rowCap = Number.isFinite(Number(maxRows)) && Number(maxRows) > 0 ? Math.floor(Number(maxRows)) : 0;

    const tx = d.transaction(() => {
      if (maxAgeSeconds > 0) {
        const cutoff = now - maxAgeSeconds;
        d.prepare(`DELETE FROM audit_logs WHERE ts < ?`).run(cutoff);
      }

      if (rowCap > 0) {
        const cRow = d.prepare(`SELECT COUNT(1) AS c FROM audit_logs`).get();
        const c = Number(cRow?.c || 0);
        if (c > rowCap) {
          const keepOffset = rowCap - 1; // 0-based offset
          const threshold = d
            .prepare(`SELECT id FROM audit_logs ORDER BY id DESC LIMIT 1 OFFSET ?`)
            .get(keepOffset);
          const thresholdId = Number(threshold?.id);
          if (Number.isFinite(thresholdId)) {
            d.prepare(`DELETE FROM audit_logs WHERE id < ?`).run(thresholdId);
          }
        }
      }
    });
    tx();
  } catch {
    // ignore
  }
}

function listAuditLogs({
  limit = 50,
  offset = 0,
  actorUserId,
  actorRole,
  action,
  entityType,
  entityId,
  success,
  since,
  until,
  actorUsernameLike
} = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Math.min(100000, Number(offset) || 0));

  const where = [];
  const params = [];

  if (actorUserId != null) {
    where.push("actor_user_id = ?");
    params.push(Number(actorUserId));
  }
  if (typeof actorRole === "string" && actorRole) {
    where.push("actor_role = ?");
    params.push(actorRole);
  }
  if (typeof action === "string" && action) {
    where.push("action LIKE ?");
    params.push(`%${action}%`);
  }
  if (typeof entityType === "string" && entityType) {
    where.push("entity_type = ?");
    params.push(entityType);
  }
  if (typeof entityId === "string" && entityId) {
    where.push("entity_id = ?");
    params.push(entityId);
  }
  if (typeof success === "number") {
    where.push("success = ?");
    params.push(success ? 1 : 0);
  }
  if (since != null && Number.isFinite(Number(since))) {
    where.push("ts >= ?");
    params.push(Number(since));
  }
  if (until != null && Number.isFinite(Number(until))) {
    where.push("ts <= ?");
    params.push(Number(until));
  }
  if (typeof actorUsernameLike === "string" && actorUsernameLike.trim()) {
    where.push("actor_username LIKE ?");
    params.push(`%${actorUsernameLike.trim()}%`);
  }

  const sql = `
    SELECT
      id, ts, actor_user_id, actor_username, actor_role,
      action, entity_type, entity_id, ip, user_agent, success, details_json
    FROM audit_logs
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `;
  params.push(lim, off);
  return db().prepare(sql).all(...params);
}

module.exports = {
  db,
  adminExists,
  getUserByUsername,
  getUserById,
  createUser,
  listUsers,
  updateUser,
  getRules,
  setRules,
  getPriceMemoryRetentionDays,
  getPriceMemoryHit,
  putPriceMemory,
  prunePriceMemory,
  createAuditLog,
  listAuditLogs
};

