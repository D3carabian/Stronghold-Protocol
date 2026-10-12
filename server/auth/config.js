import path from 'node:path';

export function authConfig(env = process.env) {
  if (env.AUTH_ENABLED == null || env.AUTH_ENABLED === '' || env.AUTH_ENABLED === '0') return null;
  if (env.AUTH_ENABLED !== '1') throw new Error('AUTH_ENABLED must be 0 or 1');
  const origin = new URL(env.AUTH_PUBLIC_URL || '');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local && env.NODE_ENV !== 'production' && env.HOST === '127.0.0.1'))) {
    throw new Error('AUTH_PUBLIC_URL must be an HTTPS origin (loopback-only development is permitted)');
  }
  if (!path.isAbsolute(env.AUTH_DATABASE_PATH || '')) throw new Error('AUTH_DATABASE_PATH must be absolute');
  if ((env.AUTH_SECRET || '').length < 43 || (env.AUTH_HEALTH_TOKEN || '').length < 43) {
    throw new Error('AUTH_SECRET and AUTH_HEALTH_TOKEN require at least 32 random bytes encoded as base64url');
  }
  if (env.RESEND_API_KEY && !/^re_[A-Za-z0-9_-]+$/.test(env.RESEND_API_KEY)) throw new Error('RESEND_API_KEY must be a Resend API key, not a DNS record');
  const environment = env.AUTH_ENVIRONMENT || 'production';
  if (!['production', 'staging', 'development'].includes(environment)) throw new Error('Invalid AUTH_ENVIRONMENT');
  return {
    origin: origin.origin, secure: origin.protocol === 'https:', environment,
    cookieName: (origin.protocol === 'https:' ? '__Host-' : '') + 'sp_auth_' + environment,
    database: env.AUTH_DATABASE_PATH, secret: env.AUTH_SECRET, healthToken: env.AUTH_HEALTH_TOKEN,
    apiKey: env.RESEND_API_KEY || '', from: env.AUTH_MAIL_FROM || '',
    sessionMs: 14 * 24 * 60 * 60 * 1000, codeMs: 10 * 60 * 1000,
    dailyLimit: environment === 'staging' ? 15 : 75,
  };
}
