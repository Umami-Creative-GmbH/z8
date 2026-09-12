# Authentication security operations

## Deployment

Apply `apps/webapp/drizzle/0067_session_sso_provenance.sql` through the normal migration deployment before rolling out this webapp version. It creates the application-owned `session_sso_provenance` table; no generated Better Auth schema edits are required.

The webapp registers CAPTCHA, account-ban, custom social OAuth, and SSO-enforcement plugins together in `apps/webapp/src/lib/auth.ts`. Session storage remains database-backed with Redis support. Cookie-only session caching is explicitly disabled so current access policies and bans remain authoritative.

## First administrator setup

1. Start the migrated webapp with working PostgreSQL and Redis connections.
2. If no platform administrator exists, the server console prints:

   ```text
   [Setup] Setup code: <random code>
   [Setup] Open: https://your-app.example/setup?code=<random code>
   [Setup] Expires in <remaining seconds> seconds (original one-hour window).
   ```

3. Open that link once in the browser where you will complete setup. It exchanges the code for a host-only HttpOnly cookie and redirects to the localized `/setup` page without the code in the address bar.
4. Complete the administrator form within ten minutes, and before the original one-hour expiry. Successful creation invalidates bootstrap access.

Concurrent instances and restarts reuse an existing code without extending its one-hour lifetime. An exchanged code cannot be reused. If the cookie is lost or expires, wait for the original one-hour window to expire and restart the webapp to generate a replacement. Public requests cannot generate setup credentials. Failed form submissions or rolled-back database transactions remain retryable while the cookie is valid.

Redis or database failure denies setup authorization. The in-transaction admin check uses the held connection, so setup also works with a one-connection PostgreSQL pool. A committed administrator prevents further setup even if Redis cleanup fails.

The setup URL uses `APP_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, or the configured platform/main domain, in that order; the unconfigured local default is `http://localhost:3000`. Browser-facing setup and SSO redirects validate the routed `Host` against known public origins rather than using Next.js's internal listening address. The ingress must preserve the public Host. Application setup request logging and trace exports omit credentials; the intentional startup console output contains the operator's one-time code.

## Required organization SSO

An activated organization's `ssoRequired` policy requires proof from its configured IdP on the current session. A password, passkey, social login, or linked SSO account alone does not establish that proof. Existing sessions without proof must authenticate through the organization's IdP.

Organization selection starts reauthentication when required and returns through `/init` to activate the intended workspace. Users can still select non-SSO workspaces. Failed IdP returns retain organization selection rather than starting an automatic redirect loop.

Proof is bound to session ID, user ID, organization ID, and provider ID. Revoking/deleting the session removes its proof. Ordinary machine credentials such as existing calendar subscription secrets remain independent authorization mechanisms.

## Account bans

Custom social OAuth uses Better Auth's normal session lifecycle and signed-cookie issuance. Current bans are enforced during session creation and during both cached and database-backed session validation. Platform-admin bans revoke existing sessions; access remains denied even if immediate revocation encounters an infrastructure failure. Expired bans are evaluated as absolute instants.

## CAPTCHA

See [Turnstile authentication guard](turnstile-auth.md). Browser and direct/native password clients send a fresh widget token in `x-captcha-response` on the same signup, sign-in, or password-reset request. The server enforces global or verified-domain policy before the operation's side effects.

## Local verification

Unit, route, component and installed-Better-Auth integration tests use synthetic credentials. Bootstrap concurrency/expiry tests can run against a disposable Redis:

```bash
SETUP_REDIS_TEST_URL=redis://127.0.0.1:<disposable-port> pnpm --filter webapp test src/lib/setup/bootstrap.test.ts
pnpm --filter webapp test src/lib/enterprise-identity/auth-composition.test.ts
pnpm --filter webapp typecheck
```

`SETUP_REDIS_TEST_URL` must point to an isolated test instance: these tests delete their fixed bootstrap keys. Live IdP, Cloudflare, production startup and migration verification require the deployment's operator-managed configuration.
