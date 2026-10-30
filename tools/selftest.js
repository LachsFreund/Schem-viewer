#!/usr/bin/env node
'use strict';
/*
 * Selbsttest für Konten + Schutz des App-Blocks:   npm run selftest
 * Startet den echten Server in-process mit einem Test-Paket und einer temporären Datei als Speicher
 * (dein dist/ und deine echte Datenbank werden NICHT angefasst).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');
const { createApp } = require('../server');
const { FileStore } = require('../server/store');

const ACCESS_KEY = 'Test-Zugangsschluessel-123';
const SECRET_HTML = '<div id="geheime-oberflaeche">Toolbar</div>';
const SECRET_JS = 'console.log("geheimer App-Code");';

function buildTestDist(dir) {
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Login</title>');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), n = 20000;       // wenig Runden: nur für den Test
  const packed = zlib.deflateRawSync(Buffer.from(JSON.stringify({ html: SECRET_HTML, js: SECRET_JS })));
  const key = crypto.pbkdf2Sync(ACCESS_KEY, salt, n, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(packed), c.final()]);
  const payload = { v: 2, z: 1, n, s: salt.toString('base64'), i: iv.toString('base64'), c: Buffer.concat([body, c.getAuthTag()]).toString('base64') };
  fs.writeFileSync(path.join(dir, 'js', 'payload.js'), 'window.__SV_PAYLOAD=' + JSON.stringify(payload) + ';\n');
}

function decryptServed(payload, keyB64) {
  const ct = Buffer.from(payload.c, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(payload.i, 'base64'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(zlib.inflateRawSync(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])).toString('utf8'));
}

async function startServer(dist, dataDir, requireAccount) {
  const store = new FileStore(dataDir); await store.init();
  const app = await createApp({ store, accessKey: ACCESS_KEY, distDir: dist, requireAccount });
  const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = async () => { await new Promise(r => server.close(r)); await app.close(); };
  return { base, store, stop, host: `127.0.0.1:${server.address().port}` };
}

class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const r = await fetch(this.base + url, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    let data = null; const txt = await r.text(); try { data = JSON.parse(txt); } catch (e) { data = txt; }
    return { status: r.status, data, headers: r.headers, setCookie: sc };
  }
}

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.message || e).toString().split('\n')[0]); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-selftest-'));
  const dist = path.join(tmp, 'dist'); buildTestDist(dist);
  const dataDir = path.join(tmp, 'data');
  let S = await startServer(dist, dataDir, true);
  const c = new Client(S.base);

  console.log('Konto-Pflicht (REQUIRE_ACCOUNT=true)');
  await t('Status: Konten aktiv, niemand angemeldet', async () => {
    const r = await c.req('GET', '/api/status'); assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.data.accounts, r.data.requireAccount, r.data.user], [true, true, null]);
  });
  await t('payload.js ist NICHT öffentlich abrufbar', async () => { assert.strictEqual((await c.req('GET', '/js/payload.js')).status, 404); });
  await t('Login-Seite (index.html) ist öffentlich', async () => { assert.strictEqual((await c.req('GET', '/')).status, 200); });
  await t('/api/payload ohne Anmeldung: 401', async () => { assert.strictEqual((await c.req('GET', '/api/payload')).status, 401); });

  console.log('Registrierung');
  await t('falscher Zugangsschlüssel: 403', async () => {
    assert.strictEqual((await c.req('POST', '/api/register', { username: 'anna', password: 'sicheres-passwort', accessKey: 'falsch' })).status, 403);
  });
  await t('ungültiger Benutzername: 400', async () => {
    assert.strictEqual((await c.req('POST', '/api/register', { username: 'a b', password: 'sicheres-passwort', accessKey: ACCESS_KEY })).status, 400);
  });
  await t('zu kurzes Passwort: 400', async () => {
    assert.strictEqual((await c.req('POST', '/api/register', { username: 'anna', password: 'kurz', accessKey: ACCESS_KEY })).status, 400);
  });
  await t('Passwort = Benutzername: 400', async () => {
    assert.strictEqual((await c.req('POST', '/api/register', { username: 'annaanna12', password: 'AnnaAnna12', accessKey: ACCESS_KEY })).status, 400);
  });
  await t('Konto erstellen: 201 + Cookie (HttpOnly, SameSite=Strict)', async () => {
    const r = await c.req('POST', '/api/register', { username: 'Anna', password: 'sicheres-passwort', accessKey: ACCESS_KEY, remember: true });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.user.name, 'Anna');
    assert.ok(/HttpOnly/i.test(r.setCookie) && /SameSite=Strict/i.test(r.setCookie) && /Max-Age=/i.test(r.setCookie), r.setCookie);
  });
  await t('Benutzername doppelt (Groß-/Kleinschreibung egal): 409', async () => {
    const r = await new Client(S.base).req('POST', '/api/register', { username: 'ANNA', password: 'anderes-passwort', accessKey: ACCESS_KEY });
    assert.strictEqual(r.status, 409);
  });

  console.log('Zugriff auf den App-Block');
  await t('mit Sitzung: Block + Schlüssel, entschlüsselt zum echten Inhalt', async () => {
    const r = await c.req('GET', '/api/payload'); assert.strictEqual(r.status, 200);
    const d = decryptServed(r.data.payload, r.data.key);
    assert.strictEqual(d.html, SECRET_HTML); assert.strictEqual(d.js, SECRET_JS);
  });
  await t('Status zeigt den angemeldeten Nutzer', async () => { assert.strictEqual((await c.req('GET', '/api/status')).data.user.name, 'Anna'); });
  await t('Abmelden: danach wieder 401', async () => {
    assert.strictEqual((await c.req('POST', '/api/logout', {})).status, 200);
    assert.strictEqual((await c.req('GET', '/api/payload')).status, 401);
  });

  console.log('Anmeldung');
  const anna = new Client(S.base);
  await t('falsches Passwort und unbekannter Nutzer geben dieselbe Meldung (401)', async () => {
    const a = await anna.req('POST', '/api/login', { username: 'Anna', password: 'falsch-falsch-falsch' });
    const b = await anna.req('POST', '/api/login', { username: 'gibtsnicht', password: 'falsch-falsch-falsch' });
    assert.strictEqual(a.status, 401); assert.strictEqual(b.status, 401); assert.strictEqual(a.data.error, b.data.error);
  });
  await t('richtiges Passwort (auch mit anderer Schreibweise des Namens): 200', async () => {
    const r = await anna.req('POST', '/api/login', { username: 'aNNa', password: 'sicheres-passwort' });
    assert.strictEqual(r.status, 200); assert.strictEqual((await anna.req('GET', '/api/payload')).status, 200);
  });
  await t('Sitzung ohne "Angemeldet bleiben" ist ein Sitzungs-Cookie (kein Max-Age)', async () => {
    const r = await new Client(S.base).req('POST', '/api/login', { username: 'Anna', password: 'sicheres-passwort', remember: false });
    assert.ok(!/Max-Age/i.test(r.setCookie), r.setCookie);
  });
  await t('Ratenbegrenzung: nach 8 Fehlversuchen 429, selbst mit richtigem Passwort', async () => {
    const x = new Client(S.base); let last;
    for (let i = 0; i < 8; i++) last = await x.req('POST', '/api/login', { username: 'Opfer', password: 'falsch-falsch-' + i });
    assert.strictEqual(last.status, 401);
    const r = await x.req('POST', '/api/login', { username: 'Opfer', password: 'noch-ein-versuch' });
    assert.strictEqual(r.status, 429); assert.ok(r.headers.get('retry-after'));
  });

  console.log('Schutz vor Missbrauch');
  await t('Anfrage mit fremdem Origin: 403', async () => {
    const r = await new Client(S.base).req('POST', '/api/login', { username: 'Anna', password: 'sicheres-passwort' }, { Origin: 'https://boese-seite.example' });
    assert.strictEqual(r.status, 403);
  });
  await t('Anfrage mit gleichem Origin: ok', async () => {
    const r = await new Client(S.base).req('POST', '/api/login', { username: 'Anna', password: 'sicheres-passwort' }, { Origin: 'http://' + S.host });
    assert.strictEqual(r.status, 200);
  });
  await t('kein JSON (Formular-Post): 415', async () => {
    const r = await new Client(S.base).req('POST', '/api/login', 'username=Anna&password=x', { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.strictEqual(r.status, 415);
  });
  await t('Passwort und Sitzungs-Token stehen nicht im Klartext im Speicher', async () => {
    const raw = fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8');
    assert.ok(!raw.includes('sicheres-passwort'), 'Passwort im Klartext!');
    assert.ok(raw.includes('scrypt$'), 'kein scrypt-Hash');
    const tok = decodeURIComponent(anna.cookie.split('=')[1]);
    assert.ok(!raw.includes(tok), 'Sitzungs-Token im Klartext!');
  });

  console.log('Sperren');
  await t('gesperrtes Konto: laufende Sitzung endet sofort, Login 403', async () => {
    assert.strictEqual((await anna.req('GET', '/api/payload')).status, 200);
    await S.store.setDisabled('anna', true);
    assert.strictEqual((await anna.req('GET', '/api/payload')).status, 401);
    assert.strictEqual((await new Client(S.base).req('POST', '/api/login', { username: 'Anna', password: 'sicheres-passwort' })).status, 403);
    await S.store.setDisabled('anna', false);
    assert.strictEqual((await new Client(S.base).req('POST', '/api/login', { username: 'Anna', password: 'sicheres-passwort' })).status, 200);
  });
  await t('gelöschtes Konto kann sich nicht mehr anmelden', async () => {
    await S.store.deleteUser('anna');
    assert.strictEqual((await new Client(S.base).req('POST', '/api/login', { username: 'Anna', password: 'sicheres-passwort' })).status, 401);
  });
  await t('Konten überstehen einen Neustart des Servers', async () => {
    await new Client(S.base).req('POST', '/api/register', { username: 'Bernd', password: 'noch-ein-passwort', accessKey: ACCESS_KEY });
    await S.stop();
    S = await startServer(dist, dataDir, true);
    const r = await new Client(S.base).req('POST', '/api/login', { username: 'bernd', password: 'noch-ein-passwort' });
    assert.strictEqual(r.status, 200);
  });
  await S.stop();

  console.log('Schlüssel genügt weiterhin (REQUIRE_ACCOUNT=false)');
  S = await startServer(dist, path.join(tmp, 'data2'), false);
  await t('payload.js bleibt öffentlich (Schlüssel-Modus funktioniert)', async () => { assert.strictEqual((await new Client(S.base).req('GET', '/js/payload.js')).status, 200); });
  await t('Status meldet requireAccount=false', async () => { assert.strictEqual((await new Client(S.base).req('GET', '/api/status')).data.requireAccount, false); });
  await S.stop();

  console.log('Start-Prüfung');
  await t('Server weigert den Start, wenn ACCESS_KEY nicht zum gebauten Block passt', async () => {
    const st = new FileStore(path.join(tmp, 'data3')); await st.init();
    await assert.rejects(() => createApp({ store: st, accessKey: 'ein-anderer-schluessel', distDir: dist, requireAccount: true }), /passt nicht zum gebauten/);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FEHLER:', e); process.exit(1); });
