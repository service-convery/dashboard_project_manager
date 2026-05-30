// POST /api/logout — pulisce il cookie di sessione
const session = require('../lib/session');

module.exports = (req, res) => {
  session.clearSessionCookie(res);
  res.status(200).json({ ok: true });
};
