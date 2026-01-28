const bcrypt = require("bcryptjs");

const { getUserByUsername } = require("../db");
const { getSessionUser } = require("../auth");
const { auditLog } = require("../audit");
const { createRateLimiter, getIp } = require("../rate-limit");

function sessionRegenerate(req) {
  return new Promise((resolve, reject) => {
    if (!req?.session?.regenerate) return resolve();
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function sessionSave(req) {
  return new Promise((resolve, reject) => {
    if (!req?.session?.save) return resolve();
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function registerAuthRoutes(app, { requireStrongSessionSecret } = {}) {
  app.get("/api/auth/me", async (req, res) => {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    return res.json({ ok: true, user });
  });

  const loginLimiterByIp = createRateLimiter({
    windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS ?? 10 * 60_000),
    max: Number(process.env.LOGIN_RATE_MAX_PER_IP ?? 30),
    keyFn: (req) => `ip:${getIp(req)}`
  });
  const loginLimiterByUser = createRateLimiter({
    windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS ?? 10 * 60_000),
    max: Number(process.env.LOGIN_RATE_MAX_PER_USER ?? 15),
    keyFn: (req) => {
      const u = typeof req?.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
      return `user:${u || "unknown"}:${getIp(req)}`;
    }
  });

  app.post("/api/auth/login", requireStrongSessionSecret || ((_, __, n) => n()), loginLimiterByIp, loginLimiterByUser, async (req, res) => {
    try {
      const { username, password, loginAs } = req.body || {};
      if (typeof username !== "string" || typeof password !== "string") {
        auditLog({
          req,
          actorUsername: typeof username === "string" ? username.trim() : null,
          action: "auth.login",
          success: false,
          details: { reason: "missing_username_or_password", loginAs: loginAs === "admin" ? "admin" : "user" }
        });
        return res.status(400).json({ error: "Missing username/password" });
      }
      const desired = loginAs === "admin" ? "admin" : "user";

      const user = getUserByUsername(username.trim());
      if (!user) {
        auditLog({
          req,
          actorUsername: username.trim(),
          action: "auth.login",
          success: false,
          details: { reason: "invalid_credentials", loginAs: desired }
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }
      if (user.disabled) {
        auditLog({
          req,
          actorUserId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          action: "auth.login",
          success: false,
          details: { reason: "account_disabled", loginAs: desired }
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        auditLog({
          req,
          actorUserId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          action: "auth.login",
          success: false,
          details: { reason: "invalid_credentials", loginAs: desired }
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Enforce the UI toggle: if they choose Admin, they must be an admin user.
      if (desired === "admin" && user.role !== "admin") {
        auditLog({
          req,
          actorUserId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          action: "auth.login",
          success: false,
          details: { reason: "not_admin_account", loginAs: desired }
        });
        return res.status(403).json({ error: "Not an admin account" });
      }
      // If they choose User, allow both user/admin accounts to proceed to the app.

      // Prevent session fixation by regenerating the session on login.
      await sessionRegenerate(req);
      req.session.userId = user.id;
      // Persist an auth fingerprint so middleware can rotate session ID if privileges change later.
      req.session.userRole = user.role;
      if (Number.isFinite(Number(user.updated_at))) req.session.userUpdatedAt = Number(user.updated_at);
      await sessionSave(req);
      auditLog({
        req,
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        action: "auth.login",
        success: true,
        details: { loginAs: desired }
      });
      return res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: message });
    }
  });

  app.post("/api/auth/logout", requireStrongSessionSecret || ((_, __, n) => n()), (req, res) => {
    (async () => {
      const user = await getSessionUser(req);
      if (user) {
        auditLog({
          req,
          actorUserId: user.id,
          actorUsername: user.username,
          actorRole: user.role,
          action: "auth.logout",
          success: true
        });
      }
    })()
      .catch(() => {})
      .finally(() => {
        req.session.destroy(() => {
          res.json({ ok: true });
        });
      });
  });
}

module.exports = { registerAuthRoutes };

