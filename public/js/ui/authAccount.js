import { net } from '../net.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

export function AuthAccountLink() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/auth/api/session', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : null)
      .then((data) => { if (active) setEnabled(!!data?.enabled); }).catch(() => {});
    const off = net.on('authRequired', () => window.location.assign('/auth/login'));
    return () => { active = false; off(); };
  }, []);
  return enabled ? html`<a class="btn btn--ghost btn--sm" href="/auth/login" target="_blank" rel="noopener">${t('账户与登录')}</a>` : null;
}
