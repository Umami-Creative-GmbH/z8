# Compliance Copilot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time schedule compliance warnings (rest-time, max-hours, overtime) and require explicit manager acknowledgment when publishing schedules with warnings, while keeping publish warn-only.

**Architecture:** Add a pure schedule compliance evaluator for deterministic rule logic, wrap it in an Effect service for org-scoped DB queries, then integrate into scheduling server actions and scheduler UI. Publish flow becomes a two-step handshake: evaluate -> acknowledge -> publish, with server-side fingerprint revalidation and audit persistence.

**Tech Stack:** Next.js server actions, Effect, Drizzle ORM/Postgres, React + TanStack Query, Vitest, Luxon, pnpm.

---

Quality gates for this plan: `@vercel-react-best-practices`, `@web-design-guidelines`, `@vercel-composition-patterns`.

## Task 1: Build pure compliance evaluator (TDD first)

**Files:**
- Create: `apps/webapp/src/lib/scheduling/compliance/schedule-compliance-evaluator.ts`
- Create: `apps/webapp/src/lib/scheduling/compliance/__tests__/schedule-compliance-evaluator.test.ts`
- Create: `apps/webapp/src/lib/scheduling/compliance/types.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { evaluateScheduleCompliance } from "@/lib/scheduling/compliance/schedule-compliance-evaluator";

describe("evaluateScheduleCompliance", () => {
  it("flags rest-time, max-hours, and overtime from actual+scheduled data", () => {
    const result = evaluateScheduleCompliance({
      timezone: "Europe/Berlin",
      regulation: {
        minRestPeriodMinutes: 660,
        maxDailyMinutes: 600,
        overtimeDailyThresholdMinutes: 480,
        overtimeWeeklyThresholdMinutes: 2400,
        overtimeMonthlyThresholdMinutes: 10800,
      },
      employees: [
        {
          employeeId: "emp_1",
          actualMinutesByDay: { "2026-02-18": 540 },
          scheduledMinutesByDay: { "2026-02-19": 600 },
          restTransitions: [{ fromEndIso: "2026-02-18T23:00:00+01:00", toStartIso: "2026-02-19T08:00:00+01:00" }],
        },
      ],
    });

    expect(result.summary.totalFindings).toBeGreaterThan(0);
    expect(result.summary.byType.restTime).toBeGreaterThan(0);
    expect(result.summary.byType.maxHours).toBeGreaterThan(0);
    expect(result.summary.byType.overtime).toBeGreaterThan(0);
  });

  it("ignores open shifts with no employeeId", () => {
    const result = evaluateScheduleCompliance({
      timezone: "UTC",
      regulation: {},
      employees: [],
    });

    expect(result.summary.totalFindings).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/scheduling/compliance/__tests__/schedule-compliance-evaluator.test.ts`

Expected: FAIL with module/function not found.

**Step 3: Write minimal implementation**

```ts
export function evaluateScheduleCompliance(input: ScheduleComplianceInput): ScheduleComplianceResult {
  const findings: ComplianceFinding[] = [];

  for (const employee of input.employees) {
    // rest-time check
    // max-hours check (actual + scheduled per day)
    // overtime check (daily/weekly/monthly actual + scheduled)
    findings.push(...collectEmployeeFindings(employee, input.regulation, input.timezone));
  }

  return summarizeFindings(findings);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/scheduling/compliance/__tests__/schedule-compliance-evaluator.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/scheduling/compliance/types.ts apps/webapp/src/lib/scheduling/compliance/schedule-compliance-evaluator.ts apps/webapp/src/lib/scheduling/compliance/__tests__/schedule-compliance-evaluator.test.ts
git commit -m "feat(compliance): add pure schedule compliance evaluator"
```

## Task 2: Add publish acknowledgment persistence schema

**Files:**
- Modify: `apps/webapp/src/db/schema/compliance.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Create: `apps/webapp/drizzle/0006_schedule_publish_compliance_ack.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { schedulePublishComplianceAck } from "@/db/schema/compliance";

