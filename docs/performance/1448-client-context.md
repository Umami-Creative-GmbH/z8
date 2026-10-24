# Shared client organization display context

Issue [#1454](https://github.com/Umami-Creative-GmbH/z8/issues/1454), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

The authenticated layout projects its render-local identity into an explicit
allowlist: user ID, active organization ID, eligible employee ID/organization/role,
organization display settings and an observed-at timestamp. It never passes the
session, token, principal, grants or server authorization context to the client.
The existing organization-settings provider supplies that bootstrap to one shared
TanStack Query family. The existing `useOrganization` interface now reads this
family, so notifications, Dashboard, ability/calendar and absence consumers share
the same display context. No competing settings store is introduced.

The query key includes both user and active organization. The provider seeds the
existing settings store before its children render, clears previous context keys
on scope replacement and clears display roles/settings on a failed context read.
The settings subtree remounts on identity/organization replacement, while an
ordinary context refresh keeps the same subtree. A newer server bootstrap can
replace an earlier broader display role for the same identity. An omitted
`initialContext` retains the legacy settings-only provider; explicit `null`
enables the shared fallback read. Standalone hook consumers still share the same
query family and hydrate their settings as before.

Fallback and explicit refresh use the existing `/api/auth/context` GET with
`cache: no-store` and expected user/organization headers. Each handler freshly
authorizes the request; the expectation only rejects a raced scope and cannot
grant access. A mismatched request is rejected before reading organization
settings, and the client also rejects a mismatched response. Display data never
authorizes a server command. Existing full-page organization switching and
server mutation authorization are unchanged.

## Structural evidence

The spec's budgets are zero redundant initial context GETs with a bootstrap and
at most one in-flight fallback context GET per user/organization. The first
provider regression failed against base `f60bc703d`: the header's initial display
was `:::true` instead of the known organization, employee and role. It passes
with immediate correct display and zero context requests after this change.

The existing provider seam now uses a real QueryClient, provider and organization
and ability consumers, with only the client session and HTTP transport boundary
controlled. Eleven cases pass, covering:

- Immediate bootstrap display and existing settings-only hydration.
- One held fallback GET shared by organization and ability consumers, including
  consumers without a bootstrap provider.
- Newer same-identity display-role reduction and same-organization user changes.
- Organization replacement, pending client session, sign-out and expiry found
  during explicit refresh.
- Cross-scope responses and delayed old-scope completion after replacement.

The existing real production React Server Components/PostgreSQL suite now renders
the actual display projection. All ten cases pass, retaining one underlying
session and shared identity/presentation reads, concurrent user/organization
isolation and the established access-reduction cases. The projection regression
also verifies the rendered bootstrap contains its display fields without the
session ID, user name or email. Existing HTTP route tests cover the hydration
response and stale expected-user/organization rejection.

Validation on October 24, 2026, Windows/Node 26.9.0, React 19.3, Vitest 5.0.3:
ten PostgreSQL/RSC cases, 93 affected unit cases and the full webapp type check
pass. Scoped new/edited-source Biome lint/import checks pass; inherited whole-file
formatting differences in the existing key factory/layout are retained. React
Doctor's changed scope has no new issues after separating request validation and
identity/freshness decisions from the hook. External score/telemetry is disabled.
React performance, composition and current Web Interface Guidelines review found
no new issue; visible markup, keyboard controls and loading geometry are unchanged.

## Reproduce and remaining gates

```sh
pnpm --filter webapp exec vitest run --project unit src/components/providers/organization-settings-provider.test.tsx src/app/api/auth/context/route.test.ts
pnpm --filter webapp test:integration src/lib/auth/render-context.integration.test.ts
phase run -- pnpm --filter webapp typecheck
```

These are deterministic provider/request and reader checks, not controlled
production-mode browser timings. The full authenticated Dashboard/header journey,
first-document/return/refresh p50/p95, bytes, real browser request totals,
concurrent load and integrated CI production build remain unfulfilled gates in
the #1450/#1475 fixture run. No production latency gain is inferred from the
provider request budget. Keep this ticket open until those gates are recorded.
