// === Pagina di login / picker clienti ===
// Flusso autocontenuto: verifica sessione (/api/me), mostra il picker se
// autenticato, altrimenti il form di login (con toggle modalità admin).

const card = document.getElementById('card');
const tplLogo = document.getElementById('tplLogo').innerHTML;
const params = new URLSearchParams(location.search);
const urlSlug = (params.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
const redirect = params.get('redirect') || '';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderLogin(initialSlug, adminMode) {
  const slugRowDisplay = adminMode ? 'none' : '';
  card.innerHTML = tplLogo + `
    <h1>Dashboard Clienti</h1>
    <p class="subtitle">${adminMode ? 'Modalità admin' : 'Accedi alla tua dashboard'}</p>
    <div id="errorBox" class="error"></div>
    <form id="loginForm" autocomplete="off">
      <div class="form-row" id="slugRow" style="display:${slugRowDisplay};">
        <label for="slug">Cliente (slug)</label>
        <input id="slug" name="slug" type="text" value="${esc(initialSlug)}" autocomplete="username" placeholder="es. Nome Azienda" pattern="[a-z0-9-]+" />
      </div>
      <div class="form-row">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" autofocus />
      </div>
      <button class="btn" id="submitBtn" type="submit">Accedi</button>
    </form>
    <div class="hint">
      <span class="toggle-link" id="toggleAdmin">${adminMode ? '← torna a login cliente' : 'Accesso Admin'}</span>
    </div>
  `;
  document.getElementById('toggleAdmin').addEventListener('click', () => {
    renderLogin(initialSlug, !adminMode);
  });
  document.getElementById('loginForm').addEventListener('submit', handleSubmit);
}

async function handleSubmit(ev) {
  ev.preventDefault();
  const slugInput = document.getElementById('slug');
  const passwordInput = document.getElementById('password');
  const errBox = document.getElementById('errorBox');
  const btn = document.getElementById('submitBtn');
  const slug = slugInput ? (slugInput.value || '').trim().toLowerCase() : '';
  const password = passwordInput.value;
  errBox.classList.remove('visible');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Accesso…';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slug || null, password })
    });
    if (!r.ok) {
      let msg = 'Credenziali non valide';
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch {}
      errBox.textContent = msg;
      errBox.classList.add('visible');
      btn.disabled = false;
      btn.textContent = 'Accedi';
      return;
    }
    const data = await r.json();
    let dest = redirect;
    if (!dest) {
      if (data.role === 'admin') {
        dest = '/'; // verrà mostrato il picker
      } else if (data.slug) {
        dest = '/d/' + data.slug;
      } else {
        dest = '/';
      }
    }
    location.href = dest;
  } catch (e) {
    errBox.textContent = 'Errore di rete: ' + (e.message || e);
    errBox.classList.add('visible');
    btn.disabled = false;
    btn.textContent = 'Accedi';
  }
}

function renderPicker(me) {
  const links = me.clients.map(c =>
    `<a class="client-link" href="/d/${esc(c.slug)}">${esc(c.name)}</a>`
  ).join('');
  card.innerHTML = tplLogo + `
    <div class="session-badge"><span class="dot"></span>Sessione attiva · ${esc(me.role)}</div>
    <h1>Le tue dashboard</h1>
    <p class="subtitle">${me.clients.length} ${me.clients.length === 1 ? 'cliente disponibile' : 'clienti disponibili'}</p>
    ${links || '<p class="hint">Nessun cliente associato al tuo account.</p>'}
    <button class="btn btn-ghost" id="logoutBtn" style="margin-top:16px;">Esci</button>
  `;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
  });
}

async function boot() {
  try {
    const r = await fetch('/api/me');
    if (r.ok) {
      const me = await r.json();
      if (me.authenticated) {
        if (me.clients.length === 1) {
          location.href = '/d/' + me.clients[0].slug;
          return;
        }
        renderPicker(me);
        return;
      }
    }
  } catch {}
  renderLogin(urlSlug, false);
}

boot();
