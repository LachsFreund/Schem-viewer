#!/usr/bin/env node
/*
 * Verschlüsselt das (minifizierte + obfuskierte) Bundle und die App-Oberfläche mit dem Zugangsschlüssel.
 *
 *   Eingabe : .build/bundle.js    (minifiziert + obfuskiert, wird nie veröffentlicht)
 *             app.html            (Oberfläche der App, ohne <script>-Tags)
 *   Ausgabe : dist/js/payload.js  (window.__SV_PAYLOAD = { n, s, i, c })
 *   Danach wird .build/bundle.js GELÖSCHT, damit keine unverschlüsselte Kopie übrig bleibt
 *   (mit --keep bleibt sie erhalten).
 *
 * Woher kommt der Schlüssel?  (in dieser Reihenfolge)
 *   1. Umgebungsvariable ACCESS_KEY
 *   2. Datei .access-key im Projektordner (nicht ins Repository einchecken!)
 *   3. Eingabe im Terminal
 *
 * Verfahren: deflate-raw -> PBKDF2-HMAC-SHA256 (600 000 Runden, zufälliges Salt) -> AES-256-GCM (zufällige IV).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE = path.join(ROOT, '.build', 'bundle.js');
const APP_HTML = path.join(ROOT, 'app.html');
const OUT = path.join(ROOT, 'dist', 'js', 'payload.js');
const ITERATIONS = 600000;
const keep = process.argv.includes('--keep');

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

async function getKey() {
  if (process.env.ACCESS_KEY) return process.env.ACCESS_KEY;
  const file = path.join(ROOT, '.access-key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  if (process.stdin.isTTY) return await ask('Zugangsschlüssel für die Seite: ');
  throw new Error('Kein Schlüssel angegeben: ACCESS_KEY setzen, Datei .access-key anlegen oder im Terminal eingeben.');
}

(async () => {
  for (const f of [BUNDLE, APP_HTML]) {
    if (!fs.existsSync(f)) throw new Error('Datei fehlt: ' + path.relative(ROOT, f));
  }
  const pass = await getKey();
  if (!pass) throw new Error('Der Schlüssel darf nicht leer sein.');
  if (pass.length < 12) {
    console.warn(`Hinweis: Der Schlüssel hat nur ${pass.length} Zeichen. Je länger (mind. 12, zufällig), desto sicherer gegen Offline-Raten.`);
  }

  const plain = JSON.stringify({
    html: fs.readFileSync(APP_HTML, 'utf8'),
    js: fs.readFileSync(BUNDLE, 'utf8')
  });
  // Erst komprimieren, dann verschlüsseln (verschlüsselte Daten lassen sich nicht mehr komprimieren)
  const packed = zlib.deflateRawSync(Buffer.from(plain, 'utf8'), { level: 9 });

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(packed), cipher.final()]);
  const c = Buffer.concat([body, cipher.getAuthTag()]);   // WebCrypto erwartet Ciphertext || Tag

  const payload = { v: 2, z: 1, n: ITERATIONS, s: salt.toString('base64'), i: iv.toString('base64'), c: c.toString('base64') };
  fs.writeFileSync(OUT, 'window.__SV_PAYLOAD=' + JSON.stringify(payload) + ';\n');

  if (!keep) fs.unlinkSync(BUNDLE);
  console.log(`Verschlüsselt: ${path.relative(ROOT, OUT)} (${(plain.length / 1024).toFixed(0)} KB Klartext -> ${(c.length / 1024).toFixed(0)} KB komprimiert + verschlüsselt)` + (keep ? '' : ' – unverschlüsseltes Bundle gelöscht'));
})().catch(err => { console.error('FEHLER: ' + err.message); process.exit(1); });
