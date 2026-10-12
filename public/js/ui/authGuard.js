// Session expiry must also work during a match, when the account link is not mounted.
export function installAuthGuard(net, { fetcher = fetch, redirect = () => window.location.assign('/auth/login'), now = Date.now } = {}) {
  let nextCheck = 0;
  const offRequired = net.on('authRequired', redirect);
  const offStatus = net.on('status', ({ status }) => {
    if (status !== 'reconnecting' || now() < nextCheck) return;
    nextCheck = now() + 30000;
    // A rejected upgrade is a generic socket error in browsers. Check whether the cookie expired.
    fetcher('/auth/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) })
      .then((r) => r.ok ? r.json() : null).then((data) => {
        if (data?.enabled && !data.user) redirect();
      }).catch(() => {});
  });
  return () => { offRequired(); offStatus(); };
}