describe("schedulePublishComplianceAck schema", () => {
  it("exports table with required org-scoped columns", () => {
    expect(schedulePublishComplianceAck).toBeDefined();
    expect(schedulePublishComplianceAck.organizationId).toBeDefined();
    expect(schedulePublishComplianceAck.evaluationFingerprint).toBeDefined();
  });
});
```

Create test file: `apps/webapp/src/db/schema/__tests__/schedule-publish-compliance-ack.test.ts`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/schedule-publish-compliance-ack.test.ts`

Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```ts
export const schedulePublishComplianceAck = pgTable("schedule_publish_compliance_ack", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  actorEmployeeId: uuid("actor_employee_id").notNull().references(() => employee.id, { onDelete: "cascade" }),
  publishedRangeStart: timestamp("published_range_start").notNull(),
  publishedRangeEnd: timestamp("published_range_end").notNull(),
  warningCountTotal: integer("warning_count_total").notNull(),
  warningCountsByType: text("warning_counts_by_type").notNull(),
  evaluationFingerprint: text("evaluation_fingerprint").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Add Drizzle SQL migration and relation mappings for organization/employee.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/schedule-publish-compliance-ack.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/db/schema/compliance.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/schedule-publish-compliance-ack.test.ts apps/webapp/drizzle/0006_schedule_publish_compliance_ack.sql apps/webapp/drizzle/meta/_journal.json
git commit -m "feat(compliance): persist schedule publish acknowledgments"
```

## Task 3: Implement Effect service for org-scoped schedule compliance

**Files:**
- Create: `apps/webapp/src/lib/effect/services/schedule-compliance.service.ts`
- Create: `apps/webapp/src/lib/effect/services/__tests__/schedule-compliance.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/runtime.ts` (only if new layer wiring is required)

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ScheduleComplianceService } from "@/lib/effect/services/schedule-compliance.service";

