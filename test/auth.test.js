import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuthService } from '../server/auth/service.js';
import { authConfig } from '../server/auth/config.js';
import { resendMailer } from '../server/auth/mail.js';

export function fixture(t, overrides = {}) {
  let now = 1800000000000; const outbox = [];
  const config = { origin: 'https://test.example.com', secure: true, environment: 'production', cookieName: '__Host-test',
    secret: 'a'.repeat(43), healthToken: 'b'.repeat(43), database: ':memory:', sessionMs: 100000, codeMs: 600000, dailyLimit: 75, ...overrides };
  const mailer = { configured: true, async send(message) { outbox.push(message); } };
  const auth = new AuthService(config, { mailer, now: () => now });
  t.after(() => auth.close());
  return { auth, outbox, config, mailer, advance: (ms) => { now += ms; } };
}
function req(auth, session) { return { headers: { cookie: `${auth.config.cookieName}=${session}` } }; }

test('new accounts require a valid invitation; existing users log in without consuming one', async (t) => {
  const { auth, outbox, advance } = fixture(t);
  const dummy = await auth.requestCode('new@example.com', '', 'ip-a');
  assert.equal(outbox.length, 0); assert.equal(dummy.challenge.length, 43);
  advance(61000);
  const invitation = auth.createInvite();
  const request = await auth.requestCode('New@Example.com', invitation.code, 'ip-a');
  const login = auth.verify(request.challenge, outbox[0].code, 'ip-a');
  assert.equal(login.user.email, 'new@example.com');
  assert.equal(auth.authenticate(req(auth, login.token)).id, login.user.id);
  assert.equal(auth.store.get('SELECT remaining FROM invites WHERE id=?', invitation.id).remaining, 0);
  assert.throws(() => auth.verify(request.challenge, outbox[0].code, 'ip-a'), /INVALID_CODE/);
  advance(61000);
  const repeat = await auth.requestCode('new@example.com', '', 'ip-a');
  assert.equal(auth.verify(repeat.challenge, outbox[1].code, 'ip-a').user.id, login.user.id);
});

test('five failed guesses persist, expired codes fail and no secrets are stored in plaintext', async (t) => {
  const { auth, outbox, advance } = fixture(t);
  const invitation = auth.createInvite();
  const request = await auth.requestCode('one@example.com', invitation.code, 'ip');
  const wrong = outbox[0].code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.throws(() => auth.verify(request.challenge, wrong, 'ip'), /INVALID_CODE/);
  assert.throws(() => auth.verify(request.challenge, outbox[0].code, 'ip'), /INVALID_CODE/);
  assert.equal(auth.store.get('SELECT attempts FROM challenges WHERE id=?', request.challenge).attempts, 5);
  const stored = auth.store.get('SELECT digest FROM challenges WHERE id=?', request.challenge).digest;
  assert.equal(stored.length, 64); assert.notEqual(stored, outbox[0].code);
  assert.notEqual(auth.store.get('SELECT digest FROM invites WHERE id=?', invitation.id).digest, invitation.code);
  advance(61000);
  const next = await auth.requestCode('two@example.com', invitation.code, 'ip');
  advance(600001);
  assert.throws(() => auth.verify(next.challenge, outbox[1].code, 'ip'), /INVALID_CODE/);
});

test('one-use invitation cannot be over-redeemed; email-bound and revoked invitations are enforced at verification', async (t) => {
  const { auth, outbox } = fixture(t);
  const one = auth.createInvite();
  const a = await auth.requestCode('a@example.com', one.code, 'a');
  const b = await auth.requestCode('b@example.com', one.code, 'b');
  auth.verify(a.challenge, outbox[0].code, 'a');
  assert.throws(() => auth.verify(b.challenge, outbox[1].code, 'b'), /INVALID_CODE/);
  assert.equal(auth.store.all('SELECT * FROM users').length, 1);
  const bound = auth.createInvite({ email: 'owner@example.com' });
  await auth.requestCode('other@example.com', bound.code, 'c');
  assert.equal(outbox.length, 2);
  const c = await auth.requestCode('owner@example.com', bound.code, 'd');
  auth.revokeInvite(bound.id);
  assert.throws(() => auth.verify(c.challenge, outbox[2].code, 'd'), /INVALID_CODE/);
});

