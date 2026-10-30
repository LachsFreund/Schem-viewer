/*
 * Login / Entschlüsselung.
 *
 * Die App (JavaScript + Oberfläche) liegt nur verschlüsselt vor (AES-256-GCM, Schlüssel per PBKDF2 aus dem Zugangsschlüssel).
 * Zwei Wege hinein:
 *   1. Schlüssel-Modus  – Zugangsschlüssel eingeben, der Browser entschlüsselt selbst (funktioniert auch ohne Server)
 *   2. Konto-Modus      – Benutzername + Passwort (Server unter /api); der Server liefert den App-Block erst nach der Anmeldung.
 *                         Ein Konto legt man mit dem Zugangsschlüssel an ("Registrieren").
 * Läuft nur in einem sicheren Kontext (https oder localhost) wegen WebCrypto.
 */
(() => {
  const P = window.__SV_PAYLOAD;            // nur vorhanden, wenn payload.js öffentlich ausgeliefert wird
  const $ = id => document.getElementById(id);
  const STORE = 'sv-access';
  const enc = new TextEncoder(), dec = new TextDecoder();

  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const msg = (t, info) => { const m = $('loginMsg'); m.textContent = t || ''; m.className = info ? 'info' : ''; };
  const shake = () => { const f = $('loginForm'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); };

  let api = null;                           // Antwort von /api/status (null = kein Server)
  let mode = 'key';

  /* ---------- Krypto ---------- */
  async function derive(pass) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromB64(P.s), iterations: P.n, hash: 'SHA-256' }, base, 256);
    return new Uint8Array(bits);
  }

  async function decryptWith(pl, raw) {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(pl.i) }, key, fromB64(pl.c));
    if (!pl.z) return JSON.parse(dec.decode(plain));
    if (typeof DecompressionStream === 'undefined') throw new Error('nodecomp');
    const unpacked = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return JSON.parse(dec.decode(unpacked));
  }

  function start(data) {
    $('app').innerHTML = data.html;
    const finish = () => $('login').classList.add('hidden');
    const url = URL.createObjectURL(new Blob([data.js], { type: 'text/javascript' }));
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => { URL.revokeObjectURL(url); finish(); };
    s.onerror = () => {                      // Fallback, falls blob:-Skripte durch eine CSP blockiert sind
      try { (0, eval)(data.js); finish(); }
      catch (e) { msg('Die App konnte nicht gestartet werden (Content-Security-Policy?).'); console.error(e); }
    };
    document.body.appendChild(s);
  }

  /* ---------- gemerkter Schlüssel (nur Schlüssel-Modus) ---------- */
  const storages = () => [window.localStorage, window.sessionStorage];
  const forget = () => { for (const st of storages()) { try { st.removeItem(STORE); } catch (e) {} } };
  const remember = (raw, persistent) => {
    try { (persistent ? window.localStorage : window.sessionStorage).setItem(STORE, JSON.stringify({ s: P.s, k: toB64(raw) })); } catch (e) {}
  };
  function stored() {
    for (const st of storages()) {
      try {
        const v = JSON.parse(st.getItem(STORE) || 'null');
        if (v && v.s === P.s && v.k) return fromB64(v.k);   // nur gültig, solange der Build (Salt) derselbe ist
      } catch (e) {}
    }
    return null;
  }

  /* ---------- Server (Konten) ---------- */
  async function call(url, body) {
    const opt = { credentials: 'same-origin', cache: 'no-store' };
    if (body) { opt.method = 'POST'; opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    const r = await fetch(url, opt);
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data: data || {} };
  }

  async function fetchStatus() {
    if (typeof fetch !== 'function') return null;
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 4000) : null;
      const r = await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (timer) clearTimeout(timer);
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.accounts ? j : null;
    } catch (e) { return null; }
  }

  async function openFromAccount(name) {
    const r = await call('/api/payload');
    if (!r.ok) throw new Error('payload');
    const data = await decryptWith(r.data.payload, fromB64(r.data.key));
    window.__SV_USER = name || (r.data.user && r.data.user.name) || '';
    start(data);
  }

  /* ---------- Oberfläche ---------- */
  const FIELDS = { fldUser: ['login', 'register'], fldPass: ['login', 'register'], fldKey: ['key', 'register'], fldRemember: ['key', 'login', 'register'] };
  const LABEL = { key: 'Entsperren', login: 'Anmelden', register: 'Konto erstellen' };

  function setMode(m) {
    mode = m;
    for (const [id, modes] of Object.entries(FIELDS)) $(id).hidden = !modes.includes(m);
    for (const [id, mm] of [['tabKey', 'key'], ['tabLogin', 'login'], ['tabRegister', 'register']]) $(id).classList.toggle('active', mm === m);
    $('loginBtn').textContent = LABEL[m];
    $('loginKey').placeholder = m === 'register' ? 'Zugangsschlüssel (Einladung)' : 'Zugangsschlüssel';
    $('loginPass').autocomplete = m === 'register' ? 'new-password' : 'current-password';
    $('loginPass').placeholder = m === 'register' ? 'Passwort (mind. 10 Zeichen)' : 'Passwort';
    msg('');
    const first = m === 'key' ? 'loginKey' : 'loginUser';
    if ($(first).focus) $(first).focus();
  }

  let fails = 0, lockUntil = 0;

  async function submitKey() {
    const now = Date.now();
    if (now < lockUntil) { msg(`Zu viele Versuche – bitte ${Math.ceil((lockUntil - now) / 1000)} s warten.`); return; }
    const pass = $('loginKey').value;
    if (!pass) return;
    msg('Prüfe …', true);
    try {
      const raw = await derive(pass);
      const data = await decryptWith(P, raw);
      remember(raw, $('loginRemember').checked);
      msg('');
      start(data);
    } catch (e) {
      if (e && e.message === 'nodecomp') { msg('Dieser Browser ist zu alt (DecompressionStream fehlt).'); return; }
      fails++;
      if (fails >= 5) { lockUntil = Date.now() + 30000; fails = 0; }
      msg('Falscher Schlüssel.');
      shake();
      $('loginKey').select();
    }
  }

  async function submitAccount() {
    const username = $('loginUser').value.trim(), password = $('loginPass').value;
    if (!username || !password) { msg('Benutzername und Passwort eingeben.'); return; }
    const body = { username, password, remember: $('loginRemember').checked };
    if (mode === 'register') {
      body.accessKey = $('loginKey').value;
      if (!body.accessKey) { msg('Für die Registrierung wird der Zugangsschlüssel benötigt.'); return; }
    }
    msg(mode === 'register' ? 'Erstelle Konto …' : 'Melde an …', true);
    let r;
    try { r = await call(mode === 'register' ? '/api/register' : '/api/login', body); }
    catch (e) { msg('Server nicht erreichbar.'); return; }
    if (!r.ok) { msg(r.data.error || 'Anmeldung fehlgeschlagen.'); shake(); return; }
    $('loginPass').value = '';
    try { await openFromAccount(r.data.user && r.data.user.name); msg(''); }
    catch (e) {
      msg(e && e.message === 'nodecomp' ? 'Dieser Browser ist zu alt (DecompressionStream fehlt).' : 'Die App konnte nicht entschlüsselt werden.');
    }
  }

  async function submit(ev) {
    ev.preventDefault();
    $('loginBtn').disabled = true;
    try { if (mode === 'key') await submitKey(); else await submitAccount(); }
    finally { $('loginBtn').disabled = false; }
  }

  async function init() {
    if (!(window.crypto && crypto.subtle)) { msg('Für den Login ist eine sichere Verbindung (https) erforderlich.'); return; }
    $('loginForm').addEventListener('submit', submit);
    $('tabKey').onclick = () => setMode('key');
    $('tabLogin').onclick = () => setMode('login');
    $('tabRegister').onclick = () => setMode('register');

    api = await fetchStatus();

    if (api) {                                               // Server mit Konten vorhanden
      if (api.user) { try { await openFromAccount(api.user.name); return; } catch (e) { /* weiter zur Anmeldung */ } }
      const keyAllowed = !api.requireAccount && !!P;
      $('tabKey').hidden = !keyAllowed;
      $('loginTabs').hidden = false;
      setMode(keyAllowed ? 'key' : 'login');
      if (!keyAllowed) return;
    } else {                                                 // reine statische Seite: nur Schlüssel
      $('loginTabs').hidden = true;
      setMode('key');
      if (!P) { msg('Zugangsdaten fehlen (payload.js wurde nicht geladen).'); return; }
    }

    const raw = stored();                                    // "Angemeldet bleiben": gespeicherten Schlüssel automatisch versuchen
    if (raw) {
      msg('Melde an …', true);
      try { start(await decryptWith(P, raw)); msg(''); return; }
      catch (e) { forget(); msg(''); }
    }
    if ($('loginKey').focus) $('loginKey').focus();
  }

  init();
})();
