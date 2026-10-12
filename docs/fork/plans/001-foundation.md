# Foundation: protected production and staging

## Purpose and context

Fork Stronghold Protocol into D3carabian/Stronghold-Protocol, deploy v0.2.4-based production and staging on the
existing Ubuntu Lightsail host, and establish reproducible operations and documentation. Caddy and Tailscale
already work. Production uses play.d3carab1an.com; staging uses test-play.d3carab1an.com. Blog is independent.
The owner selected email verification plus invitations but has no mail provider and explicitly accepted a protected
temporary entrance. Game assets initially come from the matching upstream full release. Later assets will be
exported from a separate Windows computer. iPhone and iPad Safari are target clients, not new asset sources.

## Progress

- [x] Fork created and local main started from v0.2.4; upstream remote retained.
- [x] Upstream architecture and OpenAI AGENTS.md guidance read; project instructions and plan added.
- [x] Release archive downloaded and SHA-256 verified; 12,564 resource references validated.
- [x] Code-only Docker build, separate environment config, maintenance gate and candidate activation prepared.
- [x] Windows export and validated import tools prepared; real Windows run pending availability of that device.
- [ ] Full CI and golden results completed.
- [ ] Production/staging launched behind distinct access gates and HTTPS.
- [ ] WebSocket, resource serving, browser behavior and isolation verified.
- [ ] Changes committed/pushed; fork CI enabled/checked; status and local handoff saved.

## Decisions

Use additive ops/ and docs/fork/ directories while preserving upstream game layout. Keep master upstream-oriented
and main as the fork development baseline. Do not pretend there is an OpenAI-mandated folder layout: adopt concise
AGENTS instructions, self-contained execution plans, linked operational docs and explicit acceptance evidence.

Use separate Docker Compose projects with loopback-only ports and read-only versioned assets. No untrusted PR
runner on the production machine. No scheduled production update in this phase. Use a tiny WebSocket admission
gate controlled by a host-mounted file; Caddy reload is not a safe way to drain long-lived game connections.
Only replace an environment when socket, room, match and human counts are all zero. Rollback code and assets
together. Match persistence is out of scope; authentication and database persistence remain the next phase.

## Discoveries

Upstream full release has all required local art; source-only checkout does not. Upstream Dockerfile omits packs/
and permits asset downloads to fail; fork Dockerfile carries packs, while asset import separately fails closed.
The Mac system Git/Python are blocked by an unaccepted Xcode license; use the installed Codex dependency runtime
instead of accepting unrelated terms or changing global developer settings.
The upstream page already detects Safari <16.4, and includes touch, safe-area and orientation handling.

## Milestones and acceptance

First produce a clean fork plus local tools. Run Python unit tests, the new WebSocket maintenance integration test,
`npm run ci`, `npm run golden`, and docs consistency checks. No golden baseline changes are expected.
Then build a code image pinned to a commit, import the locked assets and activate staging and production separately.
Verify anonymous HTTP/WS return 401, authorized health and resources work, both instances have separate rooms,
and a busy instance refuses replacement. Blog must still return 200 and SSH through Tailscale must still work.
Finally record exact deployed revision, asset ID, tests, known limits and rollback commands; push to the fork.

## Recovery

No synced ChatGPT sources are modified. Preserve original Caddyfile backup. Initial failure restores placeholder
sites or keeps the gate closed. Later failed candidate activation leaves the current environment running; failed
replacement restores its previous image/env. On killed deployment inspect maintenance state before removing the flag.
Do not delete live assets or force-push history. Credentials remain in an owner-readable local file outside Git.

## Outcomes

Pending final deployment evidence. Real iPhone/iPad Safari and Windows extraction are explicitly unverified until
tested on those devices. Future mail provider setup is a separate required input for email verification.
