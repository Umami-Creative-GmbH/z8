# Canonical Time Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace split time/absence/approval/overtime domain models with one normalized canonical time model and route all connector mappings through it.

**Architecture:** Introduce canonical relational tables centered on `time_record`, then migrate service logic, actions, and UI contracts to canonical resources in a single big-bang cutover. Keep strict organization scoping at every layer, and enforce deterministic transition rules through canonical validation and approval-decision events.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, Effect, Luxon, TanStack Query, TanStack Form, Vitest.

---

**Execution skills required during implementation:** @test-driven-development, @systematic-debugging, @security-review, @vercel-react-best-practices, @vercel-composition-patterns, @web-design-guidelines.

### Task 1: Add Canonical Schema (Base + Extensions)

**Files:**
- Create: `apps/webapp/src/db/schema/time-record.ts`
- Modify: `apps/webapp/src/db/schema/enums.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Test: `apps/webapp/src/db/schema/__tests__/time-record-schema.test.ts`

**Step 1: Write the failing schema test**

```ts
import { describe, expect, test } from "vitest";
import {
  timeRecord,
  timeRecordWork,
  timeRecordAbsence,
  timeRecordBreak,
  timeRecordAllocation,
  timeRecordApprovalDecision,
  overtimeLedger,
  overtimeLedgerEntry,
} from "../time-record";

