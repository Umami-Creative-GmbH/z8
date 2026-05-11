# Overtime Burn-Down Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new read-only analytics page that shows weekly overtime burn-down by team, cost center, and manager, with strict organization and role scoping.

**Architecture:** Extend the existing analytics pipeline (`analytics/actions.ts` + `analytics.service.ts`) and add a new analytics subpage. Introduce first-class cost center schema plus employee assignment windows, then compute weekly rollups server-side and render them with existing chart/table/export UI patterns.

**Tech Stack:** Next.js 16 App Router, TypeScript, Effect, Drizzle ORM (PostgreSQL), Luxon, Vitest, Recharts, pnpm.

---

### Task 1: Add pure overtime burn-down math helpers

**Files:**
- Create: `apps/webapp/src/lib/analytics/overtime-burndown.ts`
- Test: `apps/webapp/src/lib/analytics/__tests__/overtime-burndown.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { clampOvertime, weekStartIso, weekOverWeekDelta } from "../overtime-burndown";

describe("overtime burn-down helpers", () => {
  test("clampOvertime caps negative values at zero", () => {
    expect(clampOvertime(-2.5)).toBe(0);
    expect(clampOvertime(3)).toBe(3);
  });

  test("weekStartIso returns Monday bucket", () => {
    expect(weekStartIso(new Date("2026-02-19T10:00:00Z"))).toBe("2026-02-16");
  });

  test("weekOverWeekDelta compares current to previous", () => {
    expect(weekOverWeekDelta([40, 32])).toBe(-8);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/analytics/__tests__/overtime-burndown.test.ts`
Expected: FAIL with module/function not found.

**Step 3: Write minimal implementation**

```ts
import { DateTime } from "luxon";

export const clampOvertime = (hours: number) => Math.max(0, hours);

export const weekStartIso = (value: Date) =>
  DateTime.fromJSDate(value).startOf("week").toISODate();

export const weekOverWeekDelta = (values: number[]) => {
  if (values.length < 2) return 0;
  return values[values.length - 1] - values[values.length - 2];
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/analytics/__tests__/overtime-burndown.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/analytics/overtime-burndown.ts apps/webapp/src/lib/analytics/__tests__/overtime-burndown.test.ts
git commit -m "test(analytics): add overtime burn-down helper coverage"
```

### Task 2: Add cost center schema and employee assignment windows

**Files:**
- Create: `apps/webapp/src/db/schema/cost-center.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Optional docs update: `docs/database-schema.md`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { costCenter, employeeCostCenterAssignment } from "@/db/schema";

describe("cost center schema", () => {
  test("exports cost center tables", () => {
    expect(costCenter).toBeDefined();
    expect(employeeCostCenterAssignment).toBeDefined();
  });
});
```

Create test file: `apps/webapp/src/db/schema/__tests__/cost-center-schema.test.ts`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/cost-center-schema.test.ts`
Expected: FAIL because tables are not exported yet.

**Step 3: Write minimal implementation**

Add new schema with:
- `costCenter` (`organizationId`, `name`, optional `code`, `isActive`, timestamps)
- `employeeCostCenterAssignment` (`employeeId`, `costCenterId`, `effectiveFrom`, `effectiveTo`, timestamps)
- non-overlap enforcement strategy documented (validation + DB constraints/index strategy)

Export from schema barrel and wire relations for:
- employee -> assignments
- cost center -> assignments

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/db/schema/__tests__/cost-center-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/db/schema/cost-center.ts apps/webapp/src/db/schema/index.ts apps/webapp/src/db/schema/relations.ts apps/webapp/src/db/schema/__tests__/cost-center-schema.test.ts docs/database-schema.md
git commit -m "feat(schema): add cost center and employee assignment tables"
```

### Task 3: Add overtime burn-down analytics types

**Files:**
- Modify: `apps/webapp/src/lib/analytics/types.ts`

**Step 1: Write the failing test**

