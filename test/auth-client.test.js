import test from 'node:test';
import assert from 'node:assert/strict';
import { installAuthGuard } from '../public/js/ui/authGuard.js';

test('expired login redirects from any screen; network failures and upstream mode do not', async () => {
  const listeners = new Map(); let redirects = 0; let calls = 0; let time = 1;
  let response = { enabled: false, user: null };
  const net = { on(type, fn) { listeners.set(type, fn); return () => listeners.delete(type); } };
  const off = installAuthGuard(net, { now: () => time, redirect: () => redirects++,
    fetcher: async () => { calls++; return { ok: true, json: async () => response }; } });
  const flush = () => new Promise((r) => setImmediate(r));
  listeners.get('status')({ status: 'reconnecting' }); await flush();
  assert.equal(redirects, 0);
  response = { enabled: true, user: null };
  listeners.get('status')({ status: 'reconnecting' }); await flush();
  assert.equal(calls, 1);
  time += 30001;
  listeners.get('status')({ status: 'reconnecting' }); await flush();
  assert.equal(redirects, 1);
  listeners.get('authRequired')(); assert.equal(redirects, 2);
  off(); assert.equal(listeners.size, 0);
});
