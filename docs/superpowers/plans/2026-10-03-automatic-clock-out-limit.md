# Organization Automatic Clock-Out Limit Implementation Plan

Status: Approved on 2026-10-03; Subagent-driven execution selected. Tasks 1–5 passed independent review. Task 6 implementation, full unit tests, feature PostgreSQL regressions, and full typecheck are complete; Task 6 and whole-branch reviews are pending. Remaining formatter diagnostics are recorded separately from passing lint/assist checks. Production build and authenticated browser checks require the unavailable Phase runtime environment.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically close overdue uninterrupted live work at an organization-configured limit and notify the employee.

**Architecture:** A five-minute cron scan discovers candidates; a trusted system adapter revalidates the exact period and current settings inside the existing work transaction before calling Clocking. Closure evidence and durable follow-up/channel tasks commit together, and the same cron recovers their delivery. The organization settings UI changes guarded database configuration.

**Tech Stack:** TypeScript, Next.js, React, TanStack Form, Temporal, Drizzle/PostgreSQL, BullMQ, Tolgee, Vitest.

**Spec:** [Approved design](../specs/2026-10-03-automatic-clock-out-limit-design.md). Read it before executing this plan.

**Issue:** [#568](https://github.com/Umami-Creative-GmbH/z8/issues/568), claimed by `KaiSoellch`.

**Branch:** `ai/automatic-clock-out-limit`; the current checkout is already an isolated managed worktree. Preserve concurrent changes and stage only this feature's files.

## Global Constraints

- Enabled by default with `maxUninterruptedMinutes = 720` for existing and new organizations, including missing settings rows.
- Cron pattern is exactly `*/5 * * * *`; no per-clock-in delayed jobs.
- A recorded break or new clock-in resets the allowance; automatic post-clock-out break deductions do not.
- Current settings apply to ongoing work. Record `start + limit`, including retrospective cutoffs after lowering the limit.
- Act only on still-live, nondeleted periods in nondeleted organizations; previously committed manual closures retain their ordinary behavior.
- Every employee/period/task query and mutation is organization-scoped. Settings changes require approved owner/admin authorization.
- Clocking owns both legacy and append admission; the work transaction coordinator owns guard acquisition order.
- The system principal may close only its bound overdue period; no clock-in, break, arbitrary target, browser session, or billing entitlement is required.
- Store UTC instants and event-local offset at the cutoff. Use the target employee's effective saved timezone, not viewer/host/browser timezones.
- Commit notification/follow-up intents atomically with closure; retry delivery independently. The inbox notification is mandatory; optional channels respect preferences and availability.
- Use pnpm, TanStack Form, Tolgee, and Tabler icons. Never edit generated `src/db/auth-schema.ts`.
- New migration `when` exceeds every existing journal value. Never overwrite another worker's migration.
- Do not run tasks requiring unavailable Phase-provided secrets; report skipped runtime/build checks and their exact missing prerequisites.

## Review Focus

- Missing settings row in a newly created organization must still enforce the enabled 720-minute default (Task 1 and Task 3).
- A settings change racing the scan must not close work using old configuration after the settings write commits (Task 3).
- A break racing automatic closure must never cause the resumed work to be closed by the predecessor's candidate (Task 3).
- A crash after committing closure but before delivery must still produce one inbox notification, even if enforcement is disabled meanwhile (Task 4).
- Existing mandatory creator foreign keys must not make the calendar label a system action as a human clock-out (Task 2 and Task 5).

## File and contract map

Paths below are relative to the repository root. New domain modules live together in `apps/webapp/src/lib/time-tracking/automatic-clock-out/` and have separate policy, settings, transaction, outbox, notification, and follow-up responsibilities. Existing Clocking files retain their responsibilities.

Shared contracts in `automatic-clock-out/types.ts`:

```ts
type AutoClockOutSettings = {
  autoClockOutEnabled: boolean;
  maxUninterruptedMinutes: number;
  revision: number; // 0 for an absent row, increments on each saved configuration
};
type AutoClockOutCandidate = {
  organizationId: string; employeeId: string; workPeriodId: string;
};
type AutoClockOutDecision = AutoClockOutCandidate & {
  settings: AutoClockOutSettings; start: Instant; cutoff: Instant;
  timezone: string; provenanceUserId: string; operationId: string;
};
type AutoClockOutOutcome =
  | { status: "closed"; operationId: string; clockOutEntryId: string }
  | { status: "replayed"; operationId: string; clockOutEntryId: string }
  | { status: "skipped"; reason: "disabled" | "not_due" | "not_live" | "not_found" }
  | { status: "deferred"; reason: string };
type AutoClockOutTaskKind = "follow_up" | "plan_notification" | "notification_channel";
type AutoClockOutTaskClaim = {
  id: string; organizationId: string; employeeId: string; operationId: string;
  kind: AutoClockOutTaskKind; payload: Record<string, unknown>;
  claimToken: string; attemptCount: number;
};
type AutoClockOutDeliveryResult = {
  claimed: number; completed: number; deferred: number; failed: number;
};
type AutoClockOutMaintenanceResult = {
  attempted: number; closed: number; skipped: number; deferred: number; failed: number;
  tasks: AutoClockOutDeliveryResult;
  errors: Array<{ organizationId: string; workPeriodId: string; error: string }>;
};
```

`Instant`, `Clock`, `WorkTransactionClient`, and `WorkTransactionScope` come from the existing Temporal/coordinator modules. Database ports use `typeof db` or the existing narrower transaction types; do not manufacture a second PostgreSQL pool. JSON task payloads serialize instants as canonical ISO strings and validate them on delivery.

### Task 1: Persist settings, execution evidence, and durable tasks; define limit policy

**Files:** Create `apps/webapp/src/db/schema/organization-time-tracking-settings.ts`, `apps/webapp/src/db/schema/automatic-clock-out.ts`, and domain `types.ts`, `policy.ts`, `settings.ts`, `policy.test.ts`, `settings.integration.test.ts`. Modify schema `index.ts`, `enums.ts`, `completed-work.ts`, migration journal, `src/db/__tests__/drizzle-migrations.test.ts`, and `apps/webapp/src/lib/rollout/rollback/readiness.ts` plus its unit test to register the new writer's migration floor. Create `apps/webapp/drizzle/0111_automatic_clock_out.sql`.

**Interfaces:** Produce `effectiveAutoClockOutSettings(stored: AutoClockOutSettings | null): AutoClockOutSettings`, `parseAutoClockOutDuration(hours: number, minutes: number): number`, `autoClockOutCutoff(start: Instant, settings: AutoClockOutSettings): Instant | null`, `isAutoClockOutDue(start: Instant, settings: AutoClockOutSettings, now: Instant): boolean`, `loadAutoClockOutSettings(tx: WorkTransactionClient, organizationId: string): Promise<AutoClockOutSettings>`, and `saveAutoClockOutSettings(input: { organizationId: string; autoClockOutEnabled: boolean; maxUninterruptedMinutes: number }, deps: { database: typeof db; clock: Clock }): Promise<AutoClockOutSettings>`. The save helper owns the exclusive organization configuration mutation; its caller supplies verified admin authorization in Task 5.

- [ ] **Write failing policy and database tests.** Pin enabled/720/revision-0 missing-row defaults; valid 12h/0m input; zero, fractional, negative, NaN, infinite, minutes-60, and integer-overflow rejection; disabled cutoff; exact threshold; fresh allowance after a break; UTC duration across DST and midnight. Prove saving a different organization leaves the first organization's settings untouched, revision increments, and disabling retains the duration.

```ts
expect(effectiveAutoClockOutSettings(null)).toEqual({ autoClockOutEnabled: true, maxUninterruptedMinutes: 720, revision: 0 });
expect(parseAutoClockOutDuration(12, 0)).toBe(720);
expect(() => parseAutoClockOutDuration(0, 0)).toThrow();
expect(isAutoClockOutDue(parseInstant("2026-10-03T08:00:00Z"), effectiveAutoClockOutSettings(null), parseInstant("2026-10-03T20:00:00Z"))).toBe(true);
```

- [ ] **Run red tests.** `pnpm --filter webapp test src/lib/time-tracking/automatic-clock-out/policy.test.ts`; expect failure for missing policy exports. Run the settings integration suite through the disposable database runner; expect missing-table/helper failure.
- [ ] **Implement policy and storage.** Duration is integer minutes in `1..2147483647`, with integral nonnegative hours and minutes `0..59`. Use Temporal instant addition/comparison. Save settings using `withOrganizationConfigurationMutation`; upsert with revision 1 for absent rows and increment under the guard for updates. The execution table uses operation UUID as primary key, organization/employee ownership, exact source period/start/cutoff, limit/revision, captured zone/offset, recipient/provenance user, immutable closure payload, and processing instant. Tasks reference their execution and have organization/employee ownership, kind, dedupe key, JSON payload, pending/processing/completed/failed status, lease token, available time, attempts, and sanitized last error; uniqueness is `(organizationId, dedupeKey)`. Add composite ownership foreign keys and due-task indexes. Include the new notification enum value and completed-work writer constraint in the same migration, and register its writer migration floor so exhaustive readiness mappings compile. In the automatic schema file also define `automatic_clock_out_scan_state`: one internal system row keyed `maintenance`, nullable cursor JSON containing the candidate's three identifiers, lease token/expiry, and update timestamp. It stores no organization configuration and is never exposed to tenants. Existing organizations may read defaults through the left join without row backfill.
- [ ] **Validate migration order before writing SQL.** The current last migration is `0110_departure_clock_out_writer`, `when = 1793808000000`. If concurrent work consumes 0111, choose the next free sequence and replace the migration path throughout this plan/readiness mapping; never overwrite it. Register a `when` greater than the current maximum and preserve previous entries. Do not apply the migration to a deployment database.
- [ ] **Run green tests.** Re-run policy/settings suites and `pnpm --filter webapp test src/db/__tests__/drizzle-migrations.test.ts`; expect all passed, including physical constraints exercised in the disposable database.
- [ ] **Commit only Task 1 files:** `feat: add automatic clock-out settings and durable storage (#568)`.

### Task 2: Add narrowly scoped system clock-out to Clocking

**Files:** Modify `apps/webapp/src/lib/time-tracking/clocking/{types,authorize,transactions,clocking,clock-out,follow-ups}.ts`, `close-active-work.ts`, `timezone-capture.ts`, `clocking/clock-out.integration.test.ts`, `clocking/layering.test.ts`, `clocking-writers.test.ts`, and `apps/webapp/src/lib/rollout/rollback/readiness.ts` plus its tests. Update the writer inventory in `docs/all-writer-adoption-327.md`. Create `clocking/automatic-clock-out.integration.test.ts`.

**Interfaces:** Consume `AutoClockOutDecision`. Produce `automaticClockOutTransactions(scope: WorkTransactionScope, decision: AutoClockOutDecision): ClockTransactions`, bound to organization/employee/period/operation and with no start capability. Extend `ClockPrincipal` with `{ kind: "automatic_clock_out"; userId: string; operationId: string; workPeriodId: string }`; `userId` is technical creator provenance, not human authority. Add channel `automatic-clock-out`, writer `automatic_clock_out`, and timezone source `system_target_user_setting`. Extend the completing actor to `{ kind: "human"; userId: string } | { kind: "system"; process: "automatic_clock_out" }`; optional internal closure actor evidence defaults to the current human behavior.

- [ ] **Write failing Clocking integration cases in both admissions.** A system command outside its bound transaction, with a different period/organization/operation, or with clock-in/break body is refused. A legitimate enlisted closure writes the exact cutoff and offset, preserves attribution, runs no browser-session lookup, and succeeds without billing entitlement. Existing human/departure cases must continue passing.

```ts
expect(refusedOutsideScope.failure.code).toBe("access_denied");
expect(receipt.actorKind).toBe("system");
expect(receipt.actorUserId).toBeNull();
expect(receipt.result.actors.completing).toEqual({ kind: "system", process: "automatic_clock_out" });
```

- [ ] **Run red tests.** `pnpm --filter webapp test:integration src/lib/time-tracking/clocking/automatic-clock-out.integration.test.ts`; expect unsupported principal/channel or missing adapter failures, not a skipped suite.
- [ ] **Implement trusted scope binding.** Keep departure enlistment intact; add a discriminated binding for the automatic decision. Clocking rejects all automatic commands unless their binding and named-period target match. The trusted adapter obtains the sealed scope from the coordinator; ordinary network adapters keep constructing human principals. Keep human guard/lifecycle behavior, with only a narrow automatic closure exemption from employee clock-start/access and billing gates. Record system completion in canonical and receipt evidence while using the original clock-in creator for required database creator fields. Audit every `actors.completing.userId` reader and discriminate its kind before access; existing human receipts and replay remain backward compatible. The new writer is recognized by receipt replay, schema constraints, source mapping, inventory, and rollback floor at the Task 1 migration. Derive the target effective zone and offset at the cutoff.
- [ ] **Run green and regression suites.** Run the new suite plus `clocking/clock-out.integration.test.ts`, `clocking/break.integration.test.ts`, and `employee-lifecycle/clock-out.integration.test.ts`; unit checks for layering/writers/readiness also pass. Verify human results remain human and no adapter gains automatic authority.
- [ ] **Commit only Task 2 files:** `feat: add scoped automatic clock-out system authority (#568)`.

### Task 3: Close discovered overdue work atomically and survive competing writes

**Files:** Create domain `discovery.ts`, `commands.ts`, `identity.ts`, `commands.integration.test.ts`, `identity.test.ts`, and `discovery.integration.test.ts`. Use the Task 1 execution/task schemas and existing coordinator, without direct entry writes in discovery/commands.

**Interfaces:** Produce `listDueAutoClockOutCandidates(input: { now: Instant; after: AutoClockOutCandidate | null; limit: number }, database: typeof db): Promise<AutoClockOutCandidate[]>`, ordered lexicographically by organization/employee/period; `deriveAutoClockOutOperationId(decision: Omit<AutoClockOutDecision, "operationId">): string`; and `createAutoClockOutCommands(deps: { database: typeof db; clock: Clock }): { close(candidate: AutoClockOutCandidate): Promise<AutoClockOutOutcome> }`. The identity includes organization, employee, period, start, cutoff, and revision, using canonical serialization and the existing deterministic UUID algorithm pattern from `automatic-break-intent.ts` with a distinct namespace.

- [ ] **Write failing discovery/transaction tests.** Cover absent settings rows, previous-day work, disabled/deleted organizations, deleted/completed periods, cutoff equality, and custom duration. Race two workers, manual clock-out, break/resume, on-behalf closure, departure, enable/disable/change, and employee scope changes in both admissions. Stage failure must roll back all closure writes. A refusal stages no notification. Pin lowering 12h to 8h after ten hours to an eight-hour cutoff. With a completed manual closure after the deadline, the scan must skip rather than rewrite it.

```ts
expect(duplicateOutcomes.filter((x) => x.status === "closed")).toHaveLength(1);
expect(clockOutRows).toHaveLength(1);
expect(resumedPeriod.endTime).toBeNull();
expect(disabledAfterDiscovery.status).toBe("skipped");
expect(afterFailedStaging.isActive).toBe(true);
```

- [ ] **Run red tests.** Run both new integration suites and the identity unit suite; expect missing production exports before implementation.
- [ ] **Implement discovery.** Join on organization ownership, use effective default settings, and paginate candidates without a today-only filter. The query is read-only and its cutoff is a discovery hint; all authoritative decisions are made again in `close`.
- [ ] **Implement coordinated closure.** Route required users/employee and organization shared guard with the existing work transaction. Re-read settings and target under guards, lock rows at the coordinator's row phase, and restart a changed scope. Derive the stable identity only from the confirmed decision. A matching committed execution returns replay; otherwise skip a changed/deleted/nonlive/not-due target. Run Clocking with the Task 2 adapter, preserve attribution, and use durable follow-ups to insert execution plus `follow_up` and `plan_notification` tasks before the outer commit. Throw on unconfirmed staging so the outer transaction rolls back. Record immutable start/end/capture/surcharge/balance facts and automatic reason; do not fabricate a second legacy completed-work receipt. Refused review/integrity work returns deferred with its existing reason; connection failures propagate for per-candidate error reporting. Existing conflicts govern late/offline commands.
- [ ] **Run green tests.** Run all Task 3 suites plus the existing frozen-command and on-behalf integration suites. Verify one committed execution/closure under duplicate workers, no orphan entries, and no effect on resumed work or other organizations.
- [ ] **Commit only Task 3 files:** `feat: close overdue live work transactionally (#568)`.

### Task 4: Recover domain follow-ups and deliver employee notifications

**Files:** Create domain `outbox.ts`, `delivery.ts`, `notifications.ts`, `follow-ups.ts`, `outbox.integration.test.ts`, `delivery.test.ts`, `notifications.test.ts`, and `delivery.integration.test.ts`. Modify `apps/webapp/src/lib/notifications/types.ts`, notification type/category/email mappings reached by that exhaustive union, `components/notifications/notification-settings.tsx`, and `messages/common/{en,de}.json`. Reuse `clock-out-effects.ts` and its owners, with failure propagation for durable callers if currently swallowed; preserve existing best-effort defaults for human callers.

**Interfaces:** Produce `createAutoClockOutTaskOutbox(database: Pick<typeof db, "execute">)` with `claimDue(now: Instant, limit: number): Promise<AutoClockOutTaskClaim[]>`, `complete(claim: AutoClockOutTaskClaim, now: Instant): Promise<void>`, `recordProgress(claim: AutoClockOutTaskClaim, now: Instant, patch: Record<string, unknown>): Promise<void>`, and `defer(claim: AutoClockOutTaskClaim, now: Instant, error: unknown): Promise<"deferred" | "failed">`. Produce `buildAutoClockOutNotification(input: { decision: AutoClockOutDecision; recipientUserId: string; locale: string }): CreateNotificationParams` and `runAutoClockOutDelivery(deps: { database: typeof db; clock: Clock; limit: number }): Promise<AutoClockOutDeliveryResult>`.

- [ ] **Write failing lease/recovery/delivery tests.** Duplicate claims have one owner; expired leases can be reclaimed; old tokens cannot complete newer claims. Crash after closure and before inbox insert, crash after inbox insert before completion, optional transport failure, disabled enforcement after closure, muted inbox preference, unavailable channels, malformed payload, and cross-org operation references have explicit assertions. Domain progress resumes after the failing step without reapplying recorded prior work. Test recipient language and cutoff zone around DST with the worker/viewer in a different zone.

```ts
expect(inboxRows).toHaveLength(1);
expect(inboxRows[0].type).toBe("automatic_clock_out");
expect(sentAfterResume.email).toBe(1);
expect(claimAfterLeaseExpiry.claimToken).not.toBe(originalClaim.claimToken);
```

- [ ] **Run red tests.** Run notification/delivery unit suites and outbox/delivery PostgreSQL suites; expect missing implementations.
- [ ] **Implement leased tasks.** Follow the existing departure outbox's `FOR UPDATE SKIP LOCKED` and claim-token pattern without reusing its departure table. Use a five-minute lease, eight-attempt visible failed state, and bounded exponential retry with maximum one hour. Sanitize error text. Task completion/progress is scoped to organization and the current token. Recovery uses durable execution facts, regardless of current enforcement status. A newer owner supersedes a stale claim; report stale ownership without corrupting its state.
- [ ] **Implement follow-up and channel handlers.** Use existing compliance/break/surcharge/balance/project owners with immutable closure facts and recorded progress per effect. Honor committed automatic-break/balance intents. Validate payloads, retain failures for retry, and skip completed effect steps. The notification planner always schedules inbox and uses existing recipient locale, preferences, and organization transport availability for optional channels. Render a date/time with event timezone context; inbox title is `Automatically clocked out`, with a message explaining duration, cutoff, and automatic reason. Use i18n metadata and a verified calendar/time-tracking link to the affected employee's work. Insert inbox through `insertInAppNotification` with `automatic-clock-out:<operationId>:<recipientUserId>` deduplication. Per-channel tasks mark delivery independently; do not invoke a fan-out function that recreates already delivered channels. External lost acknowledgements retain transport-level duplicate limits described in the spec. In notification settings, explain the mandatory inbox behavior rather than expose a misleading disable control.
- [ ] **Run green suites.** Run Task 4 suites, notification type/service regressions, and clock-out effect regressions. Verify mandatory inbox even when muted, recovery while disabled, and failures not rolling back committed work.
- [ ] **Commit only Task 4 files:** `feat: recover automatic clock-out notifications and follow-ups (#568)`.

### Task 5: Expose settings and honest automatic source in the UI

**Files:** Create `apps/webapp/src/components/organization/organization-auto-clock-out-card.tsx` and its test, plus `apps/webapp/src/app/[locale]/(app)/settings/organizations/auto-clock-out-actions.ts` and its test. Modify organizations `page.tsx`, `components/organization/{organizations-page-client,organization-tab}.tsx`, `lib/calendar/{types,work-period-service}.ts` and service tests, `components/calendar/event-details-panel.tsx` and its tests, and `messages/organization/{en,de}.json` plus the calendar catalog keys used by the details panel.

**Interfaces:** Settings action `updateAutoClockOutSettings(input: { organizationId: string; autoClockOutEnabled: boolean; maxUninterruptedMinutes: number }): Promise<ServerActionResult<AutoClockOutSettings>>`. Card props `{ organizationId: string; settings: AutoClockOutSettings; currentMemberRole: "owner" | "admin" | "member" }`. Calendar metadata adds optional `automaticClockOut: { cutoffAt: string; limitMinutes: number; processedAt: string }`, sourced from scoped execution evidence rather than editable notes.

- [ ] **Write failing action/UI tests.** Approved admin/owner saves; manager/member/departed/unapproved/cross-org callers fail. Twelve hours/on renders for missing settings; turning off retains the saved duration; invalid duration never submits; rapid double-click sends one pending save; server refusal displays existing feedback. Calendar details label automatic execution as system even with a source creator FK, and a later correction retains its own human audit trail without labeling its new endpoint as automatic.

```ts
expect(screen.getByRole("switch", { name: /automatic clock-out/i })).toBeChecked();
expect(screen.getByLabelText(/hours/i)).toHaveValue(12);
expect(screen.getByText(/automatically clocked out/i)).toBeVisible();
expect(memberSave.success).toBe(false);
```

- [ ] **Run red tests.** Run new card/action suites and calendar service/details tests; expect missing controls/action or metadata assertions to fail.
- [ ] **Implement authorized action and TanStack card.** Resolve the active organization and require approved owner/admin through existing authorization helpers before passing normalized input to Task 1 save helper. Load effective settings with the existing organizations page, thread typed props through the client/tab, and place the card among organization configuration cards. Use hours/minutes inputs, retained duration while disabled, save/loading/success/error feedback, help text covering resets/current work/five-minute checks, and the existing accessible UI patterns. Maintain light/dark themes; use static Tolgee keys with fallback copy.
- [ ] **Implement automatic work-record display.** Join execution evidence by organization and linked clock-out identity in the calendar service and expose the new metadata only for a standing automatic endpoint. In details, show `Automatically clocked out`, applicable duration, cutoff, and system source. Avoid treating `createdBy` provenance as a manual actor. Verify the notification link opens the affected work using the real calendar route parameters; do not invent an unsupported deep-link query. Existing clock status polling/invalidation supplies the closed state.
- [ ] **Run green tests and runtime verification.** Run the Task 5 suites; use the next-dev-loop and React/UI quality skills required by the repo when executing. Verify keyboard navigation, pending save, disabled state, localized copy, themes, and automatic record navigation. Runtime checks requiring unavailable secrets are reported, never claimed passed.
- [ ] **Commit only Task 5 files:** `feat: expose organization automatic clock-out settings (#568)`.

### Task 6: Schedule five-minute maintenance and verify the complete path

**Files:** Create `apps/webapp/src/lib/jobs/auto-clock-out.ts`, its unit test and `auto-clock-out.integration.test.ts`, plus domain `scan-state.ts` and `scan-state.integration.test.ts`. Modify `lib/cron/{registry,schedules}.ts` and their tests, `src/worker.test.ts`, and `src/worker.ts` only if its generic cron dispatch does not already handle the new registry job. Update relevant user documentation with the new setting and automatic clock-out semantics.

**Interfaces:** Produce `AutoClockOutScanState` with `claim(now: Instant): Promise<{ token: string; after: AutoClockOutCandidate | null } | null>`, `advance(input: { token: string; after: AutoClockOutCandidate; now: Instant }): Promise<void>` (persists the page cursor and renews its lease), and `release(input: { token: string; after: AutoClockOutCandidate | null; now: Instant }): Promise<void>`, created by `createAutoClockOutScanState(database: Pick<typeof db, "execute">)`. Produce `runAutoClockOutMaintenanceWith(deps: { clock: Clock; scanState: AutoClockOutScanState; listCandidates(input: { now: Instant; after: AutoClockOutCandidate | null; limit: number }): Promise<AutoClockOutCandidate[]>; close(candidate: AutoClockOutCandidate): Promise<AutoClockOutOutcome>; deliverTasks(): Promise<AutoClockOutDeliveryResult> }): Promise<AutoClockOutMaintenanceResult>` and production `runAutoClockOutMaintenance(): Promise<AutoClockOutMaintenanceResult>`. Use a candidate batch of 100; traverse cursor pages, advance past failures, and cap each run at 1,000 candidates. Rotate the durable scan cursor between runs so overdue failures cannot permanently starve later pages. Task recovery claims up to 100 due tasks per maintenance run independently of candidate count.

- [ ] **Write failing scheduler/orchestrator tests.** Verify registry pattern, lazy job import, protected schedule override behavior, duplicate worker dispatch, page exhaustion/cursor progress, one failing employee followed by a successful employee, recovery with zero candidates, and prior-day candidate recovery. Test a population larger than the run cap with an always-failing early period; later employees must still get a turn on the following run. End-to-end PostgreSQL tests run actual maintenance, assert one exact cutoff and one notification, advance clock for retries, and run again with enforcement disabled.

```ts
expect(CRON_JOBS["cron:auto-clock-out"].schedule).toBe("*/5 * * * *");
expect(result).toMatchObject({ attempted: 2, closed: 1, failed: 1 });
expect(result.tasks.completed).toBeGreaterThan(0);
expect(repeatedScan.closed).toBe(0);
```

- [ ] **Run red tests.** Run cron registry/schedules, worker, and new job suites; expect missing registry/orchestrator failures.
- [ ] **Implement maintenance and scheduling.** Compose Tasks 3 and 4, isolate target errors, report counts and scoped errors, and always run task recovery. Use Task 1's scan-state row and a five-minute lease with a random token; claim/update/release uses conditional token checks, and an expired claim can be replaced. Advance the cursor past every attempted candidate and persist progress after each page while renewing the lease. Stop candidate processing on lease loss, while still permitting independently leased task recovery. On end-of-list, reset the cursor to null for the next run rather than repeating the same prefix in this run. If another scan owns the lease, skip discovery and still deliver tasks. This makes restart replay harmless and preserves fairness beyond the run cap. Mark the cron as a protected/high-risk scheduled mutation using the existing schedule override rules; retain the approved five-minute schedule. The generic worker should discover the job from the registry. Manual triggering stays behind existing cron authentication. Log exhausted tasks and refusal reasons in existing observability without leaking payloads.
- [ ] **Run green and final checks.** Run Task 6 tests, the complete feature unit/integration suites, affected Clocking/notification/calendar regressions, and `pnpm --filter webapp typecheck`. Run Biome on changed TypeScript/TSX files through `pnpm --filter webapp exec biome check <changed paths>`. Run the production build with `CI=true` using the shell's environment syntax only when its required environment is available. All database suites use the disposable PostgreSQL harness, never deployment data. Complete the repo-required React/Next/UI quality review and whole-branch code review according to the chosen execution skill; fix material findings before claiming completion.
- [ ] **Update documentation and issue progress.** Document enabled/12h defaults, break reset, five-minute observation delay, immediate settings changes/backdating, notifications, and correction behavior. Record exact checks passed and any environment-blocked checks on #568. Create/attach the PR using the repository workflow when authorized; do not merge merely because this plan is approved.
- [ ] **Commit only Task 6 files:** `feat: schedule five-minute automatic clock-out maintenance (#568)`.

## Plan self-review and execution checkpoint

The six tasks cover settings/permissions, UTC cutoff/break semantics, both admissions and system evidence, atomicity/races/replay, durable domain effects and mandatory inbox delivery, optional channels, UI/source display, scheduler fairness/recovery, and verification. Each Review Focus line has an owning task and explicit assertions. Task interfaces use the shared contract names above.

The user approved this plan and selected Subagent-driven execution. Independent implementation/review gates apply to each task, followed by final whole-branch review. Runtime checks blocked by missing Phase credentials and browser tooling must be reported explicitly. PR publication requires authorization, and this approval does not authorize merging.
