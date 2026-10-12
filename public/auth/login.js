import { t, setLang, setMessages } from '/auth/shared/i18n.js';

const $ = (id) => document.getElementById(id);
let session = null; let challenge = null; let busy = false; let retryAt = 0;
const messages = {
  INVALID_INPUT: () => t('请检查填写的信息。'),
  INVALID_CODE: () => t('验证码无效或已过期，请重新获取。'),
  RATE_LIMITED: () => t('请求过于频繁，请稍后再试。'),
  MAIL_UNAVAILABLE: () => t('验证邮件暂不可用，请稍后重试。'),
  FORBIDDEN: () => t('请求无法验证，请刷新页面后重试。'),
};
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function render() {
  $('heading').textContent = session?.user ? t('你的账户') : t('欢迎来到卫戍协议');
  $('intro').textContent = t('使用邮箱验证码登录。首次加入需要邀请码。');
  $('environment').textContent = session?.environment === 'staging' ? t('测试服 · 独立账户') : t('社区游玩入口');
  $('email-label').textContent = t('邮箱地址'); $('invite-label').textContent = t('邀请码（首次加入时填写）');
  $('invite-help').textContent = t('已加入的玩家无需再次填写邀请码。请向管理员索取邀请。');
  $('code-label').textContent = t('6 位验证码'); $('verify').textContent = t('验证并进入');
  $('back').textContent = t('更换邮箱或重新发送'); $('logout').textContent = t('退出登录');
  $('enter').textContent = t('进入游戏'); $('logout-help').textContent = t('退出登录会断开此登录会话中的游戏连接。');
  $('footer').textContent = t('非官方同人社区 · 仅供非商业娱乐。验证码仅用于登录，请勿转发。');
  $('account').hidden = !session?.user;
  $('email-form').hidden = !!session?.user || !!challenge;
  $('code-form').hidden = !!session?.user || !challenge;
  if (session?.user) $('account-email').textContent = session.user.email;
  const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  $('send').textContent = seconds ? t('{n} 秒后可重新发送', { n: seconds }) : t('发送验证码');
  $('send').disabled = busy || seconds > 0 || !session?.mailAvailable;
  $('verify').disabled = busy; $('back').disabled = busy; $('logout').disabled = busy;
}
async function api(route, data) {
  const res = await fetch('/auth/api/' + route, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const value = await res.json();
  if (!res.ok) throw new Error(value.error || 'UNAVAILABLE');
  return value;
}
async function language(value) {
  if (value !== 'zh') {
    const res = await fetch(`/auth/lang/${encodeURIComponent(value)}.json`);
    if (!res.ok) return;
    setMessages(value, await res.json());
  }
  setLang(value); document.documentElement.lang = value === 'zh' ? 'zh-CN' : value;
  try { localStorage.setItem('sp.pref.lang', value); } catch { /* storage can be blocked */ }
  render();
}
function showError(error) { status((messages[error.message] || (() => t('暂时无法连接，请稍后重试。')))(), true); }
$('language').addEventListener('change', () => language($('language').value).catch(showError));
$('email-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  busy = true; render(); status(t('正在发送验证码…'));
  try {
    const result = await api('request-code', { email: $('email').value, invite: $('invite').value });
    challenge = result.challenge; retryAt = Date.now() + result.retryAfter * 1000;
    $('invite').value = ''; render(); $('code').focus();
    status(t('若邮箱和邀请符合条件，验证码已发送。请检查收件箱和垃圾邮件，有效期为 10 分钟。'));
  } catch (error) { showError(error); } finally { busy = false; render(); }
});
$('code-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  busy = true; render();
  try { await api('verify', { challenge, code: $('code').value }); window.location.assign('/'); }
  catch (error) { showError(error); busy = false; render(); }
});
$('back').addEventListener('click', () => { challenge = null; $('code').value = ''; status(''); render(); });
$('logout').addEventListener('click', async () => {
  busy = true; render();
  try { await api('logout', {}); window.location.reload(); } catch (error) { showError(error); busy = false; render(); }
});
try {
  let lang = 'zh';
  try { const saved = localStorage.getItem('sp.pref.lang'); if (['zh', 'en', 'ja', 'ko', 'zh-TW'].includes(saved)) lang = saved; } catch { /* optional */ }
  $('language').value = lang; await language(lang);
  const res = await fetch('/auth/api/session', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('UNAVAILABLE');
  session = await res.json();
  if (!session.enabled) window.location.replace('/');
  render();
  if (!session.mailAvailable && !session.user) status(t('验证邮件暂不可用，请稍后重试。'), true);
} catch (error) { showError(error); }
setInterval(render, 1000);
