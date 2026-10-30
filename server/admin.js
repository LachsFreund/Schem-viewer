#!/usr/bin/env node
'use strict';
/*
 * Konten verwalten (läuft gegen dieselbe Datenbank wie der Server):
 *
 *   DATABASE_URL=postgres://… node server/admin.js list
 *   DATABASE_URL=postgres://… node server/admin.js disable  <name>   Konto sperren (Sitzungen enden sofort)
 *   DATABASE_URL=postgres://… node server/admin.js enable   <name>
 *   DATABASE_URL=postgres://… node server/admin.js delete   <name>
 *   DATABASE_URL=postgres://… node server/admin.js passwd   <name>   neues Passwort setzen (Eingabe im Terminal)
 *
 * Als DATABASE_URL nimmst du bei Render die "External Database URL" (am Ende ?sslmode=require anhängen).
 * Ohne DATABASE_URL wird die lokale Datei data/store.json benutzt.
 */
const readline = require('readline');
const { createStore } = require('./store');
const auth = require('./auth');

const ask = q => new Promise(res => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); res(a); }); });

(async () => {
  const [cmd, name] = process.argv.slice(2);
  const store = await createStore(process.env);
  const key = (name || '').toLowerCase();
  const done = ok => console.log(ok ? 'OK' : `Benutzer "${name}" nicht gefunden.`);

  if (cmd === 'list') {
    const users = await store.listUsers();
    if (!users.length) console.log('Keine Konten.');
    for (const u of users) console.log(`${String(u.id).padStart(4)}  ${u.name.padEnd(24)} ${u.disabled ? 'GESPERRT' : 'aktiv   '}  ${new Date(u.createdAt).toISOString().slice(0, 10)}`);
  } else if (['disable', 'enable', 'delete', 'passwd'].includes(cmd) && name) {
    if (cmd === 'disable') done(await store.setDisabled(key, true));
    else if (cmd === 'enable') done(await store.setDisabled(key, false));
    else if (cmd === 'delete') done(await store.deleteUser(key));
    else {
      const pw = await ask('Neues Passwort (mind. 10 Zeichen): ');
      if (pw.length < 10) { console.error('Zu kurz.'); process.exitCode = 1; }
      else done(await store.setPassword(key, await auth.hashPassword(pw)));
    }
  } else {
    console.log('Aufruf: node server/admin.js list | disable <name> | enable <name> | delete <name> | passwd <name>');
    process.exitCode = 1;
  }
  await store.close();
})().catch(e => { console.error('FEHLER: ' + e.message); process.exit(1); });
