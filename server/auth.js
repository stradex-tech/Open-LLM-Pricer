const { getUserById } = require("./db");

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

async function syncAndRotateSessionIfNeeded(req, user) {
  // We store an auth fingerprint in the session. If it changes, rotate the session ID
  // to avoid "session fixation" surviving a privilege change (e.g., user -> admin).
  const sess = req?.session;
  if (!sess || !user) return;

  const prevRole = typeof sess.userRole === "string" ? sess.userRole : null;
  const prevUpdatedAt =
    Number.isFinite(Number(sess.userUpdatedAt)) && sess.userUpdatedAt != null ? Number(sess.userUpdatedAt) : null;
  const currRole = typeof user.role === "string" ? user.role : null;
  const currUpdatedAt = Number.isFinite(Number(user.updated_at)) ? Number(user.updated_at) : null;

  const shouldRotate =
    (prevRole != null && currRole != null && prevRole !== currRole) ||
    (prevUpdatedAt != null && currUpdatedAt != null && prevUpdatedAt !== currUpdatedAt);

  if (!shouldRotate) {
    // Keep session fields in sync for future comparisons.
    sess.userRole = currRole;
    if (currUpdatedAt != null) sess.userUpdatedAt = currUpdatedAt;
    return;
  }

  // Preserve CSRF token so the browser doesn't suddenly start failing POSTs.
  const csrfToken = typeof sess.csrfToken === "string" ? sess.csrfToken : null;

  await sessionRegenerate(req);
  req.session.userId = user.id;
  req.session.userRole = currRole;
  if (currUpdatedAt != null) req.session.userUpdatedAt = currUpdatedAt;
  if (csrfToken) req.session.csrfToken = csrfToken;
  await sessionSave(req);
}

async function getSessionUser(req) {
  const userId = req.session?.userId;
  if (!userId) return null;
  const user = getUserById(userId);
  if (!user || user.disabled) return null;
  return user;
}

function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Not logged in" });
  const user = getUserById(userId);
  if (!user || user.disabled) return res.status(401).json({ error: "Not logged in" });
  syncAndRotateSessionIfNeeded(req, user)
    .catch(() => {})
    .finally(() => {
      req.user = user;
      return next();
    });
}

function requireAdmin(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Not logged in" });
  const user = getUserById(userId);
  if (!user || user.disabled) return res.status(401).json({ error: "Not logged in" });
  if (user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  syncAndRotateSessionIfNeeded(req, user)
    .catch(() => {})
    .finally(() => {
      req.user = user;
      return next();
    });
}

module.exports = { getSessionUser, requireAuth, requireAdmin };