test('mail failure is closed, limits persist, resend supersedes old codes and staging needs tester role', async (t) => {
  const { auth, outbox, mailer, advance } = fixture(t);
  const invite = auth.createInvite({ uses: 3 });
  const first = await auth.requestCode('p@example.com', invite.code, 'a');
  await assert.rejects(auth.requestCode('p@example.com', invite.code, 'a'), /RATE_LIMITED/);
  advance(61000);
  const next = await auth.requestCode('p@example.com', invite.code, 'a');
  assert.throws(() => auth.verify(first.challenge, outbox[0].code, 'a'), /INVALID_CODE/);
  auth.verify(next.challenge, outbox[1].code, 'a');
  mailer.send = async () => { throw new Error('provider detail must not escape'); };
  await assert.rejects(auth.requestCode('failed@example.com', invite.code, 'a'), { message: 'MAIL_UNAVAILABLE' });
  assert.equal(auth.store.get('SELECT state FROM challenges WHERE email=?', 'failed@example.com').state, 'failed');
  const stage = fixture(t, { environment: 'staging' });
  await stage.auth.requestCode('p@example.com', stage.auth.createInvite().code, 'ip');
  assert.equal(stage.outbox.length, 0);
  const q = await stage.auth.requestCode('t@example.com', stage.auth.createInvite({ role: 'tester' }).code, 'ip');
  assert.equal(stage.auth.verify(q.challenge, stage.outbox[0].code, 'ip').user.role, 'tester');
});

test('sessions survive restart, expire and can be revoked without changing invitations', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-auth-'));
  const { auth, config, outbox, advance } = fixture(t, { database: path.join(dir, 'auth.db') });
  const c = await auth.requestCode('a@example.com', auth.createInvite().code, 'ip');
  const result = auth.verify(c.challenge, outbox[0].code, 'ip');
  const other = new AuthService(config, { mailer: { configured: false }, now: auth.now });
  t.after(() => { other.close(); auth.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.ok(other.authenticate(req(other, result.token)));
  other.logout(other.authenticate(req(other, result.token)));
  assert.equal(auth.authenticate(req(auth, result.token)), null);
  advance(61000);
  const c2 = await auth.requestCode('a@example.com', '', 'ip');
  const second = auth.verify(c2.challenge, outbox[1].code, 'ip');
  advance(config.sessionMs + 1);
  assert.equal(other.authenticate(req(other, second.token)), null);
  const c3 = await auth.requestCode('a@example.com', '', 'ip');
  const third = auth.verify(c3.challenge, outbox[2].code, 'ip');
  auth.disableUser('a@example.com');
  assert.equal(other.authenticate(req(other, third.token)), null);
  assert.equal(other.authenticate(req(other, second.token)), null);
});

test('configuration fails closed and cookies are host-only and HttpOnly', (t) => {
  assert.equal(authConfig({}), null);
  assert.throws(() => authConfig({ AUTH_ENABLED: 'true' }), /must be 0 or 1/);
  assert.throws(() => authConfig({ AUTH_ENABLED: '1', AUTH_PUBLIC_URL: 'http://example.com' }), /HTTPS/);
  const { auth } = fixture(t);
  assert.match(auth.cookie('opaque'), /HttpOnly; SameSite=Lax/);
  assert.match(auth.cookie('opaque'), /; Secure$/);
  assert.doesNotMatch(auth.cookie('opaque'), /Domain=/);
  assert.equal(auth.healthAllowed({ socket: { remoteAddress: '203.0.113.1' }, headers: { 'x-forwarded-for': '127.0.0.1' } }), false);
});

test('Resend adapter uses idempotency, plain text and no secret-bearing errors', async () => {
  const seen = [];
  const mailer = resendMailer({ apiKey: 'fake-key', from: 'test@example.com', origin: 'https://test.example.com', environment: 'staging' }, async (url, opts) => {
    seen.push({ url, opts }); return { ok: true, json: async () => ({ id: 'id' }) };
  });
  await mailer.send({ email: 'player@example.com', code: '123456', id: 'challenge' });
  assert.equal(seen[0].opts.headers['Idempotency-Key'], 'login/staging/challenge');
  assert.equal(JSON.parse(seen[0].opts.body).to[0], 'player@example.com');
  assert.equal(JSON.parse(seen[0].opts.body).html, undefined);
});

test('missing provider fails closed and the persistent global daily budget bounds sends', async (t) => {
  const { auth, outbox, mailer } = fixture(t, { dailyLimit: 1 });
  const invite = auth.createInvite({ uses: 3 });
  mailer.configured = false;
  await assert.rejects(auth.requestCode('one@example.com', invite.code, 'a'), /MAIL_UNAVAILABLE/);
  mailer.configured = true;
  await auth.requestCode('two@example.com', invite.code, 'b');
  await assert.rejects(auth.requestCode('three@example.com', invite.code, 'c'), /RATE_LIMITED/);
  assert.equal(outbox.length, 1);
});
