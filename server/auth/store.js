import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export class AuthStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('Authentication database is newer than this application'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('player','tester','admin')),
        disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, email TEXT, role TEXT NOT NULL CHECK(role IN ('player','tester')),
        remaining INTEGER NOT NULL CHECK(remaining >= 0), expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY, email TEXT NOT NULL, digest TEXT NOT NULL, invite_id TEXT, expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS challenges_email ON challenges(email);
      CREATE TABLE IF NOT EXISTS sessions (
        digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, subject TEXT, created_at INTEGER NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  limit(key, maximum, window, now) {
    this.run('DELETE FROM limits WHERE resets_at <= ?', now);
    const row = this.get('SELECT count FROM limits WHERE key=?', key);
    if (row && row.count >= maximum) return false;
    this.run('INSERT INTO limits(key,count,resets_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now + window);
    return true;
  }
  cleanup(now) {
    this.run('DELETE FROM challenges WHERE expires_at < ?', now - 86400000);
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.run('DELETE FROM audit WHERE created_at < ?', now - 90 * 86400000);
  }
  audit(action, subject, now) { this.run('INSERT INTO audit(action,subject,created_at) VALUES(?,?,?)', action, subject, now); }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
}
