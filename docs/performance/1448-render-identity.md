# Render-local identity reuse (#1453)

The authenticated layout, sidebar identity readers and Dashboard access checks
now use `lib/auth/render-context.ts`. React's RSC request cache owns its lifetime.
The module is server-only and exposes no Server Action. Public action/handler
authentication, transaction-bound MFA reads, command authorization and billing
enforcement keep their existing fresh paths.

The render readers share the current session, one organization-membership read,
one minimal employee-profile read and one presentation/onboarding settings read.
Only the current user's organizations and profiles in those organizations are
read. Approved membership and the existing employee eligibility predicate decide
the active employee and settings tier. No active organization means no employee
fallback. The layout's billing controls reuse the approved membership, while the
billing entitlement itself remains freshly checked.

Organization feature defaults and the existing Billable Time/project dependency
have one shared display projection. Presentation values retain their existing
locale, timezone, week-start, time-format and consent normalization. Onboarding
fields remain server-side; they are not added to the preference provider props.

## Structural evidence

`src/lib/auth/render-context.integration.test.ts` runs the installed production
React Server Components renderer and real PostgreSQL production readers through
the existing disposable database/query-logging seam. It resolves the installed
React server build for that renderer; `React.cache` and its dispatcher are real,
not fake memoizers. Only the authentication/request boundary is substituted.

The fixture renders three lightweight server consumers of the same read
interfaces used by the layout, sidebar identity and Dashboard. This isolates
render-cache behavior from unrelated sidebar capabilities and client UI.

| Compared structural condition | Before | After |
| --- | ---: | ---: |
| Underlying session evaluations in one combined reader render | 8 | 1 |
| Organization/membership identity reads after migration | Not separately captured | 1 |
| Employee-profile identity reads after migration | Not separately captured | 1 |
| Shared presentation/onboarding reads after migration | Not separately captured | 1 |

The initial test failed with `expected 8 to be 1` before migrating the readers.
It now asserts the one-session and query-family budgets, rather than SQL text or
private helper invocation counts. Two-user/two-organization concurrent renders,
simultaneous active-organization changes for one user, sign-out, pending
membership, inactive employees, a due departure before materialization, absent
active organization and MFA/SSO-held identities have explicit expected output.
Every separate render re-evaluates session/access and current profile evidence.

Existing rendered layout/sidebar tests retain invalid-session and MFA redirects,
saved locale redirects, fail-closed billing, recovery-route behavior, provider
preferences and capability/navigation cases. Public auth-helper regressions still
use the unchanged request paths.

## Checks

From a normal dependency installation:

```text
pnpm --filter webapp test:integration src/lib/auth/render-context.integration.test.ts
pnpm --filter webapp exec vitest run --project unit src/lib/auth-helpers.test.ts src/lib/organization-settings.test.ts src/lib/user-preferences/render-snapshot.test.ts "src/app/[locale]/(app)/app-layout-content.test.tsx" src/components/app-sidebar.test.tsx src/lib/auth/request-session.test.ts "src/app/[locale]/(app)/cache-components-route-contract.test.ts" --testTimeout 30000
pnpm --filter webapp typecheck
pnpm exec react-doctor apps/webapp --verbose --scope changed --base 39a08d0bb --include-untracked --no-telemetry --no-supply-chain
```

The RSC/PostgreSQL suite passed nine cases. The unit set and request/cache-route
contracts passed 330 tests, full type checking passed, and React
Doctor reported no new issues. Its external score/telemetry was disabled; no
numeric health score is claimed. The React performance/composition review and
current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) review found no new issues in this data-reader
change; rendered markup and interactive composition are unchanged.

## Remaining acceptance gates

This is structural RSC/PostgreSQL evidence, not a complete Next.js HTTP journey
or a browser timing baseline. First-document/server-refresh readiness, response
bytes, complete request query counts, CI-mode integrated build and controlled
production-mode browser evidence remain release gates under #1450/#1475.

Sidebar secondary capability helpers still use their existing fresh
authentication/principal reads. Their additional session work is not included in
the one-evaluation reader budget above; #1455 owns that capability slice and its
independent loading boundary. This change introduces no cross-request session,
permission or billing cache and makes no production latency claim.
