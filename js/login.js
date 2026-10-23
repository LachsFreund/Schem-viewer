/*
 * Login / Entschlüsselung.
 * Die App (JavaScript + Oberfläche) liegt nur verschlüsselt vor (window.__SV_PAYLOAD, AES-256-GCM).
 * Der Schlüssel wird per PBKDF2-SHA256 aus dem eingegebenen Zugangsschlüssel abgeleitet.
 * Ohne den richtigen Schlüssel gibt es keinen lesbaren App-Code – es ist keine bloße "if (key === ...)"-Abfrage.
 * Benötigt einen sicheren Kontext (https oder localhost) wegen WebCrypto.
 */
(() => {
  const P = window.__SV_PAYLOAD;
  const $ = id => document.getElementById(id);
  const STORE = 'sv-access';
  const enc = new TextEncoder(), dec = new TextDecoder();

  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };

  const msg = (t, info) => { const m = $('loginMsg'); m.textContent = t || ''; m.className = info ? 'info' : ''; };

  async function derive(pass) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromB64(P.s), iterations: P.n, hash: 'SHA-256' }, base, 256);
    return new Uint8Array(bits);
  }

  async function decrypt(raw) {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(P.i) }, key, fromB64(P.c));
    return JSON.parse(dec.decode(plain));
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

  let fails = 0, lockUntil = 0;

  async function submit(ev) {
    ev.preventDefault();
    const now = Date.now();
    if (now < lockUntil) { msg(`Zu viele Versuche – bitte ${Math.ceil((lockUntil - now) / 1000)} s warten.`); return; }
    const pass = $('loginKey').value;
    if (!pass) return;
    $('loginBtn').disabled = true;
    msg('Prüfe …', true);
    try {
      const raw = await derive(pass);
      const data = await decrypt(raw);
      remember(raw, $('loginRemember').checked);
      msg('');
      start(data);
    } catch (e) {
      fails++;
      if (fails >= 5) { lockUntil = Date.now() + 30000; fails = 0; }
      msg('Falscher Schlüssel.');
      const f = $('loginForm'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      $('loginKey').select();
    } finally {
      $('loginBtn').disabled = false;
    }
  }

  async function init() {
    if (!P) { msg('Zugangsdaten fehlen (payload.js wurde nicht geladen).'); return; }
    if (!(window.crypto && crypto.subtle)) { msg('Für den Login ist eine sichere Verbindung (https) erforderlich.'); return; }
    $('loginForm').addEventListener('submit', submit);

    const raw = stored();                     // "Angemeldet bleiben": gespeicherten Schlüssel automatisch versuchen
    if (raw) {
      msg('Melde an …', true);
      try { start(await decrypt(raw)); msg(''); return; }
      catch (e) { forget(); msg(''); }
    }
    $('loginKey').focus();
  }

  init();
})();
