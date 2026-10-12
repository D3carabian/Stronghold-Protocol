// i18n-ignore-file: transactional email is deliberately bilingual, independent of a browser language.
export function resendMailer(config, fetcher = fetch) {
  const configured = !!config.apiKey && /^[^\r\n]+@[^\r\n]+$/.test(config.from);
  return {
    configured,
    async send({ email, code, id }) {
      if (!configured) throw new Error('MAIL_UNAVAILABLE');
      const label = config.environment === 'staging' ? 'Stronghold Protocol TEST' : 'Stronghold Protocol';
      // Plain text intentionally contains no tracked links or external resources.
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `login/${config.environment}/${id}` },
        body: JSON.stringify({ from: config.from, to: [email], subject: `${label} — 登录验证码 / Sign-in code`,
          text: `${label}\n\n验证码 / Your sign-in code: ${code}\n\n10 分钟内有效，请勿转发。\nValid for 10 minutes. Do not share this code.\n\n登录网站 / Sign-in site: ${config.origin}\n\n如果不是你本人请求，请忽略此邮件。\nIf you did not request this email, you can ignore it.`,
        }),
      });
      if (!response.ok) throw new Error('MAIL_UNAVAILABLE');
      const result = await response.json();
      if (!result.id) throw new Error('MAIL_UNAVAILABLE');
    },
  };
}
