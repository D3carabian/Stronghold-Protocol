#!/usr/bin/env node
// Run through `docker compose exec game node tools/auth-admin.mjs ...` on the trusted host.
import { parseArgs } from 'node:util';
import { authConfig } from '../server/auth/config.js';
import { AuthService } from '../server/auth/service.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  email: { type: 'string' }, role: { type: 'string' }, uses: { type: 'string' }, days: { type: 'string' },
} });
const [command, id] = positionals;
const config = authConfig();
if (!config) throw new Error('Authentication is not enabled');
const auth = new AuthService(config);
try {
  let result;
  switch (command) {
    case 'invite': result = auth.createInvite({ email: values.email || null,
      role: values.role || (config.environment === 'staging' ? 'tester' : 'player'),
      uses: Number(values.uses || 1), days: Number(values.days || 7) }); break;
    case 'revoke-invite': if (!id) throw new Error('An invitation ID is required'); auth.revokeInvite(id); result = { ok: true }; break;
    case 'grant-admin': if (!values.email) throw new Error('--email is required'); auth.grantAdmin(values.email); result = { ok: true }; break;
    case 'disable-user': if (!values.email) throw new Error('--email is required'); auth.disableUser(values.email); result = { ok: true }; break;
    case 'users': result = auth.store.all('SELECT id,email,role,disabled,created_at FROM users ORDER BY created_at'); break;
    case 'invites': result = auth.store.all('SELECT id,email,role,remaining,expires_at,revoked FROM invites ORDER BY expires_at'); break;
    default: throw new Error('Commands: invite [--email EMAIL] [--role player|tester] [--uses N] [--days N], revoke-invite ID, grant-admin --email EMAIL, disable-user --email EMAIL, users, invites');
  }
  console.log(JSON.stringify(result, null, 2));
} finally { auth.close(); }
