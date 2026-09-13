# Webapp TODO Follow-ups Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement these tasks inline. Steps use checkboxes for tracking. The user approved implementation; no commits are requested.

**Goal:** Correct OAuth readiness reporting and payroll requester attribution, and retire unused approval-resolution notification stubs after verifying central delivery.

**Architecture:** Keep OAuth readiness separate from provider authentication and persistent test status. Resolve payroll requesters using the existing organization-scoped employee lookup pattern. Preserve the central notification service as the sole outcome delivery path.

**Tech Stack:** Next.js, TypeScript, Drizzle, Vault, React, Tolgee, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-12-webapp-todo-followups-design.md`

---

## Task 1: Payroll employee attribution

**Files:**
- Modify `apps/webapp/src/lib/scheduled-exports/application/executors/payroll-export-executor.ts`.
- Create sibling `payroll-export-executor.test.ts`.

- [x] Add tests mocking the database and payroll service, using distinct schedule-user, config-user, config, and employee IDs. Assert the job receives the employee ID and organization. Test absent creator, absent scoped employee, and a matching user in a different organization; each must prevent job creation.

```ts
expect(createExportJob).toHaveBeenCalledWith(expect.objectContaining({
  organizationId: "org-1",
  requestedById: "employee-1",
}));
```

- [x] Run `pnpm --filter webapp exec vitest run src/lib/scheduled-exports/application/executors/payroll-export-executor.test.ts`; confirm attribution assertions fail against current code.
- [x] Import `and`, `eq`, `db`, and `employee`; use `createdBy` from execution parameters. Remove the unused system-user constant and provisional attribution comments. Resolve the requester before creating a job:

```ts
const requester = createdBy
  ? await db.query.employee.findFirst({
      where: and(eq(employee.userId, createdBy), eq(employee.organizationId, organizationId)),
      columns: { id: true },
    })
  : undefined;
if (!requester) {
  return {
    success: false,
    error: "Unable to determine requester for payroll export. The schedule creator may not have an employee record.",
  };
}
const requestedById = requester.id;
```

- [x] Rerun the same test command; expect all cases to pass.

## Task 2: OAuth readiness service and action

**Files:**
- Create `apps/webapp/src/lib/social-oauth/configuration-check.ts` and `configuration-check.test.ts`.
- Modify `apps/webapp/src/lib/social-oauth/index.ts` and `types.ts`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/enterprise/actions.ts` and `actions.social-oauth.test.ts`.

- [x] Define and test `checkSocialOAuthConfiguration(configId, organizationId)` returning:

```ts
type SocialOAuthConfigurationCheckResult = {
  checkType: "configuration";
  authenticationVerified: false;
} & (
  | { success: true; status: "ready" }
  | { success: false; status: "not_found" | "inactive" | "incomplete" | "unavailable"; error: string }
);
```

- [x] Cover organization-scoped lookup, missing/blank client ID, missing secret, inactive config, Apple team/key IDs and private-key readability/type, database and Vault failures, and successful readiness. Mock external dependencies; assert no secret appears in errors and no test status is written.
- [x] Run `pnpm --filter webapp exec vitest run src/lib/social-oauth/configuration-check.test.ts`; confirm missing implementation failures.
- [x] Implement exact configuration lookup with `and(eq(organizationSocialOAuth.id, configId), eq(organizationSocialOAuth.organizationId, organizationId))`. Parse object/string provider config. Read only organization Vault secrets. For Apple, check the same required credential paths used by credential resolution and parse an EC P-256 private key with Node crypto. Return sanitized `unavailable` on infrastructure exceptions. Do not use global credential resolution or provider network requests.
- [x] Replace the unused fake test action with `checkSocialOAuthConfigurationAction`, forwarding `configId` and the authorized active organization to the service. Remove its `updateTestStatus` import. Preserve the standalone legacy persistence helper and schema fields for compatibility.

```ts
export async function checkSocialOAuthConfigurationAction(configId: string) {
  const { organizationId } = await requireEnterpriseOrgAdmin();
  return checkSocialOAuthConfiguration(configId, organizationId);
}
```

- [x] Replace old action tests that expected a successful database write with readiness forwarding, unsuccessful readiness, and authorization-denial tests.
- [x] Run `pnpm --filter webapp exec vitest run src/lib/social-oauth/configuration-check.test.ts src/lib/social-oauth/service.test.ts 'src/app/[locale]/(app)/settings/enterprise/actions.social-oauth.test.ts' 'src/app/[locale]/(app)/settings/enterprise/actions.identity-setup.test.ts'`; expect success.

## Task 3: Accurate OAuth status copy

