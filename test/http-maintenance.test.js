import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../server/index.js';

test('deployment gate rejects new sockets while preserving existing sockets and health checks', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stronghold-gate-'));
  const previous = process.env.SP_MAINTENANCE_FILE;
  process.env.SP_MAINTENANCE_FILE = path.join(dir, 'maintenance');
  const srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true });
  const first = new WebSocket(srv.url.replace('http:', 'ws:') + '/ws');
  try {
    await once(first, 'open');
    writeFileSync(process.env.SP_MAINTENANCE_FILE, 'deploy\n');
    const rejected = new WebSocket(srv.url.replace('http:', 'ws:') + '/ws');
    rejected.on('error', () => {});
    const response = await new Promise((resolve) => rejected.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode); res.resume(); rejected.terminate();
    }));
    assert.equal(response, 503);
    assert.equal(first.readyState, WebSocket.OPEN);
    assert.equal((await fetch(srv.url + '/healthz')).status, 200);
    rmSync(process.env.SP_MAINTENANCE_FILE);
    const second = new WebSocket(srv.url.replace('http:', 'ws:') + '/ws');
    await once(second, 'open');
    second.close();
  } finally {
    first.close();
    await srv.close();
    if (previous === undefined) delete process.env.SP_MAINTENANCE_FILE;
    else process.env.SP_MAINTENANCE_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
