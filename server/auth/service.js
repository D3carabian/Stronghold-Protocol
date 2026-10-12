import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AuthStore } from './store.js';
import { resendMailer } from './mail.js';

const token = () => randomBytes(32).toString('base64url');
export class AuthError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new AuthError('INVALID_INPUT');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)) {
    throw new AuthError('INVALID_INPUT');
  }
  return email;
}
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};

export class AuthService {
  constructor(config, { store, mailer, now = Date.now } = {}) {
    this.config = config;
    this.store = store || new AuthStore(config.database);
    this.mailer = mailer || resendMailer(config);
    this.now = now;
    this.sockets = new Map();
    this.pendingSends = 0;
    this.timer = setInterval(() => {
      for (const [ws, digest] of this.sockets) if (!this.sessionByDigest(digest)) ws.close(4401, 'authentication required');
      this.store.cleanup(this.now());
    }, 15000);
    this.timer.unref();
  }
  hash(kind, value) { return createHmac('sha256', this.config.secret).update(kind + '\0' + value).digest('hex'); }
  allowed(user) { return !!user && !user.disabled && (this.config.environment !== 'staging' || ['tester', 'admin'].includes(user.role)); }
  invite(raw, email) {
    if (typeof raw !== 'string' || raw.length > 200) return null;
    return this.store.get('SELECT * FROM invites WHERE digest=? AND revoked=0 AND remaining>0 AND expires_at>? AND (email IS NULL OR email=?)',
      this.hash('invite', raw.trim()), this.now(), email);
  }
  createInvite({ email = null, role = 'player', uses = 1, days = 7 } = {}) {
    if (!['player', 'tester'].includes(role) || !Number.isInteger(uses) || uses < 1 || uses > 100
      || !Number.isInteger(days) || days < 1 || days > 90) throw new AuthError('INVALID_INPUT');
    const code = token(); const id = token();
    this.store.run('INSERT INTO invites(id,digest,email,role,remaining,expires_at) VALUES(?,?,?,?,?,?)',
      id, this.hash('invite', code), email ? normalizeEmail(email) : null, role, uses, this.now() + days * 86400000);
    this.store.audit('invite.created', id, this.now());
    return { id, code };
  }
  revokeInvite(id) {
    this.store.run('UPDATE invites SET revoked=1 WHERE id=?', id);
    this.store.audit('invite.revoked', id, this.now());
  }
  grantAdmin(email) {
    email = normalizeEmail(email);
    this.store.run('INSERT INTO users(id,email,role,created_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role,disabled=0',
      token(), email, 'admin', this.now());
    this.store.audit('admin.granted', this.store.get('SELECT id FROM users WHERE email=?', email).id, this.now());
  }
  disableUser(email) {
    email = normalizeEmail(email);
    this.store.transaction(() => {
      const user = this.store.get('SELECT id FROM users WHERE email=?', email);
      if (!user) return;
      this.store.run('UPDATE users SET disabled=1 WHERE id=?', user.id);
      this.store.run('DELETE FROM sessions WHERE user_id=?', user.id);
      this.store.audit('user.disabled', user.id, this.now());
    });
    this.closeRevokedSockets();
  }
  consumeLimit(kind, subject, maximum, duration) {
    const ok = this.store.transaction(() => this.store.limit(this.hash('limit/' + kind, subject), maximum, duration, this.now()));
    if (!ok) throw new AuthError('RATE_LIMITED', 429);
  }
  async requestCode(rawEmail, inviteCode, ip) {
    const email = normalizeEmail(rawEmail);
    this.consumeLimit('request-ip', ip, 12, 3600000);
    this.consumeLimit('request-email-hour', email, 5, 3600000);
    this.consumeLimit('request-email-cooldown', email, 1, 60000);
    if (!this.mailer.configured) throw new AuthError('MAIL_UNAVAILABLE', 503);
    const id = token();
    const user = this.store.get('SELECT * FROM users WHERE email=?', email);
    const invitation = user ? null : this.invite(inviteCode, email);
    const allowed = user ? this.allowed(user) : invitation && this.allowed({ role: invitation.role, disabled: 0 });
    // Identical response shape for unknown/unapproved mailboxes. No invitation, no verification mail.
    if (!allowed) return { challenge: id, retryAfter: 60 };
    const day = Math.floor(this.now() / 86400000);
    this.consumeLimit('global-mail', String(day), this.config.dailyLimit, (day + 1) * 86400000 - this.now());
    const code = String(randomInt(1000000)).padStart(6, '0');
    const digest = this.hash('code', `${id}\0${email}\0${code}`);
    this.store.run('INSERT INTO challenges(id,email,digest,invite_id,expires_at,state,created_at) VALUES(?,?,?,?,?,?,?)',
      id, email, digest, invitation?.id || null, this.now() + this.config.codeMs, 'pending', this.now());
    this.pendingSends++;
    try {
      await this.mailer.send({ email, code, id });
      this.store.transaction(() => {
        this.store.run("UPDATE challenges SET state='superseded' WHERE email=? AND state='sent'", email);
        this.store.run("UPDATE challenges SET state='sent' WHERE id=? AND state='pending'", id);
      });
    } catch {
      this.store.run("UPDATE challenges SET state='failed' WHERE id=?", id);
      throw new AuthError('MAIL_UNAVAILABLE', 503);
    } finally { this.pendingSends--; }
    return { challenge: id, retryAfter: 60 };
  }
  verify(id, code, ip) {
    this.consumeLimit('verify-ip', ip, 40, 600000);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw new AuthError('INVALID_CODE', 401);
    }
    // Return failure from the transaction rather than throwing: failed guesses must be committed.
    const result = this.store.transaction(() => {
      const challenge = this.store.get('SELECT * FROM challenges WHERE id=?', id);
      if (!challenge || challenge.state !== 'sent' || challenge.expires_at <= this.now() || challenge.attempts >= 5) return null;
      this.store.run('UPDATE challenges SET attempts=attempts+1 WHERE id=?', id);
      if (!equal(challenge.digest, this.hash('code', `${id}\0${challenge.email}\0${code}`))) return null;
      let user = this.store.get('SELECT * FROM users WHERE email=?', challenge.email);
      if (user && !this.allowed(user)) return null;
      if (!user) {
        const invite = this.store.get('SELECT * FROM invites WHERE id=? AND revoked=0 AND remaining>0 AND expires_at>? AND (email IS NULL OR email=?)',
          challenge.invite_id, this.now(), challenge.email);
        if (!invite || !this.allowed({ role: invite.role, disabled: 0 })) return null;
        const redeemed = this.store.run('UPDATE invites SET remaining=remaining-1 WHERE id=? AND remaining>0', invite.id);
        if (redeemed.changes !== 1) return null;
        user = { id: token(), email: challenge.email, role: invite.role, disabled: 0 };
        this.store.run('INSERT INTO users(id,email,role,created_at) VALUES(?,?,?,?)', user.id, user.email, user.role, this.now());
        this.store.audit('invite.redeemed', invite.id, this.now());
      }
      const session = token();
      this.store.run("UPDATE challenges SET state='consumed' WHERE id=?", id);
      this.store.run('INSERT INTO sessions(digest,user_id,expires_at,created_at) VALUES(?,?,?,?)',
        this.hash('session', session), user.id, this.now() + this.config.sessionMs, this.now());
      // Bound the number of long-lived sessions without storing raw tokens.
      this.store.run('DELETE FROM sessions WHERE user_id=? AND digest NOT IN (SELECT digest FROM sessions WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10)', user.id, user.id);
      this.store.audit('login', user.id, this.now());
      return { token: session, user: { id: user.id, email: user.email, role: user.role } };
    });
    if (!result) throw new AuthError('INVALID_CODE', 401);
    return result;
  }
  sessionByDigest(digest) {
    const user = this.store.get('SELECT users.*,sessions.digest AS sessionDigest FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.digest=? AND sessions.expires_at>?', digest, this.now());
    return this.allowed(user) ? user : null;
  }
  authenticate(req) {
    const cookies = (req.headers.cookie || '').split(';').map((x) => x.trim().split('='));
    const values = cookies.filter(([name]) => name === this.config.cookieName);
    if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0][1] || '')) return null;
    return this.sessionByDigest(this.hash('session', values[0][1]));
  }
  cookie(value, clear = false) {
    return `${this.config.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : Math.floor(this.config.sessionMs / 1000)}${this.config.secure ? '; Secure' : ''}`;
  }
  logout(user) {
    if (user) this.store.run('DELETE FROM sessions WHERE digest=?', user.sessionDigest);
    this.closeRevokedSockets();
  }
  trackSocket(ws, user) {
    this.sockets.set(ws, user.sessionDigest);
    ws.once('close', () => this.sockets.delete(ws));
  }
  closeRevokedSockets() {
    for (const [ws, digest] of this.sockets) if (!this.sessionByDigest(digest)) ws.close(4401, 'authentication required');
  }
  healthAllowed(req) {
    // Never use forwarded address headers to bypass authentication.
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return true;
    return equal(req.headers['x-stronghold-health'], this.config.healthToken);
  }
  close() { clearInterval(this.timer); this.store.close(); }
}
