// POST /api/login
// Body: { slug?: string, password: string }
// - Se la password matcha DASHBOARD_PASSWORD_ADMIN → cookie admin (apre tutte le dashboard)
// - Se è specificato uno slug valido e la password matcha DASHBOARD_PASSWORD_<SLUG_UPPER>
//   → cookie client per quello slug

const path = require('path');
const session = require('../lib/session');
const CLIENTS = require('../config/clients.json');

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  // Stream fallback (Vercel di solito parsa già il body)
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = await readJsonBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid body' });

  const slug = body.slug ? String(body.slug).toLowerCase() : null;
  const password = body.password ? String(body.password) : '';
  if (!password) return res.status(400).json({ error: 'password required' });

  // 1) Tentativo admin (password unica master)
  const adminPwd = process.env.DASHBOARD_PASSWORD_ADMIN;
  if (adminPwd && session.timingSafeStringEqual(password, adminPwd)) {
    session.setSessionCookie(res, { role: 'admin' });
    return res.status(200).json({ ok: true, role: 'admin' });
  }

  // 2) Tentativo client
  if (slug && Object.prototype.hasOwnProperty.call(CLIENTS, slug)) {
    const envKey = 'DASHBOARD_PASSWORD_' + slug.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const clientPwd = process.env[envKey];
    if (clientPwd && session.timingSafeStringEqual(password, clientPwd)) {
      session.setSessionCookie(res, { role: 'client', slug });
      return res.status(200).json({ ok: true, role: 'client', slug });
    }
  }

  // Risposta uniforme per non rivelare quali slug esistano
  return res.status(401).json({ error: 'Credenziali non valide' });
};
