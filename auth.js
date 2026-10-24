/* ============================================================
   AUTH — password hashing + in-memory sessions (zero deps)
   ------------------------------------------------------------
   - Passwords hashed with scrypt (node:crypto), salt per user.
   - Sessions are random bearer tokens kept in memory; they
     reset on server restart (users just log in again).
   - Two roles: "master" (manages stores) and "store" (manages
     its own menu only).
   ============================================================ */

const crypto = require("crypto");

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), salt, 32).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(password || ""), salt, 32).toString("hex");
  const a = Buffer.from(h, "hex"), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sessions = new Map(); // token -> { role, storeId, name, exp }
const TTL_MS = 12 * 60 * 60 * 1000; // 12h

function createSession(data) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Object.assign({}, data, { exp: Date.now() + TTL_MS }));
  return token;
}
function getSession(token) {
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(token); return null; }
  return s;
}
function destroySession(token) { if (token) sessions.delete(token); }

/* pull the bearer token from a request */
function tokenFromReq(req) {
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

module.exports = { hashPassword, verifyPassword, createSession, getSession, destroySession, tokenFromReq };
