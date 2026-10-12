import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../server/auth/service.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

test('HTTP login, Origin checks, WebSocket account binding, logout and revocation', async (t) => {
  const outbox = [];
  const auth = new AuthService({ origin: 'http://127.0.0.1', secure: false, environment: 'production', cookieName: 'sp_test',
    secret: 'a'.repeat(43), healthToken: 'b'.repeat(43), database: ':memory:', codeMs: 600000, sessionMs: 100000, dailyLimit: 75 },
  { mailer: { configured: true, async send(m) { outbox.push(m); } } });
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true, auth });
  auth.config.origin = srv.url;
  t.after(() => srv.close());
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.close())); });
  const post = (route, data, cookie = '', origin = srv.url) => fetch(srv.url + '/auth/api/' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify(data),
  });
  assert.equal((await fetch(srv.url + '/', { redirect: 'manual' })).status, 303);
  assert.equal((await fetch(srv.url + '/data/chess.json')).status, 401);
  assert.equal((await fetch(srv.url + '/auth/login')).status, 200);
  const icon = await fetch(srv.url + '/icons/community-logo-32.png');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await icon.arrayBuffer()).readUInt32BE(0), 0x89504e47);
  assert.equal((await fetch(srv.url + '/manifest.json')).status, 200);
  assert.equal((await post('request-code', {}, '', 'https://evil.invalid')).status, 403);
  await assert.rejects(TestClient.connect(srv.url.replace('http:', 'ws:') + '/ws', { wsOptions: { origin: srv.url } }), /401/);
  async function login(email) {
    const invite = auth.createInvite({ email });
    const pending = await (await post('request-code', { email, invite: invite.code })).json();
    const response = await post('verify', { challenge: pending.challenge, code: outbox.at(-1).code });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const a = await login('a@example.com'); const b = await login('b@example.com');
  assert.equal((await fetch(srv.url + '/data/chess.json', { headers: { Cookie: a } })).status, 200);
  async function connect(cookie) {
    const c = await TestClient.connect(srv.url.replace('http:', 'ws:') + '/ws', { wsOptions: { headers: { Cookie: cookie, Origin: srv.url } } });
    clients.push(c); return c;
  }
  const ca = await connect(a); const wa = await ca.hello('PlayerA');
  const cb = await connect(b); const wb = await cb.hello('PlayerB', wa.token);
  assert.notEqual(wb.playerId, wa.playerId); assert.equal(wb.resumed, false);
  await ca.close();
  const again = await connect(a); const resumed = await again.hello('PlayerA', wa.token);
  assert.equal(resumed.playerId, wa.playerId); assert.equal(resumed.resumed, true);
  assert.equal((await post('logout', {}, a)).status, 200);
  assert.equal((await again.closed).code, 4401);
  assert.equal((await fetch(srv.url + '/data/chess.json', { headers: { Cookie: a } })).status, 401);
  auth.disableUser('b@example.com');
  assert.equal((await cb.closed).code, 4401);
});
