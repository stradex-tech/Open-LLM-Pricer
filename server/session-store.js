const session = require("express-session");

const { db } = require("./db");

function nowMs() {
  return Date.now();
}

function toExpireMs(sess) {
  const c = sess?.cookie;
  if (c?.expires) {
    const t = new Date(c.expires).getTime();
    if (Number.isFinite(t)) return t;
  }
  if (Number.isFinite(c?.maxAge)) return nowMs() + Number(c.maxAge);
  // Default: 7 days
  return nowMs() + 7 * 24 * 60 * 60 * 1000;
}

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    this._getStmt = db().prepare(`SELECT sess FROM sessions WHERE sid = ? AND expire > ?`);
    this._setStmt = db().prepare(`INSERT INTO sessions(sid, sess, expire) VALUES(?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expire=excluded.expire`);
    this._destroyStmt = db().prepare(`DELETE FROM sessions WHERE sid = ?`);
    this._pruneStmt = db().prepare(`DELETE FROM sessions WHERE expire <= ?`);
  }

  _prune() {
    try {
      this._pruneStmt.run(nowMs());
    } catch {
      // ignore
    }
  }

  get(sid, cb) {
    try {
      const row = this._getStmt.get(sid, nowMs());
      if (!row?.sess) return cb(null, null);
      const sess = JSON.parse(row.sess);
      return cb(null, sess);
    } catch (err) {
      return cb(err);
    } finally {
      this._prune();
    }
  }

  set(sid, sess, cb) {
    try {
      const exp = toExpireMs(sess);
      this._setStmt.run(sid, JSON.stringify(sess), exp);
      return cb?.(null);
    } catch (err) {
      return cb?.(err);
    } finally {
      this._prune();
    }
  }

  destroy(sid, cb) {
    try {
      this._destroyStmt.run(sid);
      return cb?.(null);
    } catch (err) {
      return cb?.(err);
    } finally {
      this._prune();
    }
  }

  touch(sid, sess, cb) {
    // Refresh expiry without rewriting payload too much.
    return this.set(sid, sess, cb);
  }
}

module.exports = { SqliteSessionStore };