describe("ScheduleComplianceService", () => {
  it("returns org-scoped findings and fingerprint", async () => {
    const result = await Effect.runPromise(
      ScheduleComplianceService.pipe(
        Effect.flatMap((svc) =>
          svc.evaluateScheduleWindow({ organizationId: "org_1", startDate: new Date("2026-02-17"), endDate: new Date("2026-02-23"), timezone: "Europe/Berlin" })
        )
      )
    );

    expect(result.fingerprint).toBeTruthy();
    expect(result.organizationId).toBe("org_1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/effect/services/__tests__/schedule-compliance.service.test.ts`

Expected: FAIL with missing service export.

**Step 3: Write minimal implementation**

```ts
export class ScheduleComplianceService extends Context.Tag("ScheduleComplianceService")<...>() {}

export const ScheduleComplianceServiceLive = Layer.effect(
  ScheduleComplianceService,
  Effect.gen(function* (_) {
    const db = yield* _(DatabaseService);
    return ScheduleComplianceService.of({
      evaluateScheduleWindow: (params) => /* org-scoped fetch + evaluateScheduleCompliance */, 
      recordPublishAcknowledgment: (input) => /* insert schedule_publish_compliance_ack */,
    });
  })
);
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/effect/services/__tests__/schedule-compliance.service.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/effect/services/schedule-compliance.service.ts apps/webapp/src/lib/effect/services/__tests__/schedule-compliance.service.test.ts apps/webapp/src/lib/effect/runtime.ts
git commit -m "feat(compliance): add schedule compliance effect service"
```

## Task 4: Add scheduling action handshake (evaluate -> acknowledge -> publish)

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/types.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildPublishDecision } from "@/app/[locale]/(app)/scheduling/actions";

describe("buildPublishDecision", () => {
  it("requires acknowledgment when compliance findings exist", () => {
    const decision = buildPublishDecision({
      count: 12,
      compliance: { summary: { totalFindings: 3 }, fingerprint: "abc" },
      acknowledgment: null,
    });

    expect(decision.requiresAcknowledgment).toBe(true);
    expect(decision.published).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- "src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts"`

Expected: FAIL with missing helper/export.

**Step 3: Write minimal implementation**

```ts
export function buildPublishDecision(input: PublishDecisionInput): PublishDecisionResult {
  if (input.compliance.summary.totalFindings > 0 && !isValidAck(input.acknowledgment, input.compliance.fingerprint)) {
    return { requiresAcknowledgment: true, published: false, summary: input.compliance.summary, fingerprint: input.compliance.fingerprint };
  }
  return { requiresAcknowledgment: false, published: true, count: input.count };
}
```

Then wire `publishShifts` to:
1) run compliance evaluation,
2) return `requiresAcknowledgment` payload on first call,
3) publish + persist acknowledgment on confirmed call.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- "src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts"`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/scheduling/actions.ts apps/webapp/src/app/[locale]/(app)/scheduling/types.ts apps/webapp/src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts
git commit -m "feat(scheduling): add compliance acknowledgment publish handshake"
```

## Task 5: Add scheduler UI warning surfaces and publish confirmation modal

**Files:**
- Modify: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler.tsx`
- Modify: `apps/webapp/src/components/scheduling/scheduler/publish-fab.tsx`
- Create: `apps/webapp/src/components/scheduling/scheduler/schedule-compliance-banner.tsx`
- Create: `apps/webapp/src/components/scheduling/scheduler/publish-compliance-dialog.tsx`
- Modify: `apps/webapp/src/lib/query/keys.ts`

**Step 1: Write the failing test**

Create a pure UI-state helper test first:

```ts
import { describe, expect, it } from "vitest";
import { shouldOpenComplianceDialog } from "@/components/scheduling/scheduler/publish-compliance-dialog";

describe("shouldOpenComplianceDialog", () => {
  it("opens dialog when publish response requires acknowledgment", () => {
    expect(shouldOpenComplianceDialog({ requiresAcknowledgment: true })).toBe(true);
  });
});
```

Test file: `apps/webapp/src/components/scheduling/scheduler/__tests__/publish-compliance-dialog-state.test.ts`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/components/scheduling/scheduler/__tests__/publish-compliance-dialog-state.test.ts`

Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```ts
export function shouldOpenComplianceDialog(response: { requiresAcknowledgment?: boolean }): boolean {
  return response.requiresAcknowledgment === true;
}
```

Then implement UI wiring:
- call live compliance action after shift mutations and range changes,
- render inline compliance banner,
- intercept publish response and open acknowledgment dialog,
- submit second publish call with acknowledgment payload.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/components/scheduling/scheduler/__tests__/publish-compliance-dialog-state.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/scheduling/scheduler/shift-scheduler.tsx apps/webapp/src/components/scheduling/scheduler/publish-fab.tsx apps/webapp/src/components/scheduling/scheduler/schedule-compliance-banner.tsx apps/webapp/src/components/scheduling/scheduler/publish-compliance-dialog.tsx apps/webapp/src/components/scheduling/scheduler/__tests__/publish-compliance-dialog-state.test.ts apps/webapp/src/lib/query/keys.ts
git commit -m "feat(scheduling): surface live compliance warnings and publish confirmation"
```

## Task 6: Final verification and hardening

**Files:**
- Modify: `docs/plans/2026-02-19-compliance-copilot-design.md` (only if implementation deviates from approved design)
- Modify: any touched files from Tasks 1-5 for final polish

**Step 1: Run targeted test suite**

Run:
- `pnpm --filter webapp test -- src/lib/scheduling/compliance/__tests__/schedule-compliance-evaluator.test.ts`
- `pnpm --filter webapp test -- src/lib/effect/services/__tests__/schedule-compliance.service.test.ts`
- `pnpm --filter webapp test -- "src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts"`
- `pnpm --filter webapp test -- src/components/scheduling/scheduler/__tests__/publish-compliance-dialog-state.test.ts`

Expected: all PASS.

**Step 2: Run broader package tests**

Run: `pnpm --filter webapp test`

Expected: PASS for full webapp Vitest suite.

**Step 3: Manual smoke test in app**

Run: `pnpm dev`

Validate manually:
- Edit shifts -> inline compliance warnings update quickly.
- Publish with warnings -> modal requires acknowledgment.
- Confirm publish -> publish succeeds and warnings are auditable.

**Step 4: Commit final polish**

```bash
git add .
git commit -m "test(scheduling): verify compliance copilot end-to-end behavior"
```

## Notes for Executor

- Keep all queries and writes scoped by `organizationId`.
- Do not use environment variables for tenant-specific behavior.
- Do not modify `src/db/auth-schema.ts`.
- Use Luxon for date handling where conversion logic is needed.
- Keep implementation minimal (YAGNI): no background jobs or async snapshot pipeline in v1.
