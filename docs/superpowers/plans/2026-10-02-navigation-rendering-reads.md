# Navigation Rendering Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove repeated session and employee resolutions during time tracking rendering while preserving fresh action authorization.

**Architecture:** A server-only render session wrapper memoizes the authoritative reader with React `cache`. An approved employee resolver feeds a request-local page context and internal organization-scoped readers; action callers retain fresh authentication.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, Better Auth, Drizzle, Vitest.

**Spec:** [Sections 1 and verification](../specs/2026-10-02-navigation-performance-design.md). Read the [delivery plan](2026-10-02-navigation-performance.md) first.

## Global Constraints

- Preserve current data freshness, authorization, organization isolation, timekeeping results, preference defaults, translation keys, and page layout.
- Keep `getRequestSession` fresh, cookie caching disabled, and `connection()` before session I/O. Do not put auth or time records in `use cache`.
- Internal context stays server-only. Public actions accept their existing arguments and authorize freshly.
- Source paths below are relative to `apps/webapp`; commands run there unless stated otherwise. Inherit every global constraint and delivery gate from the delivery plan.

## Review Focus

1. Null/banned/SSO-required sessions cannot emit employee data.
2. Revoked or unapproved membership denies the next render even if the employee still exists.
3. Active organization changes never fall back to another organization's employee.
4. Simultaneous requests for different users cannot share context or failures.
5. Request-local render reuse cannot authorize a later action after membership revocation.

## File structure and interfaces

- Create `src/lib/auth/render-session.ts`: `getRenderSession(): Promise<RequestSession>`, exported as one module-level `cache(getRequestSession)` function. No second direct Better Auth call.
- Create `src/app/[locale]/(app)/time-tracking/actions/employee-context.ts`: fresh approved membership/employee resolution shared with action auth. Export `resolveEmployeeContext(session: AuthSession): Promise<ApprovedEmployeeContext | null>` and `ApprovedEmployeeContext = { employee: CurrentEmployee; membershipRole: string }`. Keep existing approved-status, active-organization, active-employee predicates; select membership role in the same membership query.
- Create `src/app/[locale]/(app)/time-tracking/render-context.ts`: `getTimeTrackingRenderContext(): Promise<TimeTrackingRenderContext | null>` using React `cache`. Null means unauthenticated/access denied; authenticated no-employee uses `employee: null`. Define the authenticated union with `userId`, `employeeName`, `employee`, `membershipRole: string | null`, `timezone`, `timeFormat: TimeFormat`, and `weekStartDay: WeekStartDay`. Export `EmployeeRenderContext = Extract<TimeTrackingRenderContext, { employee: CurrentEmployee }>` for later regions. No session/token in client props.
- Create `src/app/[locale]/(app)/time-tracking/read-queries.ts`: organization-scoped SQL reused by render and guarded wrappers. Export `EmployeeReadScope = Readonly<{ employeeId: string; organizationId: string }>` and the three readers in task 2.

### Task 1: Establish the render session and employee context

**Files:** Create the first three modules above and `render-context.test.ts` beside the context. Modify `src/lib/auth/request-session.test.ts`, `actions/auth.ts`, `actions/auth.test.ts`, `page-data.ts`, and `src/app/[locale]/(app)/app-layout-content.tsx`. Keep `src/lib/auth-helpers.ts` and action/handler callers outside this initial migration; they serve more than rendering.

**Interfaces:** Consumes `getRequestSession(): Promise<RequestSession>`, existing `AuthSession`/`CurrentEmployee`, `canAccessOrganizationWithSso`, preference normalizers, and the existing page data result. Produces `getRenderSession`, `resolveEmployeeContext`, and `getTimeTrackingRenderContext` as defined above. Existing `getCurrentEmployee(): Promise<CurrentEmployee | null>` delegates to the fresh resolver after `getCurrentSession`.

- [ ] **Step 1: Add behavioral tests.** Mock database/session seams, not React cache. Exercise the real context resolver once with null session, required/failed SSO, absent active org, unapproved membership, missing/inactive employee, and approved owner/admin/employee. Pin the role and one membership/employee read, defaults UTC/Sunday/24-hour, and session absence. Test sequential fresh `getCurrentEmployee()` calls after changing active org and membership. Assertions include:

```ts
expect(await getTimeTrackingRenderContext()).toMatchObject({
  userId: 'user-1', employee: { id: 'employee-1', organizationId: 'org-1' },
  membershipRole: 'owner', timezone: 'UTC', weekStartDay: 'sunday', timeFormat: '24h',
});
expect(findMember).toHaveBeenCalledTimes(1);
expect(findEmployee).toHaveBeenCalledTimes(1);
// Separate fresh action resolution after revocation:
expect(await getCurrentEmployee()).toBeNull();
```

Use existing `actions/auth.test.ts` database mocks as the fixture pattern. Keep session `ssoRequired` and the org SSO predicate covered without exposing tokens. Extend the authoritative reader test: two direct calls cause two Better Auth evaluations, and held `connection()` prevents I/O.

