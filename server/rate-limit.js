function getIp(req) {
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
  return req?.ip || req?.socket?.remoteAddress || "unknown";
}

function createRateLimiter({ windowMs = 60_000, max = 60, keyFn } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  function cleanup(now) {
    for (const [k, v] of hits.entries()) {
      if (!v || v.resetAt <= now) hits.delete(k);
    }
  }

  const t = setInterval(() => cleanup(Date.now()), Math.max(10_000, windowMs));
  // Don’t keep the process alive just for cleanup.
  // eslint-disable-next-line no-unused-expressions
  t.unref?.();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = (typeof keyFn === "function" ? keyFn(req) : null) || getIp(req);
    const lim = Math.max(1, Number(max) || 1);
    const win = Math.max(1000, Number(windowMs) || 60_000);

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + win };
      hits.set(key, entry);
    }

    entry.count++;

    // Basic advisory headers.
    res.setHeader("X-RateLimit-Limit", String(lim));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, lim - entry.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > lim) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ error: "Too many requests" });
    }

    return next();
  };
}

module.exports = { createRateLimiter, getIp };
