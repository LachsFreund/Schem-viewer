'use strict';
/*
 * Speicher für Konten und Sitzungen.
 *   - PgStore   : PostgreSQL (DATABASE_URL) – für Render
 *   - FileStore : JSON-Datei (DATA_DIR) – für lokale Tests; auf Render nur mit persistentem Datenträger sinnvoll
 */
const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'store.json');
    this.d = { nextId: 1, users: [], sessions: {} };
    this.queue = Promise.resolve();
    this.mtime = 0;
  }
  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    this._sync(true);
  }
  /** Datei neu einlesen, wenn ein anderer Prozess (z. B. admin.js) sie geändert hat. */
  _sync(force) {
    try {
      const m = fs.statSync(this.file).mtimeMs;
      if (force || m !== this.mtime) { this.d = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.mtime = m; }
    } catch (e) { /* Datei existiert noch nicht */ }
  }
  _save() {
    this.queue = this.queue.then(() => {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.d));
      fs.renameSync(tmp, this.file);
      this.mtime = fs.statSync(this.file).mtimeMs;
    });
    return this.queue;
  }
  async createUser({ name, nameKey, passHash }) {
    this._sync();
    if (this.d.users.some(u => u.nameKey === nameKey)) throw new Error('exists');
    const u = { id: this.d.nextId++, name, nameKey, passHash, disabled: false, createdAt: new Date().toISOString() };
    this.d.users.push(u);
    await this._save();
    return { ...u };
  }
  async getUserByKey(nameKey) {
    this._sync(); const u = this.d.users.find(x => x.nameKey === nameKey); return u ? { ...u } : null; }
  async getUserById(id) {
    this._sync(); const u = this.d.users.find(x => x.id === id); return u ? { ...u } : null; }
  async listUsers() {
    this._sync(); return this.d.users.map(u => ({ ...u })); }
  async setDisabled(nameKey, disabled) {
    this._sync();
    const u = this.d.users.find(x => x.nameKey === nameKey); if (!u) return false;
    u.disabled = !!disabled;
    if (disabled) await this.deleteUserSessions(u.id); else await this._save();
    return true;
  }
  async setPassword(nameKey, passHash) {
    this._sync();
    const u = this.d.users.find(x => x.nameKey === nameKey); if (!u) return false;
    u.passHash = passHash; await this.deleteUserSessions(u.id); return true;
  }
  async deleteUser(nameKey) {
    this._sync();
    const u = this.d.users.find(x => x.nameKey === nameKey); if (!u) return false;
    this.d.users = this.d.users.filter(x => x !== u);
    for (const [h, s] of Object.entries(this.d.sessions)) if (s.userId === u.id) delete this.d.sessions[h];
    await this._save(); return true;
  }
  async createSession({ hash, userId, expires }) {
    this._sync(); this.d.sessions[hash] = { userId, expires: +expires }; await this._save(); }
  async getSession(hash) {
    this._sync(); const s = this.d.sessions[hash]; return s ? { userId: s.userId, expires: s.expires } : null; }
  async deleteSession(hash) {
    this._sync(); delete this.d.sessions[hash]; await this._save(); }
  async deleteUserSessions(userId) {
    this._sync();
    for (const [h, s] of Object.entries(this.d.sessions)) if (s.userId === userId) delete this.d.sessions[h];
    await this._save();
  }
  async purgeExpired() {
    this._sync();
    const now = Date.now(); let n = 0;
    for (const [h, s] of Object.entries(this.d.sessions)) if (s.expires < now) { delete this.d.sessions[h]; n++; }
    if (n) await this._save();
  }
  async close() { await this.queue; }
}

class PgStore {
  constructor(pool) { this.pool = pool; }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires TIMESTAMPTZ NOT NULL
    )`);
  }
  static _u(r) { return r ? { id: r.id, name: r.name, nameKey: r.name_key, passHash: r.pass_hash, disabled: r.disabled, createdAt: r.created_at } : null; }
  async createUser({ name, nameKey, passHash }) {
    try {
      const r = await this.pool.query('INSERT INTO users (name, name_key, pass_hash) VALUES ($1, $2, $3) RETURNING *', [name, nameKey, passHash]);
      return PgStore._u(r.rows[0]);
    } catch (e) { if (e && e.code === '23505') throw new Error('exists'); throw e; }
  }
  async getUserByKey(nameKey) { return PgStore._u((await this.pool.query('SELECT * FROM users WHERE name_key = $1', [nameKey])).rows[0]); }
  async getUserById(id) { return PgStore._u((await this.pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0]); }
  async listUsers() { return (await this.pool.query('SELECT * FROM users ORDER BY id')).rows.map(PgStore._u); }
  async setDisabled(nameKey, disabled) {
    const r = await this.pool.query('UPDATE users SET disabled = $2 WHERE name_key = $1 RETURNING id', [nameKey, !!disabled]);
    if (!r.rows.length) return false;
    if (disabled) await this.deleteUserSessions(r.rows[0].id);
    return true;
  }
  async setPassword(nameKey, passHash) {
    const r = await this.pool.query('UPDATE users SET pass_hash = $2 WHERE name_key = $1 RETURNING id', [nameKey, passHash]);
    if (!r.rows.length) return false;
    await this.deleteUserSessions(r.rows[0].id); return true;
  }
  async deleteUser(nameKey) { return (await this.pool.query('DELETE FROM users WHERE name_key = $1 RETURNING id', [nameKey])).rows.length > 0; }
  async createSession({ hash, userId, expires }) {
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, expires) VALUES ($1, $2, $3)', [hash, userId, new Date(expires)]);
  }
  async getSession(hash) {
    const r = (await this.pool.query('SELECT user_id, expires FROM sessions WHERE token_hash = $1', [hash])).rows[0];
    return r ? { userId: r.user_id, expires: new Date(r.expires).getTime() } : null;
  }
  async deleteSession(hash) { await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash]); }
  async deleteUserSessions(userId) { await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]); }
  async purgeExpired() { await this.pool.query('DELETE FROM sessions WHERE expires < NOW()'); }
  async close() { await this.pool.end(); }
}

/** Wählt den Speicher anhand der Umgebung. */
async function createStore(env = process.env) {
  let store;
  if (env.DATABASE_URL) {
    const { Pool } = require('pg');
    store = new PgStore(new Pool({ connectionString: env.DATABASE_URL, max: 5 }));
  } else {
    store = new FileStore(env.DATA_DIR || path.join(__dirname, '..', 'data'));
  }
  await store.init();
  return store;
}

module.exports = { FileStore, PgStore, createStore };