describe("time-record schema", () => {
  test("exports canonical tables", () => {
    expect(timeRecord).toBeDefined();
    expect(timeRecordWork).toBeDefined();
    expect(timeRecordAbsence).toBeDefined();
    expect(timeRecordBreak).toBeDefined();
    expect(timeRecordAllocation).toBeDefined();
    expect(timeRecordApprovalDecision).toBeDefined();
    expect(overtimeLedger).toBeDefined();
    expect(overtimeLedgerEntry).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/time-record-schema.test.ts`
Expected: FAIL with module-not-found for `time-record.ts`.

**Step 3: Implement minimal canonical schema**

```ts
export const timeRecord = pgTable("time_record", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
  recordKind: timeRecordKindEnum("record_kind").notNull(),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at"),
  durationMinutes: integer("duration_minutes"),
  approvalState: timeRecordApprovalStateEnum("approval_state").default("draft").notNull(),
  origin: text("origin").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").$onUpdate(() => currentTimestamp()).notNull(),
});
```

**Step 4: Run schema test to verify it passes**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/time-record-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/db/schema/time-record.ts apps/webapp/src/db/schema/enums.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/time-record-schema.test.ts
git commit -m "feat(schema): add canonical time record tables"
```

### Task 2: Add Canonical Domain Types and Validation

**Files:**
- Create: `apps/webapp/src/lib/time-record/types.ts`
- Create: `apps/webapp/src/lib/time-record/validation.ts`
- Test: `apps/webapp/src/lib/time-record/__tests__/validation.test.ts`

**Step 1: Write failing validation tests**

```ts
import { describe, expect, it } from "vitest";
import { validateTimeRecordCreate } from "../validation";

describe("validateTimeRecordCreate", () => {
  it("rejects negative durations", () => {
    expect(() => validateTimeRecordCreate({ durationMinutes: -5 } as never)).toThrow();
  });

  it("rejects break records with missing endAt", () => {
    expect(() => validateTimeRecordCreate({ recordKind: "break", endAt: null } as never)).toThrow();
  });
});
```

**Step 2: Run tests to confirm failure**

Run: `pnpm --filter webapp test -- src/lib/time-record/__tests__/validation.test.ts`
Expected: FAIL (`validateTimeRecordCreate` not defined).

**Step 3: Implement minimal validator**

```ts
export function validateTimeRecordCreate(input: TimeRecordCreateInput): void {
  if ((input.durationMinutes ?? 0) < 0) throw new Error("duration_minutes_negative");
  if (input.recordKind === "break" && !input.endAt) throw new Error("break_end_required");
  if (input.endAt && input.startAt > input.endAt) throw new Error("invalid_time_window");
}
```

**Step 4: Run tests and verify pass**

Run: `pnpm --filter webapp test -- src/lib/time-record/__tests__/validation.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/time-record/types.ts apps/webapp/src/lib/time-record/validation.ts apps/webapp/src/lib/time-record/__tests__/validation.test.ts
git commit -m "feat(time-record): add canonical input validation"
```

### Task 3: Add Time Record Service (Read/Write + Org Scope)

**Files:**
- Create: `apps/webapp/src/lib/effect/services/time-record.service.ts`
- Create: `apps/webapp/src/lib/effect/services/__tests__/time-record.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/database.service.ts`

**Step 1: Write failing service tests**

```ts
it("creates org-scoped time record", async () => {
  const result = await service.create({ organizationId: "org_1", employeeId: "emp_1", recordKind: "work" } as never);
  expect(result.organizationId).toBe("org_1");
});

it("denies cross-org query access", async () => {
  await expect(service.listByOrganization("org_2", { employeeId: "emp_org_1" })).rejects.toThrow();
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter webapp test -- src/lib/effect/services/__tests__/time-record.service.test.ts`
Expected: FAIL (service missing).

**Step 3: Implement minimal service methods**

```ts
export class TimeRecordService extends Effect.Service<TimeRecordService>()("TimeRecordService", {
  effect: Effect.gen(function* () {
    return {
      create: (input: TimeRecordCreateInput) => db.insert(timeRecord).values(input).returning().then((rows) => rows[0]),
      listByOrganization: (organizationId: string, filters: TimeRecordFilters) =>
        db.query.timeRecord.findMany({ where: and(eq(timeRecord.organizationId, organizationId)) }),
    };
  }),
}) {}
```

**Step 4: Run service tests and verify pass**

Run: `pnpm --filter webapp test -- src/lib/effect/services/__tests__/time-record.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/effect/services/time-record.service.ts apps/webapp/src/lib/effect/services/__tests__/time-record.service.test.ts apps/webapp/src/lib/effect/services/database.service.ts
git commit -m "feat(time-record): add org-scoped effect service"
```

### Task 4: Implement Canonical Approval Decision Flow

**Files:**
- Create: `apps/webapp/src/lib/time-record/approval.ts`
- Test: `apps/webapp/src/lib/time-record/__tests__/approval.test.ts`
- Modify: `apps/webapp/src/lib/audit-logger.ts`

**Step 1: Write failing approval transition tests**

```ts
it("allows draft -> pending -> approved", () => {
  expect(nextApprovalState("draft", "submit")).toBe("pending");
  expect(nextApprovalState("pending", "approve")).toBe("approved");
});

it("rejects terminal transition from approved", () => {
  expect(() => nextApprovalState("approved", "reject")).toThrow();
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/time-record/__tests__/approval.test.ts`
Expected: FAIL (`nextApprovalState` not found).

**Step 3: Implement transition guard + immutable decision helper**

```ts
export function nextApprovalState(current: ApprovalState, action: ApprovalAction): ApprovalState {
  if (current === "draft" && action === "submit") return "pending";
  if (current === "pending" && action === "approve") return "approved";
  if (current === "pending" && action === "reject") return "rejected";
  throw new Error("invalid_transition");
}
```

**Step 4: Run tests and verify pass**

Run: `pnpm --filter webapp test -- src/lib/time-record/__tests__/approval.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/time-record/approval.ts apps/webapp/src/lib/time-record/__tests__/approval.test.ts apps/webapp/src/lib/audit-logger.ts
git commit -m "feat(time-record): add approval transition model"
```

### Task 5: Add Canonical Actions and Contract Types

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/time-records/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/time-records/types.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-records/actions.test.ts`
- Modify: `apps/webapp/src/lib/query/keys.ts`

**Step 1: Write failing action tests**

```ts
it("creates canonical work record", async () => {
  const result = await createTimeRecord({ recordKind: "work" } as never);
  expect(result.success).toBe(true);
});

it("returns organization-scoped records", async () => {
  const result = await listTimeRecords({});
  expect(result.success).toBe(true);
  expect(Array.isArray(result.data)).toBe(true);
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/time-records/actions.test.ts`
Expected: FAIL (module missing).

**Step 3: Implement minimal canonical actions**

```ts
export async function createTimeRecord(input: CreateTimeRecordInput): Promise<ServerActionResult<{ id: string }>> {
  return runServerActionSafe(
    Effect.gen(function* () {
      const authService = yield* AuthService;
      const session = yield* authService.getSession();
      const svc = yield* TimeRecordService;
      const created = yield* Effect.promise(() => svc.create({ ...input, organizationId: session.user.organizationId } as never));
      return { id: created.id };
    }).pipe(Effect.provide(AppLayer)),
  );
}
```

**Step 4: Run action tests and verify pass**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/time-records/actions.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/time-records/actions.ts apps/webapp/src/app/[locale]/(app)/time-records/types.ts apps/webapp/src/app/[locale]/(app)/time-records/actions.test.ts apps/webapp/src/lib/query/keys.ts
git commit -m "feat(time-record): add canonical server actions and query keys"
```

### Task 6: Migrate Time Tracking and Absence Actions to Canonical Backend

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.canonical.test.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/absences/actions.canonical.test.ts`

**Step 1: Write failing migration tests**

```ts
it("time-tracking writes canonical work records", async () => {
  const result = await clockIn({} as never);
  expect(result.success).toBe(true);
  expect(result.data?.recordKind).toBe("work");
});

it("absence requests write canonical absence records", async () => {
  const result = await requestAbsenceEffect({} as never);
  expect(result.success).toBe(true);
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/time-tracking/actions.canonical.test.ts src/app/[locale]/(app)/absences/actions.canonical.test.ts`
Expected: FAIL due legacy-table assumptions.

**Step 3: Replace legacy inserts/updates with canonical service calls**

```ts
// in time-tracking/actions.ts
const created = await timeRecordService.create({
  organizationId: emp.organizationId,
  employeeId: emp.id,
  recordKind: "work",
  startAt: now,
  origin: "manual",
});

// in absences/actions.ts
await timeRecordService.create({
  organizationId: currentEmployee.organizationId,
  employeeId: currentEmployee.id,
  recordKind: "absence",
  startAt,
  endAt,
  origin: "manual",
});
```

**Step 4: Run canonical action tests and existing targeted suites**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/time-tracking/actions.canonical.test.ts src/app/[locale]/(app)/absences/actions.canonical.test.ts src/lib/time-tracking/__tests__/blockchain.test.ts`
Expected: PASS for canonical tests; legacy-only assertions updated or removed intentionally.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts apps/webapp/src/app/[locale]/(app)/absences/actions.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions.canonical.test.ts apps/webapp/src/app/[locale]/(app)/absences/actions.canonical.test.ts
git commit -m "refactor(actions): route time-tracking and absences through canonical model"
```

### Task 7: Add Overtime Ledger Calculation and Tests

**Files:**
- Create: `apps/webapp/src/lib/time-record/overtime.ts`
- Test: `apps/webapp/src/lib/time-record/__tests__/overtime.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/analytics.service.ts`

**Step 1: Write failing overtime tests**

```ts
it("computes overtime delta as max(0, actual - expected)", () => {
  expect(computeOvertimeDelta({ actualMinutes: 540, expectedMinutes: 480 })).toBe(60);
  expect(computeOvertimeDelta({ actualMinutes: 420, expectedMinutes: 480 })).toBe(0);
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/time-record/__tests__/overtime.test.ts`
Expected: FAIL (`computeOvertimeDelta` missing).

**Step 3: Implement minimal overtime helpers + service integration**

```ts
export function computeOvertimeDelta(input: { actualMinutes: number; expectedMinutes: number }): number {
  return Math.max(0, input.actualMinutes - input.expectedMinutes);
}
```

**Step 4: Run tests and analytics regression suite**

Run: `pnpm --filter webapp test -- src/lib/time-record/__tests__/overtime.test.ts src/lib/effect/services/__tests__/analytics-overtime-burndown.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/time-record/overtime.ts apps/webapp/src/lib/time-record/__tests__/overtime.test.ts apps/webapp/src/lib/effect/services/analytics.service.ts
git commit -m "feat(overtime): canonical overtime ledger math and analytics integration"
```

### Task 8: Migrate Payroll Export Data Fetching to Canonical Model

**Files:**
- Modify: `apps/webapp/src/lib/payroll-export/data-fetcher.ts`
- Modify: `apps/webapp/src/lib/payroll-export/types.ts`
- Test: `apps/webapp/src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`

**Step 1: Write failing canonical fetcher tests**

```ts
it("fetches work export rows from canonical time records", async () => {
  const rows = await fetchWorkPeriodsForExport("org_1", filters);
  expect(rows.length).toBeGreaterThanOrEqual(0);
});

it("fetches absence export rows from canonical time records", async () => {
  const rows = await fetchAbsencesForExport("org_1", filters);
  expect(rows.length).toBeGreaterThanOrEqual(0);
});
```

**Step 2: Run tests and confirm failure**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`
Expected: FAIL due legacy table query assumptions.

**Step 3: Update fetcher to query canonical tables only**

```ts
const records = await db.query.timeRecord.findMany({
  where: and(eq(timeRecord.organizationId, organizationId), eq(timeRecord.recordKind, "work")),
  with: { work: true, allocations: true, employee: true },
});
```

**Step 4: Run payroll-export tests**

Run: `pnpm --filter webapp test -- src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts src/lib/payroll-export/connectors/registry.test.ts src/lib/payroll-export/connectors/personio-connector.test.ts src/lib/payroll-export/connectors/successfactors-connector.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/payroll-export/data-fetcher.ts apps/webapp/src/lib/payroll-export/types.ts apps/webapp/src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts
git commit -m "refactor(payroll-export): source connector data from canonical time model"
```

### Task 9: Big-Bang Backfill, Reconciliation, and Legacy Removal

**Files:**
- Create: `apps/webapp/src/lib/time-record/migration/backfill.ts`
- Create: `apps/webapp/src/lib/time-record/migration/reconciliation.ts`
- Test: `apps/webapp/src/lib/time-record/migration/__tests__/reconciliation.test.ts`
- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
- Modify: `apps/webapp/src/db/schema/absence.ts`
- Modify: `apps/webapp/src/db/schema/approval.ts`

**Step 1: Write failing reconciliation tests**

```ts
it("keeps record counts and durations in parity", async () => {
  const result = await reconcileLegacyToCanonical("org_1");
  expect(result.workCountMismatch).toBe(0);
  expect(result.absenceCountMismatch).toBe(0);
  expect(result.durationMismatchMinutes).toBe(0);
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/lib/time-record/migration/__tests__/reconciliation.test.ts`
Expected: FAIL (`reconcileLegacyToCanonical` missing).

**Step 3: Implement backfill + reconciliation and remove legacy runtime dependencies**

```ts
export async function runCanonicalBackfill(organizationId: string) {
  // read legacy rows, map to canonical shape, insert idempotently
}

export async function reconcileLegacyToCanonical(organizationId: string) {
  // compare counts, status parity, duration parity, allocation parity
  return { workCountMismatch: 0, absenceCountMismatch: 0, durationMismatchMinutes: 0 };
}
```

**Step 4: Run reconciliation + focused regressions**

Run: `pnpm --filter webapp test -- src/lib/time-record/migration/__tests__/reconciliation.test.ts src/app/[locale]/(app)/time-records/actions.test.ts src/lib/effect/services/__tests__/analytics-overtime-burndown.service.test.ts`
Expected: PASS with zero mismatches in fixture datasets.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/time-record/migration/backfill.ts apps/webapp/src/lib/time-record/migration/reconciliation.ts apps/webapp/src/lib/time-record/migration/__tests__/reconciliation.test.ts apps/webapp/src/db/schema/time-tracking.ts apps/webapp/src/db/schema/absence.ts apps/webapp/src/db/schema/approval.ts
git commit -m "refactor(cutover): backfill canonical model and remove legacy runtime dependency"
```

### Task 10: Full Verification and Quality Gates

**Files:**
- Modify: `docs/plans/2026-03-05-canonical-time-model-implementation-plan.md`

**Step 1: Add final verification checklist to this plan**

```md
- [ ] Canonical actions pass
- [ ] Payroll connectors pass with canonical fetcher
- [ ] Reconciliation reports zero critical mismatches
- [ ] Legacy runtime read paths removed
- [ ] UI contract smoke tests pass
```

**Step 2: Run required test commands**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/time-record-schema.test.ts src/lib/time-record/__tests__/validation.test.ts src/lib/time-record/__tests__/approval.test.ts src/lib/time-record/__tests__/overtime.test.ts src/lib/time-record/migration/__tests__/reconciliation.test.ts src/app/[locale]/(app)/time-records/actions.test.ts src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`
Expected: PASS.

**Step 3: Run app-level confidence checks**

Run: `pnpm --filter webapp test`
Expected: PASS.

**Step 4: Apply quality review skills before final PR**

Run review passes with: `@vercel-react-best-practices`, `@vercel-composition-patterns`, and `@web-design-guidelines` on changed UI/component files.
Expected: no unresolved high-severity findings.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-05-canonical-time-model-implementation-plan.md
git commit -m "docs(plan): finalize canonical time model verification checklist"
```
