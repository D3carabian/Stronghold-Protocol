# Email verification and invitations

## Purpose

Replace shared temporary passwords with email one-time codes and single-use or limited-use invitations. Existing
players sign in without consuming another invitation. Production and staging have separate databases and cookies.
Resend is the selected initial adapter; the owner has verified the sending domain. Never send fake verification codes to
logs or silently bypass authentication when the provider is unavailable. Production keeps its current gate until
real delivery and the full login flow pass. No changes to Tailscale policy are authorized in this task.

## Progress

- [x] Read repository instructions and checked clean origin/main; created feature/email-invitations in an isolated worktree.
- [x] Read current Resend pricing, domain verification and API documentation.
- [x] Implement SQLite identity/invite/session storage and a bounded email-code flow.
- [x] Protect HTTP and WebSocket, bind reconnect identities and handle revocation.
- [x] Add accessible mobile-friendly login/account screens with translations.
- [x] Add administrative CLI, persistent deployment overlay, backups and migration documentation.
- [ ] Test expiry/replay/abuse/concurrency, HTTP/WS and browser flows; run repository checks.
- [ ] Configure Resend when credentials/domain verification are available; validate real delivery on staging.
- [ ] Commit/push and open a reviewable PR; update current-state docs with measured results.

## Decisions

Use Node's built-in SQLite module (Node >=22.13), HMAC-hashed codes and invitation secrets, opaque hashed sessions,
host-only HttpOnly cookies, strict Origin checks and persistent email/IP/global send limits. Invite redemption and
session creation are atomic transactions. Do not hold a database transaction while awaiting email delivery.
Preserve the game simulation, protocol and golden baselines. Bind a resumed in-memory player to the authenticated
internal user. The Resend adapter is replaceable and never accepts provider credentials from a browser.
Start with a CLI for issuing/revoking invitations and disabling accounts, rather than expanding this task into a
general game administration UI. Real Resend API keys remain outside Git in owner-readable private configuration.

## Acceptance and recovery

New accounts require a valid invitation and mailbox code; returning accounts require a fresh code. Codes expire,
are limited to five guesses and cannot be replayed. Revoked/expired sessions cannot open or use a WebSocket. Another
account's game reconnect token must never resume that player. Requests with a foreign Origin fail. Missing mail
configuration fails closed. Anonymous assets and games stay protected while the login UI remains accessible.
Run targeted auth tests, HTTP/WS integration tests, i18n checks, npm run ci and npm run golden. Test the browser in
local isolated fixtures and then real staging. Before any database upgrade make a consistent SQLite backup.
Keep the production image, resource bundle and Basic Auth config available for rollback, and never deploy during
an active room. Do not run a candidate container against the live authentication database.

## Discoveries

The upstream uses a secret game reconnect token but has no account binding. The current deployment health check
needs room/socket counts; authenticated deployments will use an independent health token instead of weakening
game authentication. The Resend domain is verified. The first supplied value was a DKIM public key; the owner is replacing it with a sending API key.

## Outcomes

Implementation in progress. Record exact tests, real-delivery evidence and deployed environments before completion.
