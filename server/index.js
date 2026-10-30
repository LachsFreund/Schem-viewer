'use strict';
/*
 * Server für den Schematic Viewer.
 *
 *  - liefert dist/ aus (Login-Seite, CSS, login.js)
 *  - Konten (Benutzername + Passwort); zum REGISTRIEREN wird der Zugangsschlüssel (ACCESS_KEY) benötigt
 *  - der verschlüsselte App-Block (payload.js) wird nur an angemeldete Nutzer ausgeliefert (REQUIRE_ACCOUNT=true, Standard)
 *
 * Umgebungsvariablen:
 *   ACCESS_KEY        (Pflicht) derselbe Schlüssel, mit dem der Build verschlüsselt hat
 *   DATABASE_URL      PostgreSQL-Verbindung (Render). Ohne: JSON-Datei in DATA_DIR (nur Test / persistenter Datenträger)
 *   REQUIRE_ACCOUNT   "false" = der Schlüssel allein genügt weiterhin zum Entsperren (Standard: true)
 *   PORT              Standard 3000
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const auth = require('./auth');
const { createStore } = require('./store');

const COOKIE = 'sv_sid';
const NAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const DAY = 86400000;

function readPayload(distDir) {
  const f = path.join(distDir, 'js', 'payload.js');
  if (!fs.existsSync(f)) throw new Error('dist/js/payload.js fehlt – zuerst "npm run build" ausführen.');
  const txt = fs.readFileSync(f, 'utf8').replace(/^window\.__SV_PAYLOAD=/, '').replace(/;\s*$/, '');
  return JSON.parse(txt);
}

function getCookie(req, name) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return null; } }
  }
  return null;
}

async function createApp(opts) {
  const { store, accessKey, distDir } = opts;
  const requireAccount = opts.requireAccount !== false;
  if (!accessKey) throw new Error('ACCESS_KEY fehlt.');

  const payload = readPayload(distDir);
  // Schlüssel zum Entschlüsseln (wie login.js ihn aus dem Zugangsschlüssel ableitet) – wird nur nach erfolgreicher Anmeldung ausgeliefert
  const payloadKey = crypto.pbkdf2Sync(Buffer.from(accessKey, 'utf8'), Buffer.from(payload.s, 'base64'), payload.n, 32, 'sha256').toString('base64');

  // Selbstprüfung: passt ACCESS_KEY zu dem beim Build verschlüsselten Block? (sonst könnte sich niemand entschlüsseln)
  try {
    const raw = Buffer.from(payloadKey, 'base64'), ct = Buffer.from(payload.c, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', raw, Buffer.from(payload.i, 'base64'));
    d.setAuthTag(ct.subarray(ct.length - 16));
    d.update(ct.subarray(0, ct.length - 16)); d.final();
  } catch (e) {
    throw new Error('ACCESS_KEY passt nicht zum gebauten dist/js/payload.js. Nach einer Änderung des Schlüssels muss neu gebaut/deployt werden ("npm run build").');
  }

  const loginByUser = new auth.Limiter(8, 15 * 60 * 1000);
  const loginByIp = new auth.Limiter(40, 15 * 60 * 1000);
  const registerByIp = new auth.Limiter(10, 60 * 60 * 1000);
  const timers = [
    setInterval(() => { loginByUser.prune(); loginByIp.prune(); registerByIp.prune(); }, 10 * 60 * 1000),
    setInterval(() => store.purgeExpired().catch(() => {}), 60 * 60 * 1000)
  ];
  timers.forEach(t => t.unref());

  const app = express();
  app.disable('x-powered-by');
  // Render steht hinter einem Proxy: so viele Proxy-Stufen werden vertraut, damit req.ip die echte Besucher-IP ist
  // (wichtig für die Ratenbegrenzung). Bei Bedarf per Umgebungsvariable TRUST_PROXY anpassen (siehe DEPLOY.md).
  app.set('trust proxy', Number.isInteger(opts.trustProxy) ? opts.trustProxy : 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '4kb' }));
  app.use((err, req, res, next) => (err && err.type ? res.status(400).json({ error: 'Ungültige Anfrage.' }) : next(err)));

  // Schutz vor Cross-Site-Anfragen: nur gleiche Herkunft, nur JSON
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST') {
      if (!req.is('application/json')) return res.status(415).json({ error: 'Nur JSON erlaubt.' });
      const o = req.headers.origin;
      if (o) { let ok = false; try { ok = new URL(o).host === req.headers.host; } catch (e) {} if (!ok) return res.status(403).json({ error: 'Anfrage von fremder Seite abgelehnt.' }); }
    }
    next();
  });

  /* ---------- Sitzungen ---------- */
  async function sessionUser(req) {
    const tok = getCookie(req, COOKIE);
    if (!tok) return null;
    const s = await store.getSession(auth.tokenHash(tok));
    if (!s) return null;
    if (s.expires < Date.now()) { await store.deleteSession(auth.tokenHash(tok)); return null; }
    const u = await store.getUserById(s.userId);
    return u && !u.disabled ? u : null;
  }

  async function startSession(req, res, user, remember) {
    const tok = auth.newToken();
    const ttl = remember ? 30 * DAY : DAY;              // ohne "Angemeldet bleiben": Sitzungs-Cookie, serverseitig max. 24 h
    await store.createSession({ hash: auth.tokenHash(tok), userId: user.id, expires: Date.now() + ttl });
    const parts = [`${COOKIE}=${encodeURIComponent(tok)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (remember) parts.push(`Max-Age=${Math.floor(ttl / 1000)}`);
    if (req.secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  const clearCookie = (req, res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${req.secure ? '; Secure' : ''}`);
  const str = v => (typeof v === 'string' ? v : '');

  /* ---------- API ---------- */
  app.get('/api/status', async (req, res) => {
    const u = await sessionUser(req).catch(() => null);
    res.json({ accounts: true, requireAccount, user: u ? { name: u.name } : null });
  });

  app.post('/api/register', async (req, res) => {
    try {
      const ip = req.ip;
      const wait = registerByIp.blocked(ip);
      if (wait) return res.status(429).set('Retry-After', wait).json({ error: `Zu viele Versuche – bitte ${wait} s warten.` });

      const name = str(req.body.username).trim(), password = str(req.body.password), key = str(req.body.accessKey);
      if (!auth.safeEqual(key, accessKey)) { registerByIp.fail(ip); console.log(`[auth] Registrierung abgelehnt (falscher Schlüssel) ip=${ip}`); return res.status(403).json({ error: 'Falscher Zugangsschlüssel.' }); }
      if (!NAME_RE.test(name)) return res.status(400).json({ error: 'Benutzername: 3–24 Zeichen (Buchstaben, Zahlen, _ . -).' });
      if (password.length < 10) return res.status(400).json({ error: 'Das Passwort braucht mindestens 10 Zeichen.' });
      if (password.length > 128) return res.status(400).json({ error: 'Das Passwort darf höchstens 128 Zeichen haben.' });
      if (password.toLowerCase() === name.toLowerCase()) return res.status(400).json({ error: 'Das Passwort darf nicht dem Benutzernamen entsprechen.' });

      let user;
      try { user = await store.createUser({ name, nameKey: name.toLowerCase(), passHash: await auth.hashPassword(password) }); }
      catch (e) { if (e.message === 'exists') return res.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' }); throw e; }
      console.log(`[auth] Konto erstellt: ${user.name} ip=${ip}`);
      registerByIp.fail(ip);   // auch erfolgreiche Registrierungen zählen (Schutz vor Massen-Konten)
      await startSession(req, res, user, !!req.body.remember);
      res.status(201).json({ ok: true, user: { name: user.name } });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Serverfehler.' }); }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const ip = req.ip;
      const name = str(req.body.username).trim(), password = str(req.body.password);
      const kUser = ip + '|' + name.toLowerCase();
      const wait = loginByIp.blocked(ip) || loginByUser.blocked(kUser);
      if (wait) return res.status(429).set('Retry-After', wait).json({ error: `Zu viele Versuche – bitte ${wait} s warten.` });

      const user = name.length <= 64 && password.length <= 128 ? await store.getUserByKey(name.toLowerCase()) : null;
      const ok = await auth.verifyPassword(password, user ? user.passHash : await auth.dummyHash());
      if (!user || !ok) { loginByIp.fail(ip); loginByUser.fail(kUser); console.log(`[auth] Login fehlgeschlagen: ${name.slice(0, 32)} ip=${ip}`); return res.status(401).json({ error: 'Benutzername oder Passwort falsch.' }); }
      if (user.disabled) return res.status(403).json({ error: 'Dieses Konto ist deaktiviert.' });

      loginByUser.reset(kUser);
      console.log(`[auth] Login: ${user.name} ip=${ip}`);
      await startSession(req, res, user, !!req.body.remember);
      res.json({ ok: true, user: { name: user.name } });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Serverfehler.' }); }
  });

  app.post('/api/logout', async (req, res) => {
    const tok = getCookie(req, COOKIE);
    if (tok) await store.deleteSession(auth.tokenHash(tok)).catch(() => {});
    clearCookie(req, res);
    res.json({ ok: true });
  });

  // Der verschlüsselte App-Block + der Schlüssel dazu – nur mit gültiger Sitzung
  app.get('/api/payload', async (req, res) => {
    const u = await sessionUser(req).catch(() => null);
    if (!u) return res.status(401).json({ error: 'Nicht angemeldet.' });
    res.json({ payload, key: payloadKey, user: { name: u.name } });
  });

  /* ---------- statische Dateien ---------- */
  if (requireAccount) app.get('/js/payload.js', (req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use(express.static(distDir, {
    index: 'index.html', dotfiles: 'ignore',
    setHeaders: (res, file) => { if (/\.html$|payload\.js$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); }
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unbekannt.' }));

  app.close = async () => { timers.forEach(clearInterval); await store.close(); };
  return app;
}

module.exports = { createApp };

if (require.main === module) {
  (async () => {
    const accessKey = process.env.ACCESS_KEY;
    if (!accessKey) { console.error('FEHLER: Umgebungsvariable ACCESS_KEY fehlt.'); process.exit(1); }
    if (!process.env.DATABASE_URL) console.warn('Hinweis: DATABASE_URL fehlt – Konten werden in einer lokalen Datei gespeichert (auf Render gehen sie bei jedem Deploy verloren!).');
    const store = await createStore(process.env);
    const app = await createApp({
      store, accessKey,
      distDir: path.resolve(__dirname, '..', 'dist'),
      requireAccount: String(process.env.REQUIRE_ACCOUNT || 'true').toLowerCase() !== 'false',
      trustProxy: process.env.TRUST_PROXY !== undefined ? parseInt(process.env.TRUST_PROXY, 10) : 1
    });
    const port = +process.env.PORT || 3000;
    app.listen(port, () => console.log(`Server läuft auf Port ${port} (Konto Pflicht: ${String(process.env.REQUIRE_ACCOUNT || 'true').toLowerCase() !== 'false'})`));
  })().catch(e => { console.error('FEHLER: ' + e.message); process.exit(1); });
}
