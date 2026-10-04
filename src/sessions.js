'use strict';

const crypto = require('crypto');
const config = require('./config');

// In-memory sessions: the SalesDiary token (and, for silent renewal, the password) never
// leave the server and are gone when the process restarts.
const sessions = new Map();
const COOKIE = 'sw_sid';

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').startsWith('https');
}

// The UI on GitHub Pages sends the session id in a header (cross-site cookies are blocked by
// most browsers); the same-origin UI can use the cookie.
function sessionId(req) {
  const header = String(req.headers['x-session'] || '').trim();
  return header || parseCookies(req)[COOKIE];
}

function get(req) {
  const sid = sessionId(req);
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.lastSeen > config.sessionHours * 3600 * 1000) {
    sessions.delete(sid);
    return null;
  }
  s.lastSeen = Date.now();
  return s;
}

function create(req, data) {
  const id = crypto.randomBytes(24).toString('base64url');
  const s = { id, createdAt: Date.now(), lastSeen: Date.now(), ...data };
  sessions.set(id, s);
  const cookie = `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionHours * 3600}${isHttps(req) ? '; Secure' : ''}`;
  return { session: s, cookie };
}

function destroy(req) {
  const sid = sessionId(req);
  if (sid) sessions.delete(sid);
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

setInterval(() => {
  const cutoff = Date.now() - config.sessionHours * 3600 * 1000;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff) sessions.delete(id);
}, 10 * 60 * 1000).unref();

// Simple brute-force guard for the login endpoint: 10 attempts per IP per 5 minutes.
const attempts = new Map();
function allowAttempt(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 5 * 60 * 1000);
  list.push(now);
  attempts.set(ip, list);
  return list.length <= 10;
}

module.exports = { get, create, destroy, allowAttempt };