```ts
import type { OvertimeBurnDownData } from "@/lib/analytics/types";

const _example: OvertimeBurnDownData = {
  summary: { currentOvertimeHours: 0, wowDeltaHours: 0, improvingGroups: 0, trendDirection: "flat" },
  weeklySeries: [],
  byTeam: [],
  byCostCenter: [],
  byManager: [],
};
```

Create test file: `apps/webapp/src/lib/analytics/__tests__/types.overtime-burndown.test.ts`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/analytics/__tests__/types.overtime-burndown.test.ts`
Expected: FAIL because the type does not exist.

**Step 3: Write minimal implementation**

Add:
- `OvertimeBurnDownData`
- `OvertimeBurnDownParams`
- filter type for `teamId`, `costCenterId`, `managerId`
- shared row type for grouped trend slices

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/analytics/__tests__/types.overtime-burndown.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/analytics/types.ts apps/webapp/src/lib/analytics/__tests__/types.overtime-burndown.test.ts
git commit -m "feat(analytics): define overtime burn-down payload types"
```

### Task 4: Implement analytics service overtime burn-down query and aggregation

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/analytics.service.ts`
- Test: `apps/webapp/src/lib/effect/services/__tests__/analytics-overtime-burndown.service.test.ts`
- Reuse helper: `apps/webapp/src/lib/analytics/overtime-burndown.ts`

**Step 1: Write the failing test**

Create tests that assert:
- weekly aggregation is grouped by Monday bucket
- negative overtime is clipped to 0
- manager scope only includes managed employees
- outputs include `byTeam`, `byCostCenter`, `byManager`

```ts
test("clips negative overtime at zero", async () => {
  const data = await runService(...);
  expect(data.weeklySeries.every((p) => p.overtimeHours >= 0)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/effect/services/__tests__/analytics-overtime-burndown.service.test.ts`
Expected: FAIL because method is missing.

**Step 3: Write minimal implementation**

Add `getOvertimeBurnDown(params)` to `AnalyticsService` and `Live` layer implementation.

Implementation requirements:
- role/employee scope input respected
- week buckets with Luxon
- overtime math: `max(0, actual - expected)`
- rollups by team/cost center/manager
- summary metrics (`currentOvertimeHours`, `wowDeltaHours`, `improvingGroups`, `trendDirection`)

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/lib/effect/services/__tests__/analytics-overtime-burndown.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/lib/effect/services/analytics.service.ts apps/webapp/src/lib/effect/services/__tests__/analytics-overtime-burndown.service.test.ts apps/webapp/src/lib/analytics/overtime-burndown.ts
git commit -m "feat(analytics): add overtime burn-down service aggregation"
```

### Task 5: Add server action for overtime burn-down data

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/analytics/__tests__/actions.overtime-burndown.test.ts`

**Step 1: Write the failing test**

Test that action:
- derives org from session employee
- calls analytics service with scoped params
- rejects unauthorized roles

```ts
test("denies non-manager/admin access", async () => {
  const result = await getOvertimeBurnDownData(range, {});
  expect(result.success).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/__tests__/actions.overtime-burndown.test.ts`
Expected: FAIL because action does not exist.

**Step 3: Write minimal implementation**

Add:

```ts
export async function getOvertimeBurnDownData(dateRange, filters) {
  // checkManagerOrAdminAccess + organizationId from employee
  // call analyticsService.getOvertimeBurnDown
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/__tests__/actions.overtime-burndown.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/analytics/actions.ts apps/webapp/src/app/[locale]/(app)/analytics/__tests__/actions.overtime-burndown.test.ts
git commit -m "feat(analytics): expose overtime burn-down server action"
```

### Task 6: Add analytics navigation entry for the new page

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/layout.tsx`

**Step 1: Write the failing test**

Create test: `apps/webapp/src/app/[locale]/(app)/analytics/__tests__/layout.tabs.test.tsx`

```tsx
test("shows overtime burn-down tab", async () => {
  render(await AnalyticsLayout({ children: <div /> }));
  expect(screen.getByText("Overtime Burn-Down")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/__tests__/layout.tabs.test.tsx`
Expected: FAIL because tab is missing.

**Step 3: Write minimal implementation**

Add a new `TabsTrigger` that links to `/analytics/overtime-burn-down`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/__tests__/layout.tabs.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/analytics/layout.tsx apps/webapp/src/app/[locale]/(app)/analytics/__tests__/layout.tabs.test.tsx
git commit -m "feat(analytics-ui): add overtime burn-down navigation tab"
```

### Task 7: Build overtime burn-down page shell (filters, cards, chart, table)

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx`
- Optional create: `apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/columns.tsx`

**Step 1: Write the failing test**

Create test: `apps/webapp/src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx`

```tsx
test("renders burn-down page sections", () => {
  render(<OvertimeBurnDownPage />);
  expect(screen.getByText("Overtime Burn-Down")).toBeInTheDocument();
  expect(screen.getByText("Current Overtime")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx`
Expected: FAIL because page file does not exist.

**Step 3: Write minimal implementation**

Implement client page using existing analytics patterns:
- `DateRangePicker`
- KPI cards
- `ChartContainer` for weekly trend
- breakdown table
- loading + empty + error states

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx apps/webapp/src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx
git commit -m "feat(analytics-ui): add overtime burn-down page shell"
```

### Task 8: Wire page to server action and filter state

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx`
- Optional modify: `apps/webapp/src/lib/query/keys.ts`

**Step 1: Write the failing test**

Add/update page test to verify action invocation when date range/filter changes.

```tsx
test("reloads data when date range changes", async () => {
  // mock getOvertimeBurnDownData and assert call count > 1 after change
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx`
Expected: FAIL because data wiring is incomplete.

**Step 3: Write minimal implementation**

Wire:
- initial load in `useEffect`
- reload on date/filter change
- toasts on error
- state update for cards, chart, and table

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx apps/webapp/src/lib/query/keys.ts apps/webapp/src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx
git commit -m "feat(analytics-ui): wire overtime burn-down data loading and filters"
```

### Task 9: Add export wiring for overtime burn-down rows

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx`

**Step 1: Write the failing test**

```tsx
test("builds export payload from current grouped rows", () => {
  // assert ExportButton receives expected headers + rows
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx`
Expected: FAIL because export payload is not yet correct.

**Step 3: Write minimal implementation**

Add export mapping for current grouping dimension (`team`/`costCenter`/`manager`) and weekly metrics.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/analytics/overtime-burn-down/page.tsx apps/webapp/src/app/[locale]/(app)/analytics/overtime-burndown.page.test.tsx
git commit -m "feat(analytics-ui): add overtime burn-down export mapping"
```

### Task 10: Final validation and quality checks

**Files:**
- Verify all modified files from tasks 1-9

**Step 1: Run focused test suites**

Run:
- `pnpm --filter webapp test -- src/lib/analytics/__tests__/overtime-burndown.test.ts`
- `pnpm --filter webapp test -- src/lib/effect/services/__tests__/analytics-overtime-burndown.service.test.ts`
- `pnpm --filter webapp test -- src/app/[locale]/(app)/analytics/__tests__/actions.overtime-burndown.test.ts`

Expected: PASS.

**Step 2: Run full webapp tests**

Run: `pnpm --filter webapp test`
Expected: PASS.

**Step 3: Run app build**

Run: `pnpm --filter webapp build`
Expected: PASS.

**Step 4: Validate design/quality skills manually**

Check implementation against:
- `@vercel-react-best-practices`
- `@web-design-guidelines`
- `@vercel-composition-patterns`

Expected: No major violations.

**Step 5: Final commit**

```bash
git add apps/webapp/src docs/database-schema.md
git commit -m "feat(analytics): ship overtime burn-down dashboard"
```

## Notes for the Implementer

- Keep all analytics reads organization-scoped.
- Managers must not see employees outside `employee_managers` scope.
- Use Luxon for all week boundary logic.
- Preserve existing analytics UX conventions (loading, empty, export, tabs).
- Do not add YAGNI features (targets, alerts, snapshots) in V1.