- [ ] **Step 2: Run the tests before implementation.** `pnpm exec vitest run --project unit 'src/lib/auth/request-session.test.ts' 'src/app/[locale]/(app)/time-tracking/actions/auth.test.ts' 'src/app/[locale]/(app)/time-tracking/render-context.test.ts'`. Expected: new context import/assertions fail; existing tests retain their baseline result.
- [ ] **Step 3: Implement the interfaces.** Keep membership and employee reads parallel as today, with membership role in the existing row. Render context uses `getRenderSession`, the existing org SSO policy, and the resolver; read the current three presentation settings once at this stage. Do not broaden employee eligibility or change action errors. Migrate layout session and page data session/employee resolution to the render reader/context; use context role instead of page data's separate member role query. Preserve the aggregate page result until change 2. Preserve layout redirect and billing gates; page null-auth handling must follow the existing session-expired flow before any protected region is returned.
- [ ] **Step 4: Verify unit behavior and actual request scope.** Rerun step 2. In the production-mode fixture process, count underlying migrated reads for one actual RSC request, then repeat with a new request and concurrently with a second account. Expected: one session evaluation among migrated consumers per render, one membership/employee resolution for the time page, fresh results on each request, and no cross-user leakage. Standard Vitest calls outside React rendering do not prove memoization. Run the baseline measurement procedure; attach operation counts without SQL/session contents. If runtime configuration is unavailable, record this gate as pending.
- [ ] **Step 5: Commit only this task's files.** `git commit -m 'perf: reuse authorized time tracking render context'` after staging the files explicitly. Run shared typecheck/format checks before committing code.

### Task 2: Reuse scoped read queries without re-authenticating regions

**Files:** Create `read-queries.ts`, `read-queries.test.ts`, and `read-queries.integration.test.ts` beside it. Modify `actions/queries.ts`, `actions/queries.test.ts`, `page-data.ts`, `page-data.test.ts`, and `read-helpers.server-action-surface.test.ts`. The source-contract assertion that page data imports three guarded wrappers must be updated to its new trusted-render boundary; retain its endpoint-surface checks.

**Interfaces:** Consumes task 1's `EmployeeRenderContext`; creates scope from its validated employee. Produces:

```ts
readActiveWorkPeriod(scope: EmployeeReadScope): Promise<WorkPeriodWithEntries | null>
readWorkPeriods(scope: EmployeeReadScope, startDate: Date, endDate: Date): Promise<WorkPeriodWithEntries[]>
readTimeSummary(scope: EmployeeReadScope, timezone: string, weekStartDay: WeekStartDay): Promise<TimeSummary>
```

Use the existing time tracking types and calculations. Scope is an internal server trust boundary, not proof of authorization for arbitrary callers. The three existing wrapper signatures remain unchanged for action consumers.

- [ ] **Step 1: Add failing reader behavior tests.** Use two-org database fixtures and the existing pending-approval metadata cases. Assertions: every work period query includes both IDs; deleted rows are excluded where currently excluded; newest-first history and stable approval request/assignment IDs match the predecessor; summary totals/surcharges match for Sunday/Monday and DST fixtures. For the render page, mock `getCurrentEmployee` to throw if called after the context has resolved, then assert history and summary still return. Add a wrapper test where requested employee differs from authorized employee and preserve `[]`/zero-summary behavior. Fresh wrappers must deny a newly revoked membership.

```ts
expect(await readWorkPeriods(scope, startDate, endDate)).toEqual(expectedHistory);
expect(await readTimeSummary(scope, 'Europe/Berlin', 'monday')).toEqual(expectedSummary);
expect(await getWorkPeriods('other-employee', startDate, endDate)).toEqual([]);
```

Integration fixtures deliberately include a foreign-org period; assert none is returned. Pin fields/content, not generated UUIDs or exact SQL strings.

- [ ] **Step 2: Run to observe failure.** `pnpm exec vitest run --project unit 'src/app/[locale]/(app)/time-tracking/read-queries.test.ts' 'src/app/[locale]/(app)/time-tracking/actions/queries.test.ts' 'src/app/[locale]/(app)/time-tracking/page-data.test.ts'`. Expected: missing new readers/assertions fail. Run `pnpm test:integration 'src/app/[locale]/(app)/time-tracking/read-queries.integration.test.ts'` with the disposable runner for the database cases.
- [ ] **Step 3: Extract SQL and wire callers.** Move active-period/history/summary mapping and calculations into `read-queries.ts`, adding organization filtering to the active-period reader. Guarded wrappers resolve fresh current employee, validate the requested ID, and delegate. Page data delegates directly after context authorization. Keep unrelated assigned-project/edit-capability queries in `actions/queries.ts`. Do not change time boundaries or approval-target selection while extracting them.
- [ ] **Step 4: Verify.** Rerun step 2 and `pnpm exec vitest run --project unit 'src/app/[locale]/(app)/time-tracking/read-helpers.server-action-surface.test.ts' 'src/app/[locale]/(app)/time-tracking/actions.server-action-surface.test.ts' 'src/app/[locale]/(app)/time-tracking/actions.canonical.test.ts' 'src/lib/time-tracking/timezone-utils.test.ts'`. Expected: all pass and internal readers stay outside `use server` exports. Repeat actual-render query counts and shared gates. Actions must still use fresh readers after fixture revocation/org switch; no live production mutations.
- [ ] **Step 5: Commit and deliver change 1.** `git commit -m 'perf: share organization scoped time tracking reads'`. Record results in change-1 evidence and create its reviewed PR to `dev` before change 2 is merged.
