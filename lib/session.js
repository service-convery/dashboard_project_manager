// Helpers per cookie di sessione firmati HMAC-SHA256.
// Zero dipendenze: usa solo il modulo crypto built-in di Node.
//
// Formato cookie: "<base64url(payload JSON)>.<base64url(hmac)>"
// Payload: { role: "admin"|"client", slug?: string, iat: number, exp: number }

const crypto = require('crypto');

const COOKIE_NAME = 'cvy_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 giorni

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET mancante o troppo corta (min 32 caratteri). Generala con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return s;
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payload) {
  const secret = getSecret();
  const data = JSON.stringify(payload);
  const enc = b64urlEncode(data);
  const sig = b64urlEncode(crypto.createHmac('sha256', secret).update(enc).digest());
  return enc + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [enc, sig] = parts;
  let secret;
  try { secret = getSecret(); } catch { return null; }
  const expected = b64urlEncode(crypto.createHmac('sha256', secret).update(enc).digest());
  // Confronto timing-safe
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(enc).toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx < 0) return;
    const k = c.slice(0, idx).trim();
    const v = c.slice(idx + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  return verify(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, payload) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + MAX_AGE_SEC;
  const token = sign(Object.assign({}, payload, { iat, exp }));
  const cookie = COOKIE_NAME + '=' + token +
    '; Max-Age=' + MAX_AGE_SEC +
    '; Path=/; HttpOnly; Secure; SameSite=Lax';
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', COOKIE_NAME + '=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
}

function timingSafeStringEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SEC,
  sign,
  verify,
  getSession,
  setSessionCookie,
  clearSessionCookie,
  timingSafeStringEqual
};
