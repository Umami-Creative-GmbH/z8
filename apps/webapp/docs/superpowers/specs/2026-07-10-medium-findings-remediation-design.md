# Medium Findings Remediation Design

## Scope

Remediate only the eight medium-severity findings from the July 10, 2026 `apps/webapp` review. High- and critical-severity findings are out of scope, including concurrent changes already present in authentication, approval, time-tracking, and webhook files.

The fixes will be implemented sequentially. Each finding must have a regression test that fails for the reported behavior before production code changes, followed by targeted and broader verification before work starts on the next finding.

## Remediation Order

1. Centrally enforce web, desktop, and mobile application-access flags at shared authenticated boundaries. Denied requests must fail with an explicit 403 response or the equivalent typed server-action error. Public and integration endpoints must remain reachable where authentication is not applicable.
2. Skip S3 initialization during `phase-production-build`. Runtime startup must continue to validate storage with the correct public and private storage configurations.
3. Remove the root layout's full-application consent waterfall. The page shell and route content must be able to stream without waiting for analytics consent, while consent still determines whether PostHog is enabled.
4. Seed organization settings from the authenticated server layout so analytics pages do not need a hydration-time `/api/auth/context` request before their first data request. Client-side organization switching must continue to update the store.
5. Reload webhook delivery data when the dialog's webhook or pagination offset changes. Ignore stale responses so older requests cannot replace the selected page.
6. Render settings route children exactly once. Suspend only navigation and access-tier content instead of duplicating the route tree in the fallback.
7. Establish a reproducible typecheck command that regenerates Next.js route types, then fix the source errors in audit-export signing and platform-analytics date-range handling. Generated `.next` state must not make the command nondeterministic.
8. Fix only the manually validated date/timezone and accessible-label defects from the review. Date output must use Luxon with an explicit locale and relevant organization, user, or event timezone. Icon-only controls must have translated accessible names.

## Architecture

Changes should extend existing boundaries rather than introduce parallel frameworks. Authentication enforcement belongs in shared auth helpers and Effect authentication services already used by routes and server actions. Server-rendered providers should receive initial organization and consent data as props, leaving client components responsible only for subsequent interaction.

UI fixes should narrow Suspense boundaries and use the existing TanStack Query, Tolgee, Luxon, and component primitives. New general-purpose abstractions are only justified when at least two changed call sites require the same behavior.

## Concurrent Work

Before each edit, re-read the target file and its diff. Preserve all unrelated working-tree changes. If a concurrent change directly implements or conflicts with a medium finding, verify it against the regression test rather than overwriting it.

## Error Handling

Access denial must fail closed and use existing typed errors or established API response shapes. Async UI requests must expose retryable errors where the component already has an error surface and must not silently show stale data. Build-time startup must skip external storage work without weakening runtime failure handling.

## Testing

Each item follows RED-GREEN-REFACTOR:

1. Add the smallest behavioral regression test.
2. Run the targeted test and confirm it fails for the expected missing behavior.
3. Apply the minimal production change.
4. Run the targeted test and relevant neighboring tests.
5. Run TypeScript checks for touched source and React Doctor's changed scope for React changes.

After all eight items, run `pnpm test`, the new typecheck command, React Doctor for changed files, and `CI=true pnpm build` only if required Phase-managed environment variables are available. Report any environment-blocked verification explicitly.

## Success Criteria

- All eight medium findings are either fixed or explicitly blocked by a concrete concurrent conflict.
- Every behavior change has a regression test observed failing before implementation.
- Existing critical/high-finding work remains untouched except where a shared file must be extended without reverting it.
- The complete test suite passes, type checking is reproducible, and no unrelated files outside `apps/webapp` are modified.
