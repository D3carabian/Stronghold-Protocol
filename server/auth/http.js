import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from '../http/common.js';
import { clientAddress } from '../net.js';
import { AuthError } from './service.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = new Map([
  // Public site branding is also needed by the login screen and OS home-screen installers.
  ...[32, 180, 192, 512, 'maskable-192', 'maskable-512'].map((size) => [`/icons/community-logo-${size}.png`, [`public/icons/community-logo-${size}.png`, 'image/png']]),
  ['/manifest.json', ['public/manifest.json', 'application/manifest+json']],
  ['/auth/login', ['public/auth/index.html', 'text/html']],
  ['/auth/login.js', ['public/auth/login.js', 'text/javascript']],
  ['/auth/login.css', ['public/auth/login.css', 'text/css']],
  ['/auth/shared/i18n.js', ['shared/i18n.js', 'text/javascript']],
  ['/auth/shared/i18nPacks.js', ['shared/i18nPacks.js', 'text/javascript']],
  ...['en', 'ja', 'ko', 'zh-TW'].map((lang) => [`/auth/lang/${lang}.json`, [`public/i18n/${lang}.json`, 'application/json']]),
]);

async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AuthError('INVALID_INPUT', 415);
  if (Number(req.headers['content-length']) > 8192) throw new AuthError('INVALID_INPUT', 413);
  req.setTimeout(10000, () => req.destroy());
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new AuthError('INVALID_INPUT', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AuthError('INVALID_INPUT'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError('INVALID_INPUT');
  return value;
}

export function authHttp(auth, { trustProxy = false, log = console } = {}) {
  return async (req, res, route) => {
    if (!route.startsWith('/auth/') && !PUBLIC.has(route)) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (['GET', 'HEAD'].includes(req.method) && PUBLIC.has(route)) {
        const [file, type] = PUBLIC.get(route);
        const bytes = await readFile(path.join(ROOT, file));
        res.writeHead(200, { 'Content-Type': type.startsWith('image/') ? type : type + '; charset=utf-8', 'Content-Length': bytes.length });
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return true;
      }
      if (req.method === 'GET' && route === '/auth/api/session') {
        const user = auth.authenticate(req);
        sendJson(req, res, 200, { enabled: true, environment: auth.config.environment, mailAvailable: auth.mailer.configured,
          user: user ? { email: user.email, role: user.role } : null });
        return true;
      }
      if (req.method !== 'POST') { sendJson(req, res, 405, { error: 'METHOD_NOT_ALLOWED' }); return true; }
      if (process.env.SP_MAINTENANCE_FILE && existsSync(process.env.SP_MAINTENANCE_FILE)) throw new AuthError('UNAVAILABLE', 503);
      if (req.headers.origin !== auth.config.origin) throw new AuthError('FORBIDDEN', 403);
      const data = await body(req);
      if (process.env.SP_MAINTENANCE_FILE && existsSync(process.env.SP_MAINTENANCE_FILE)) throw new AuthError('UNAVAILABLE', 503);
      const ip = clientAddress(req, trustProxy).ip;
      if (route === '/auth/api/request-code') {
        sendJson(req, res, 200, await auth.requestCode(data.email, data.invite, ip));
      } else if (route === '/auth/api/verify') {
        const result = auth.verify(data.challenge, data.code, ip);
        auth.logout(auth.authenticate(req));
        res.setHeader('Set-Cookie', auth.cookie(result.token));
        sendJson(req, res, 200, { ok: true });
      } else if (route === '/auth/api/logout') {
        auth.logout(auth.authenticate(req));
        res.setHeader('Set-Cookie', auth.cookie('', true));
        sendJson(req, res, 200, { ok: true });
      } else sendJson(req, res, 404, { error: 'NOT_FOUND' });
    } catch (err) {
      if (!(err instanceof AuthError)) log.error('[auth] request failed');
      if (!res.headersSent) sendJson(req, res, err instanceof AuthError ? err.status : 500,
        { error: err instanceof AuthError ? err.code : 'UNAVAILABLE' });
      else res.destroy();
    }
    return true;
  };
}
