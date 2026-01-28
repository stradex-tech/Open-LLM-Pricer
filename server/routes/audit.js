const { requireAuth, requireAdmin } = require("../auth");
const { listAuditLogs } = require("../db");

function toInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function registerAuditRoutes(app, { requireStrongSessionSecret } = {}) {
  // User: view own activity
  app.get("/api/audit/mine", requireStrongSessionSecret || ((_, __, n) => n()), requireAuth, (req, res) => {
    const limit = toInt(req.query.limit, 50);
    const offset = toInt(req.query.offset, 0);
    const rows = listAuditLogs({
      limit,
      offset,
      actorUserId: req.user.id
    });
    return res.json({ ok: true, logs: rows });
  });

  // Admin: view all activity
  app.get("/api/admin/audit", requireStrongSessionSecret || ((_, __, n) => n()), requireAdmin, (req, res) => {
    const limit = toInt(req.query.limit, 50);
    const offset = toInt(req.query.offset, 0);

    const actor = typeof req.query.actor === "string" ? req.query.actor.trim() : "";
    const actorUserId = actor && /^[0-9]+$/.test(actor) ? Number(actor) : undefined;
    const actorUsernameLike = actor && !/^[0-9]+$/.test(actor) ? actor : undefined;

    const rows = listAuditLogs({
      limit,
      offset,
      actorUserId,
      actorUsernameLike,
      actorRole: typeof req.query.role === "string" ? req.query.role : undefined,
      action: typeof req.query.action === "string" ? req.query.action : undefined,
      entityType: typeof req.query.entity_type === "string" ? req.query.entity_type : undefined,
      entityId: typeof req.query.entity_id === "string" ? req.query.entity_id : undefined,
      success:
        req.query.success === "1" || req.query.success === "0"
          ? Number(req.query.success)
          : typeof req.query.success === "boolean"
            ? req.query.success
              ? 1
              : 0
            : undefined,
      since: req.query.since,
      until: req.query.until
    });

    return res.json({ ok: true, logs: rows });
  });
}

module.exports = { registerAuditRoutes };
