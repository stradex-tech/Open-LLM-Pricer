const { createAuditLog } = require("./db");

function getClientIp(req) {
  // Only trust X-Forwarded-For when we are explicitly configured to trust a reverse proxy.
  const trustProxy = process.env.TRUST_PROXY === "true";
  try {
    if (trustProxy) {
      const xf = req?.headers?.["x-forwarded-for"];
      if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
    }
  } catch {
    // ignore
  }
  return req?.ip || req?.socket?.remoteAddress || null;
}

function safeJsonStringify(v) {
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return "{}";
  }
}

function auditLog({
  req,
  actorUserId,
  actorUsername,
  actorRole,
  action,
  entityType,
  entityId,
  success = true,
  details
}) {
  try {
    createAuditLog({
      actorUserId: actorUserId ?? null,
      actorUsername: typeof actorUsername === "string" ? actorUsername : null,
      actorRole: typeof actorRole === "string" ? actorRole : null,
      action: String(action || "unknown"),
      entityType: entityType != null ? String(entityType) : null,
      entityId: entityId != null ? String(entityId) : null,
      ip: getClientIp(req),
      userAgent: typeof req?.headers?.["user-agent"] === "string" ? req.headers["user-agent"] : null,
      success: success ? 1 : 0,
      detailsJson: safeJsonStringify(details)
    });
  } catch {
    // Never break requests because auditing failed.
  }
}

function auditFromReqUser(req, payload) {
  const u = req?.user;
  return auditLog({
    req,
    actorUserId: u?.id ?? null,
    actorUsername: u?.username ?? null,
    actorRole: u?.role ?? null,
    ...payload
  });
}

module.exports = { auditLog, auditFromReqUser, getClientIp };
