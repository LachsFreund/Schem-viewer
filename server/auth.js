'use strict';
/* Passwort-Hashing (scrypt), Token, Zeitkonstanter Vergleich, Rate-Limiting. Nur Node-Bordmittel. */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

// OWASP-Empfehlung für scrypt: N=2^15, r=8, p=3
const PARAMS = { N: 32768, r: 8, p: 3 };
const KEYLEN = 32;
const MAXMEM = 128 * 1024 * 1024;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { ...PARAMS, maxmem: MAXMEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const want = Buffer.from(hash, 'base64');
    const got = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length,
      { N: +N, r: +r, p: +p, maxmem: MAXMEM });
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}

// Für unbekannte Benutzernamen trotzdem rechnen, damit die Antwortzeit nichts verrät
let dummy = null;
const dummyHash = () => dummy || (dummy = hashPassword('dummy-' + crypto.randomBytes(8).toString('hex')));

const sha256 = s => crypto.createHash('sha256').update(s).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(String(a)), sha256(String(b)));

const newToken = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');   // in der DB steht nur der Hash

/** Zählt Fehlversuche je Schlüssel in einem Zeitfenster. */
class Limiter {
  constructor(max, windowMs) { this.max = max; this.win = windowMs; this.m = new Map(); }
  _list(key) { const now = Date.now(); const a = (this.m.get(key) || []).filter(t => now - t < this.win); this.m.set(key, a); return a; }
  /** null = frei, sonst Sekunden bis zum nächsten Versuch */
  blocked(key) { const a = this._list(key); return a.length >= this.max ? Math.max(1, Math.ceil((a[0] + this.win - Date.now()) / 1000)) : null; }
  fail(key) { this._list(key).push(Date.now()); }
  reset(key) { this.m.delete(key); }
  prune() { for (const k of [...this.m.keys()]) if (!this._list(k).length) this.m.delete(k); }
}

module.exports = { hashPassword, verifyPassword, dummyHash, safeEqual, newToken, tokenHash, Limiter };
