// GET /api/me
// Ritorna informazioni di sessione + elenco dashboard a cui l'utente ha accesso.
// Il listId NON viene esposto al client: i nomi sì, gli ID restano server-side.

const session = require('../lib/session');
const CLIENTS = require('../config/clients.json');

module.exports = (req, res) => {
  const s = session.getSession(req);
  if (!s) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ authenticated: false });
  }

  // Campi pubblici per il client: name + config pacchetto ore + viste tag. Il listId resta server-side.
  const pub = (slug, c) => ({
    slug,
    name: c.name,
    pacchettoOre: c.pacchettoOre || null,
    dataInizio: c.dataInizio || null,
    tagViews: Array.isArray(c.tagViews) ? c.tagViews : null
  });
  let clients;
  if (s.role === 'admin') {
    clients = Object.entries(CLIENTS).map(([slug, c]) => pub(slug, c));
  } else if (s.slug && CLIENTS[s.slug]) {
    clients = [pub(s.slug, CLIENTS[s.slug])];
  } else {
    clients = [];
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    authenticated: true,
    role: s.role,
    slug: s.slug || null,
    expiresAt: s.exp || null,
    clients
  });
};
