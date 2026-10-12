// Explicit live acceptance check. Credentials stay in an external private JSON file.
// Creates a temporary staging lobby and removes it; never starts a production match.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { TestClient } from '../test/helpers/wsClient.js';

const credentials = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const auth = (env) => 'Basic ' + Buffer.from(`${credentials[env].user}:${credentials[env].password}`).toString('base64');
const request = (env, route, headers = {}) => fetch(credentials[env].url + route, {
  headers: { Authorization: auth(env), ...headers }, signal: AbortSignal.timeout(15000),
});
const report = async (env) => {
  const r = await request(env, '/healthz');
  assert.equal(r.status, 200);
  return r.json();
};
const connect = (env) => TestClient.connect(credentials[env].url.replace('https:', 'wss:') + '/ws', {
  timeout: 15000, wsOptions: { headers: { Authorization: auth(env), Origin: credentials[env].url } },
});

async function rejectedSocket(env, headers, expected) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(credentials[env].url.replace('https:', 'wss:') + '/ws', { headers });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS rejection timeout')); }, 15000);
    ws.on('error', () => {});
    ws.once('open', () => { clearTimeout(timer); ws.close(); reject(new Error('Unauthorised socket accepted')); });
    ws.once('unexpected-response', (_req, res) => {
      clearTimeout(timer); res.resume(); ws.terminate();
      if (res.statusCode !== expected) reject(new Error(`Expected WS ${expected}, got ${res.statusCode}`));
      else resolve();
    });
  });
}

for (const env of ['production', 'staging']) {
  for (const route of ['/', '/healthz', '/data/assets.json', '/ws']) {
    const r = await fetch(credentials[env].url + route, { signal: AbortSignal.timeout(15000) });
    assert.equal(r.status, 401, `${env} anonymous ${route}`);
    await r.arrayBuffer();
  }
  await rejectedSocket(env, {}, 401);
  await rejectedSocket(env, { Authorization: auth(env), Origin: 'https://untrusted.invalid' }, 403);
  assert.equal((await report(env)).app, '0.2.4');
  for (const route of ['/', '/vendor/pixi.min.js', '/packs/index.json', '/data/local-assets.json', '/fonts/fonts.css']) {
    const r = await request(env, route);
    assert.equal(r.status, 200, `${env} ${route}`);
    await r.arrayBuffer();
  }
  const assets = await (await request(env, '/data/assets.json')).json();
  function audioPath(value) {
    if (typeof value === 'string' && value.startsWith('/assets/audio/bgm/') && value.endsWith('.mp3')) return value;
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) { const found = audioPath(child); if (found) return found; }
    }
    return null;
  }
  const media = audioPath(assets);
  assert.ok(media, 'Asset manifest contains a BGM track');
  const audio = await request(env, media.replace('/assets/audio/', '/media/').replace(/\.mp3$/, ''), { Range: 'bytes=0-1023' });
  assert.equal(audio.status, 206, 'Safari audio range requests');
  assert.match(audio.headers.get('content-type') || '', /audio/);
  assert.equal((await audio.arrayBuffer()).byteLength, 1024);
  const c = await connect(env);
  try { await c.hello('DeployCheck'); } finally { await c.close(); }
  console.log(`${env}: authentication, cross-origin rejection, HTTPS, resources, audio ranges and WebSocket passed`);
}

assert.equal((await request('production', '/healthz', { Authorization: auth('staging') })).status, 401);
const before = await report('production');
const host = await connect('staging');
const guest = await connect('staging');
const production = await connect('production');
try {
  await host.hello('StageHost'); await guest.hello('StageGuest'); await production.hello('IsoCheck');
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
  const room = await host.waitFor('room.state');
  assert.equal((await guest.request({ t: 'room.join', code: room.code })).t, 'ok');
  assert.equal((await production.request({ t: 'room.join', code: room.code })).t, 'error');
  assert.equal((await report('production')).rooms, before.rooms);
  assert.equal((await guest.request({ t: 'room.leave' })).t, 'ok');
  assert.equal((await host.request({ t: 'room.leave' })).t, 'ok');
  console.log('Staging two-player lobby works; room and credentials are isolated from production');
} finally {
  await Promise.all([host.close(), guest.close(), production.close()]);
}
