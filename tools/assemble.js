#!/usr/bin/env node
/*
 * Baut den Ordner dist/ zusammen – das ist der EINZIGE Ordner, der veröffentlicht wird (Render: "Publish Directory").
 *
 *   node tools/assemble.js start    leert dist/ und .build/ und legt die Ordner an
 *   node tools/assemble.js finish   kopiert Oberfläche (index.html, CSS), räumt .build/ auf und PRÜFT dist/
 *
 * Die Prüfung bricht den Build ab, wenn in dist/ etwas liegt, das nicht dort hingehört
 * (z. B. Quelltext, app.html oder ein unverschlüsseltes Bundle).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);
const mode = process.argv[2];

const ALLOWED = ['index.html', 'css/style.css', 'css/login.css', 'js/payload.js', 'js/login.js'];

function walk(dir, base = dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

if (mode === 'start') {
  fs.rmSync(p('dist'), { recursive: true, force: true });
  fs.rmSync(p('.build'), { recursive: true, force: true });
  for (const d of ['dist/js', 'dist/css', '.build']) fs.mkdirSync(p(d), { recursive: true });
  console.log('dist/ und .build/ vorbereitet');
} else if (mode === 'finish') {
  fs.copyFileSync(p('index.html'), p('dist/index.html'));
  fs.copyFileSync(p('css/style.css'), p('dist/css/style.css'));
  fs.copyFileSync(p('css/login.css'), p('dist/css/login.css'));
  fs.rmSync(p('.build'), { recursive: true, force: true });

  const files = walk(p('dist')).sort();
  const extra = files.filter(f => !ALLOWED.includes(f));
  const missing = ALLOWED.filter(f => !files.includes(f));
  if (extra.length || missing.length) {
    console.error('FEHLER: dist/ ist nicht wie erwartet.');
    if (extra.length) console.error('  Unerwartet (darf nicht veröffentlicht werden): ' + extra.join(', '));
    if (missing.length) console.error('  Fehlt: ' + missing.join(', '));
    process.exit(1);
  }
  const payload = fs.readFileSync(p('dist/js/payload.js'), 'utf8');
  if (/BufferGeometry|Schematic|toolbar|minecraft-assets/.test(payload)) {
    console.error('FEHLER: dist/js/payload.js enthält lesbaren Klartext – Verschlüsselung prüfen.');
    process.exit(1);
  }
  console.log('dist/ geprüft – enthält nur: ' + files.join(', '));
} else {
  console.error('Aufruf: node tools/assemble.js start|finish');
  process.exit(1);
}
