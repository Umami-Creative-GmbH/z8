# Turnstile authentication guard (VULN-004)

## Auth integration

`apps/webapp/src/lib/auth.ts` registers `turnstileAuthGuard()` in the Better Auth plugin array. Together with the three browser forms, this enforces verification inside the same authentication request before the protected operation executes.

```ts
import { turnstileAuthGuard } from "@/lib/turnstile/auth-plugin";

export const auth = betterAuth({
	// Existing configuration...
	plugins: [
		turnstileAuthGuard(),
		// Existing SSO, ban, and other plugins...
	],
});
```

Keep the guard registered once, ahead of plugins that perform authentication effects. Better Auth runs a top-level `hooks.before` before plugin hooks; that top-level hook must not perform signup, session creation, or reset-email effects before this guard. No client plugin, auth schema generation, or migration is required.

## Request contract

Signup, password sign-in, and password-reset requests send the fresh widget token in `x-captcha-response` on the **same authentication request**:

```ts
await authClient.signIn.email(
	{ email, password },
	{ headers: { "x-captcha-response": token } },
);

// Direct server calls must forward the original headers, including Host and token.
await auth.api.signInEmail({ body: { email, password }, headers: request.headers });
```

The before hook protects `/sign-up/email`, `/sign-in/email`, and `/request-password-reset`, plus the legacy `/forget-password` path if an installed endpoint exposes it. Better Auth 1.7.3 exposes only `/request-password-reset`; this plugin does not add an alias. HTTP requests and direct `auth.api` calls both execute the hook. Direct calls without headers use the resolved auth base URL for policy and still require a token when enabled.

Do not call `/api/auth/verify-turnstile` or `verifyTurnstileWithServer` before these operations. Their independent boolean result does not authorize an auth request, and Cloudflare consumes tokens on verification. The three browser forms submit directly and reset the widget after an auth failure so retries obtain a fresh token.

## Policy and failures

- Main domains and resolved platform organization subdomains use `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, matching the auth layout.
- Exact hostnames from operator-configured HTTP(S) `APP_URL`, `BETTER_AUTH_URL`, and `NEXT_PUBLIC_APP_URL` are also main hosts. They use global policy without needing a tenant domain record, including during self-hosted bootstrap with `MAIN_DOMAIN` unset or different. URL parsing normalizes case and separates ports from the Cloudflare hostname; this does not authorize arbitrary suffixes or subdomains. Invalid, non-HTTP(S), or credential-bearing URL values do not establish main hosts.
- `getConfiguredMainOrigins()` in `src/lib/domain/platform-domain.ts` supplies the shared validated origins. The domain classifier, custom-domain request resolution, auth layout, and Turnstile policy consequently agree on which hosts use the global widget. Better Auth's allowed-host and static-trusted-origin helpers use the same origins, retaining configured ports and stripping URL paths/query strings. Operator URLs cannot add wildcards; only the existing platform wildcard remains.
- Verified custom domains use their `authConfig.turnstileSiteKey` and the owning organization's Vault `turnstile/secret_key`. A custom domain with no site key has CAPTCHA disabled, without falling back to the global policy.
- Hostnames must be valid authorities and resolve to a known platform domain/organization or verified custom domain. Unknown hosts and lookup errors fail closed.
- The routed `Host` header takes precedence over `request.url`, which Next.js may construct with its internal listening address. Forwarding, organization, user-agent, and native-client headers cannot select policy or exempt a caller. The ingress must preserve the routed Host.
- Cloudflare must return `success: true` and the hostname that displayed the widget. Missing, invalid, expired, replayed, or oversized tokens, missing enabled-policy secrets, and verification failures cannot reach auth effects. Cloudflare enforces single-use tokens; no local boolean/cache grants later authorization.
- CAPTCHA errors return HTTP 400 with `TURNSTILE_REQUIRED`, `TURNSTILE_FAILED`, or `TURNSTILE_POLICY_UNAVAILABLE`. Direct API before-hook failures throw `APIError`, including with `asResponse: true` in Better Auth 1.7.3. HTTP 403 remains available for other authentication policies.

## Client impacts

The desktop app opens browser sign-in, which uses the updated web flow. The available `apps/mobile` directory contains generated artifacts/dependencies but no reviewable source, so its password transport cannot be verified here. Any native or server password client must submit the token on the same request when its domain enables CAPTCHA; there are no spoofable native-client exemptions.

## Regression checks

From the repository root, without Phase secrets:

```bash
pnpm --filter webapp test src/lib/turnstile/auth-plugin.test.ts src/lib/turnstile/verify.test.ts src/components/signup-form.test.tsx src/components/login/login-form-content.test.tsx src/components/forgot-password-form.test.tsx
```

The guard suite uses installed Better Auth with its memory adapter, real before middleware, and synthetic domain/Vault/Cloudflare configuration. It checks missing-token rejection before hashing, password checks, user/account/session/verification writes and email effects; replay rejection; valid and disabled-policy paths; tenant isolation; host validation; failure handling; and actual Better Auth client header transport. Self-hosted bootstrap regressions exercise the real allowed-host helper and dynamic Better Auth base URL using `APP_URL`, plus global-policy and hostname-binding checks for all three deployment URL settings.

`src/app/[locale]/(auth)/layout-turnstile.test.tsx` renders the real layout/provider/login form to verify widget and server-policy agreement, tenant widget preservation, and same-request token submission. The guard suite also exercises HTTP(S) browser origins with non-default ports for all three URL settings, including password-reset redirects and generated email URLs.