**Files:**
- Modify `apps/webapp/src/components/settings/enterprise/social-oauth-management.tsx`.
- Update new keys in `apps/webapp/messages/settings/enterprise/<locale>.json` using the actual namespace mapping discovered in Tolgee configuration.

- [x] Replace historical `lastTestSuccess`-based `Working`/`Error` badges with explicit `Unverified` authentication status. Label the column `Authentication`; remove the misleading last-tested column and unused date-formatting imports. Keep the existing active switch and configured-provider information.

```tsx
<TableHead>{t("settings/enterprise:settings.enterprise.socialOAuth.authentication", "Authentication")}</TableHead>
<Badge variant="secondary">
  {t("settings/enterprise:settings.enterprise.socialOAuth.unverified", "Unverified")}
</Badge>
```

- [x] Update the real mapped locale catalogs with those two keys and localized wording. Keep statically extractable keys and defaults. This copy-only change needs no new mirrored unit tests.
- [x] Run relevant Tolgee tests and targeted lint/type checks. Attempt runtime inspection if a configured dev server is available; record any environment blocker.

## Task 4: Central notification regression and dead-code cleanup

**Files:**
- Modify `apps/webapp/src/lib/notifications/__tests__/notification-service.test.ts`.
- Modify `apps/webapp/src/lib/{teams,telegram,discord,slack}/notification-trigger.ts` and each sibling `index.ts`.

- [x] Search repository references for all four platform resolution trigger names before deletion.
- [x] Add parameterized tests for `approval_request_approved` and `approval_request_rejected` across all four bot channels. Explicitly reset all channel mock availability and delivery implementations between cases. Verify organization, recipient, entity, and action URL payload forwarding; disabled preferences and unavailable platforms prevent delivery; a rejected provider send is logged while notification creation succeeds.

```ts
expect(send).toHaveBeenCalledOnce();
expect(send).toHaveBeenCalledWith(expect.objectContaining({
  userId: "requester-user",
  organizationId: "org-1",
  type,
  entityId: "approval-1",
}));
```

- [x] Run `pnpm --filter webapp exec vitest run src/lib/notifications/__tests__/notification-service.test.ts` before cleanup; expect green because the production delivery path already exists.
- [x] Delete only unused resolution functions and their barrel export entries. Keep new-request trigger implementations and shared notification adapters.
- [x] Run the same suite plus `src/lib/notifications/triggers.test.ts`, `src/lib/bot-platform/approval-handler-replay.test.ts`, and `src/lib/approvals/handlers/travel-expense-claim.handler.test.ts` to cover final-decision and intermediate-stage behavior.

## Task 5: Final verification

- [x] Review changed-file diff for tenant scoping, secret exposure, accurate UI wording, and accidental edits.
- [x] Run targeted Biome checks and `pnpm --filter webapp typecheck`; report pre-existing or environment failures accurately.
- [x] Run the React Doctor regression workflow for the changed React file, and review composition/performance/accessibility guidance.
- [x] Confirm removed trigger/action references are absent from live code and `git diff --check` passes.
- [x] Mark this plan complete only with command evidence. Summarize tests, changed behavior, and any live database/Vault/provider/browser verification that requires unavailable Phase credentials.

## Self-review

All three spec areas have independent tasks and regression coverage. Date calculations and existing notification dispatch remain untouched. OAuth results explicitly distinguish readiness from authentication; no new schema fields, credential fallback, provider authorization flow, or commits are required.

## Execution results

- Final combined Vitest run: **171 tests passed across 10 files** (payroll executor,
  OAuth configuration/service/action suites, notification service/triggers, bot
  approval replay, travel expense handler, and Tolgee shared tests).
- `pnpm --filter webapp typecheck`: passed, including route generation and all
  three configured TypeScript projects.
- New configuration-check implementation and both new test files pass full Biome
  checks. Lint-only checks across the 18 touched TypeScript files pass with nine
  existing `any` warnings. Whole-file formatting also flags existing formatting
  in touched files; the original OAuth management component fails the same
  formatter check at HEAD. New and edited sections were formatted directly.
- React Doctor against HEAD, including untracked files: **93/100**, no errors,
  one duplicate-JSX warning on the ordinary OAuth table header. Reviewed as a
  low-impact structural similarity; a shared table abstraction is not warranted.
- Removed function/action names have no remaining source references.
- `git diff --check`: passed.
- Runtime browser verification was unavailable: `agent-browser` is absent and
  `localhost:3000/_next/mcp` is unreachable. Live database, secret-store, and
  provider verification was not run because Phase-managed credentials are not
  available. Unit tests use mocked external boundaries.
- No commits were created.
