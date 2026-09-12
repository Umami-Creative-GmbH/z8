# Authentication security remediation

Approved scope: fix the four findings from the webapp security review. The user approved the design and requested four parallel implementation agents, with shared integration and verification performed by the coordinating agent.

## Organization SSO

Store server-verified SSO provenance for the exact session, user, organization, and provider in an application-owned table. Record it only after Better Auth has authenticated an OIDC or SAML response. Read activated organization policy on access; a linked provider account or client-provided provider name is not authentication proof.

Guard organization switching, Better Auth organization APIs, and application authorization helpers, including requests targeting a nonactive organization. Keep organization discovery and non-SSO workspaces available. Quarantine an unauthorized active organization while retaining identity for explicit IdP reauthentication. Return through `/init` to the requested organization without automatic redirect loops.

## Account bans

Create custom social OAuth sessions inside Better Auth's endpoint context and use its session/cookie APIs. Enforce current bans beneath endpoint dispatch for both cached and database-backed session reads, and in session-creation hooks. Disable cookie-only session caching. Revoke existing sessions when a platform administrator bans a user. Expired bans are evaluated as absolute instants using Temporal.

## Setup authorization

At real server startup, if the authoritative database has no platform administrator, generate a random 256-bit code and store it in Redis with a one-hour TTL. Concurrent startups reuse the existing code without extending its expiry. Print the code and absolute `/setup?code=…` URL in the server console.

Exchange a valid code atomically and only once for a host-only HttpOnly setup cookie. Redirect to the clean localized setup page. The cookie is valid for at most ten minutes and never beyond the original code expiry. Validate authorization at the page, action, and service boundaries, including after acquiring the database advisory lock. Failed database transactions remain retryable; successful setup invalidates Redis bootstrap state. The authoritative existing-admin check continues to deny access even if cleanup fails.

Redis failures deny setup. Public requests cannot issue new codes. After the original one-hour window expires, restart the webapp to generate a replacement. Suppress credential-bearing setup requests from routine application request logs and telemetry; explicit startup console output is intentional.

## Turnstile

Send a Turnstile token on the same request as password login, registration, or password-reset request, using `x-captcha-response`. Resolve global or verified-domain policy on the server and verify the token before authentication side effects. Cover HTTP and direct Better Auth API calls. Missing, invalid, replayed, or wrong-host tokens fail closed when enabled. Remove separate browser verification from these flows so single-use tokens are not consumed twice.

## Verification

Use installed Better Auth with memory-backed stores and mocked IdP/Cloudflare responses to verify actual hook composition. Test SSO scope/proof failures and successful reauthentication; bans across cache and database paths; CAPTCHA before side effects; and setup expiry, replay, concurrency, and rollback. Exercise bootstrap Lua scripts against an isolated disposable Redis instance. Run application, workflow-contract and smoke typechecks, targeted formatting/lint, and changed React diagnostics. Production startup, live IdP/Cloudflare checks, and database migration deployment require operator-provided Phase configuration.
