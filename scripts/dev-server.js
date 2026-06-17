// Mini dev-server LOCALE (solo per anteprima). Zero dipendenze: usa solo i moduli
// built-in di Node. Carica .env.local, serve /public e instrada /api/*.js
// emulando le res.status()/res.json() e req.query di Vercel.
//
// Avvio:  node scripts/dev-server.js   →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

// --- carica .env.local in process.env (non sovrascrive variabili già presenti) ---
try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  for (const line of envFile.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
} catch (e) {
  console.warn('Attenzione: .env.local non leggibile:', e.message);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
};

function enhanceRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  enhanceRes(res);
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);

  // --- API ---
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice('/api/'.length).replace(/\/+$/, '');
    const file = path.join(API, name + '.js');
    if (!file.startsWith(API) || !fs.existsSync(file)) { res.status(404).json({ error: 'not found' }); return; }
    req.query = Object.fromEntries(u.searchParams.entries());
    try {
      const handler = require(file);
      await handler(req, res);
    } catch (e) {
      console.error('API error', name, e);
      if (!res.headersSent) res.status(500).json({ error: String((e && e.message) || e) });
    }
    return;
  }

  // --- static + rewrites (/d/:slug -> dashboard.html, come vercel.json) ---
  let filePath;
  if (pathname === '/' || pathname === '') filePath = path.join(PUBLIC, 'index.html');
  else if (/^\/d\/[^/]+\/?$/.test(pathname)) filePath = path.join(PUBLIC, 'dashboard.html');
  else filePath = path.join(PUBLIC, pathname);

  if (!path.resolve(filePath).startsWith(PUBLIC)) { res.status(403).end('forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Not found'); return; }
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Dev-server locale attivo:  http://localhost:' + PORT);
  console.log('Apri ad es.  http://localhost:' + PORT + '/d/pirelli  (login con la password del cliente o admin)');
});
