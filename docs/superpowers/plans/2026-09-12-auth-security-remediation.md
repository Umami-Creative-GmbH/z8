# Authentication Security Remediation Implementation Plan

> Execution: four parallel implementation subagents at the user's request; shared configuration integration and final review by the coordinating agent. No commits or shared-database operations are authorized.

**Goal:** Close the four reviewed authentication vulnerabilities and provide console-authorized first-admin setup.

**Architecture:** Independent Better Auth plugins provide CAPTCHA, account-ban and SSO enforcement. The verified social OAuth callback participates in the standard auth lifecycle. A Redis bootstrap service provides startup-issued setup credentials and atomic exchange.

**Tech Stack:** Next.js, Better Auth 1.7.3, Drizzle/PostgreSQL, Redis, Temporal, TanStack Form, Vitest.

## Parallel work ownership

1. SSO: `src/lib/enterprise-identity/session-sso*.ts`, `sso-enforcement-plugin.ts`, application authorization helpers, organization activation/reauthentication, and `drizzle/0067_session_sso_provenance.sql`.
2. Bans: `src/lib/auth/account-ban.ts`, `social-org-oauth.ts`, custom OAuth callback bridge, and platform-admin ban/revocation.
3. Bootstrap: `src/lib/setup/`, `/api/setup/authorize`, setup page/action/service, startup instrumentation and setup privacy handling.
4. CAPTCHA: `src/lib/turnstile/auth-plugin.ts`, `auth-policy.ts`, service, and signup/login/password-reset clients.

The coordinator owns `src/lib/auth.ts`. All source paths above are relative to `apps/webapp/`.

## Integration

- [x] Implement meaningful failing regressions before each fix and run each agent's focused suites.
- [x] Register the guards in production configuration:

```ts
plugins: [
  turnstileAuthGuard(),
  accountBanPlugin(),
  socialOrgOAuthPlugin(),
  // Existing plugins, including bearer, admin, organization, and SSO.
  createSsoEnforcementPlugin(sessionSsoStore),
  nextCookies(),
  // Existing SCIM callback model registration.
]
```

- [x] Set `session.cookieCache.enabled = false`; preserve database session storage and guarded secondary storage.
- [x] Set SSO `provisionUserOnEveryLogin = true`; call `recordVerifiedSsoLogin({ user, provider })` after successful existing provisioning.
- [x] Add `auth-composition.test.ts` using the actual production plugin array and real installed middleware to verify cross-plugin behavior.
- [x] Audit nonactive organization targets and ensure `/init` supports SSO reauthentication and non-SSO workspace selection.
- [x] Run combined regression suites, isolated Redis bootstrap tests, typechecks, lint/format checks and React diagnostics. Resolve integration failures before reporting completion.
- [x] Document migration and operator setup/recovery instructions and report checks requiring unavailable deployment configuration.

## Verification result

- Combined regression run: **115 files and 1,163 tests passed**, including the bootstrap scripts against a disposable Redis instance.
- `pnpm typecheck`: route generation, application, workflow-contract and smoke checks passed.
- Targeted Biome checks on 20 integrated security modules/routes passed. Existing unrelated full-file formatting diagnostics were left intact.
- React Doctor changed-scope scan: **100/100**, no issues.
- Independent security review identified internal-origin redirects and nested setup connection acquisition; both were fixed with regression tests before the final run.
- `git diff --check` passed.
- Live browser/IdP/Cloudflare, production startup/build and migration deployment were not run: deployment configuration is unavailable, and the browser CLI is not installed.
- Operator instructions are in `docs/refs/auth-security-operations.md` and `docs/refs/turnstile-auth.md`.

## Verification commands

From `apps/webapp/`:

```bash
pnpm test src/lib/auth src/lib/enterprise-identity src/lib/turnstile src/lib/setup
pnpm typecheck
```

Also run affected API/action/component tests identified by the final diff. Run the Redis suite with `SETUP_REDIS_TEST_URL` pointing exclusively to a disposable test Redis. Run `git diff --check` and inspect the final changes for ownership and generated-schema constraints. Do not push schema to a shared database.
