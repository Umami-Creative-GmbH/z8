# React Doctor Errors And Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify all four error-severity React Doctor findings and remove both actionable security findings without changing tenant boundaries or runtime contracts.

**Architecture:** Treat the four error findings as occurrence-level false positives only after verifying their existing lifecycle and purity guarantees. Resolve the two security findings with isolated, test-first changes: protect external payroll-download navigation and replace raw interval SQL with a typed bound parameter.

**Tech Stack:** React 19, Next.js 16, TypeScript, Vitest, Testing Library, Drizzle ORM, React Doctor 0.9.2, pnpm.

---

## File Structure

- Create `apps/webapp/src/components/settings/payroll-export/export-history.test.tsx` for opener-isolation coverage.
- Modify `apps/webapp/src/components/settings/payroll-export/export-history.tsx` only at the external navigation call.
- Modify `apps/webapp/src/lib/platform-analytics/service.test.ts` to verify interval binding and organization-correlated billing audit SQL.
- Modify `apps/webapp/src/lib/platform-analytics/service.ts` to replace `sql.raw` with a closed typed interval map.
- Verify, but do not modify, `apps/webapp/src/components/offline/sw-update-prompt.tsx`, `apps/webapp/src/hooks/use-push-notifications.ts`, `apps/webapp/src/components/ui/virtualized-table.tsx`, and `apps/webapp/src/tolgee/client.tsx` unless their focused tests disprove the classification below.

Implementation files remain unstaged for review, as required by the approved design.

### Task 1: Verify Error-Severity False Positives

**Files:**
- Verify: `apps/webapp/src/components/offline/sw-update-prompt.tsx:31-104`
- Verify: `apps/webapp/src/hooks/use-push-notifications.ts:153-206`
- Verify: `apps/webapp/src/components/ui/virtualized-table.tsx:245-281`
- Verify: `apps/webapp/src/tolgee/client.tsx:58-67`
- Test: `apps/webapp/src/components/offline/sw-update-prompt.test.tsx`
- Test: `apps/webapp/src/hooks/use-push-notifications.test.tsx`
- Test: `apps/webapp/src/components/ui/virtualized-table.test.tsx`
- Test: `apps/webapp/src/tolgee/client.test.tsx`

- [ ] **Step 1: Verify each occurrence against canonical guidance**

Record these occurrence-level conclusions in the execution notes:

```text
effect-needs-cleanup: SWUpdatePrompt already removes updatefound, statechange,
controllerchange, and message listeners with the same handler references.

effect-needs-cleanup: usePushNotifications creates a persistent browser
PushSubscription in a user action, hands it to the browser/server owner, and
rolls it back when server persistence fails. It is not an effect-owned resource.

no-prop-callback-in-render: useRowMemoization invokes getRowId/getRowVersion as
documented pure selector contracts. They do not publish data or cause effects.

effect-needs-cleanup: TolgeeNextProvider returns the exact unsubscribe handle
from tolgee.on("permanentChange", ...).
```

- [ ] **Step 2: Run the focused lifecycle and selector tests**

Run from `apps/webapp`:

```bash
pnpm test -- \
  src/components/offline/sw-update-prompt.test.tsx \
  src/hooks/use-push-notifications.test.tsx \
  src/components/ui/virtualized-table.test.tsx \
  src/tolgee/client.test.tsx
```

Expected: all four files pass. If a test demonstrates leaked cleanup, duplicate callbacks, or an impure selector, stop classifying that occurrence and add a failing regression before changing production code.

- [ ] **Step 3: Confirm no production diff was introduced for classifications**

```bash
git diff -- \
  apps/webapp/src/components/offline/sw-update-prompt.tsx \
  apps/webapp/src/hooks/use-push-notifications.ts \
  apps/webapp/src/components/ui/virtualized-table.tsx \
  apps/webapp/src/tolgee/client.tsx
```

Expected: no output.

### Task 2: Isolate External Payroll Download Navigation

**Files:**
- Create: `apps/webapp/src/components/settings/payroll-export/export-history.test.tsx`
- Modify: `apps/webapp/src/components/settings/payroll-export/export-history.tsx:49-55`

- [ ] **Step 1: Write the failing opener-isolation test**

Create `apps/webapp/src/components/settings/payroll-export/export-history.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportHistory } from "./export-history";

const { getExportDownloadUrlActionMock } = vi.hoisted(() => ({
	getExportDownloadUrlActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/payroll-export/actions", () => ({
	getExportDownloadUrlAction: getExportDownloadUrlActionMock,
}));

describe("ExportHistory", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		getExportDownloadUrlActionMock.mockResolvedValue({
			success: true,
			data: "https://storage.example.test/signed-export",
		});
	});

	it("opens an organization-scoped download without opener or referrer access", async () => {
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

		render(
			<ExportHistory
				organizationId="org-1"
				exports={[
					{
						id: "job-1",
						status: "completed",
						fileName: "payroll.csv",
						fileSizeBytes: 128,
						workPeriodCount: 1,
						employeeCount: 1,
						createdAt: new Date("2026-07-01T12:00:00.000Z"),
						completedAt: new Date("2026-07-01T12:01:00.000Z"),
						errorMessage: null,
						filters: {
							dateRange: { start: "2026-07-01", end: "2026-07-31" },
						},
					},
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Download export" }));

		await waitFor(() => {
			expect(getExportDownloadUrlActionMock).toHaveBeenCalledWith("org-1", "job-1");
			expect(openSpy).toHaveBeenCalledWith(
				"https://storage.example.test/signed-export",
				"_blank",
				"noopener,noreferrer",
			);
		});
	});
});
```

- [ ] **Step 2: Run the test and verify the intended failure**

```bash
pnpm test -- src/components/settings/payroll-export/export-history.test.tsx
```

Expected: FAIL because `window.open` currently receives only the URL and `_blank`.

- [ ] **Step 3: Add opener and referrer isolation**

In `export-history.tsx`, replace the successful navigation call with:

```tsx
window.open(result.data, "_blank", "noopener,noreferrer");
```

Do not change the `organizationId` passed to `getExportDownloadUrlAction`.

- [ ] **Step 4: Run the focused test and typecheck**

```bash
pnpm test -- src/components/settings/payroll-export/export-history.test.tsx
pnpm typecheck
```

Expected: the test passes and typecheck exits successfully.

### Task 3: Bind Platform Analytics Intervals

**Files:**
- Modify: `apps/webapp/src/lib/platform-analytics/service.test.ts:1-217`
- Modify: `apps/webapp/src/lib/platform-analytics/service.ts:31-32,184-237`

- [ ] **Step 1: Write the failing SQL-binding regression**

Add these imports to `service.test.ts`:

```ts
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
```

Add this test inside `describe("getPlatformAnalyticsData", ...)`:

```ts
it("binds bucket intervals while preserving organization-correlated billing audits", async () => {
	queueSelectResult([]);
	queueSelectResult([]);
	queueSelectResult([]);
	queueSelectResult([]);
	queueSelectResult([]);
	queueCurrentTotal([{ value: 2 }]);
	queueCurrentTotal([{ value: 0 }]);
	queueCurrentTotal([{ seats: 9, mrr: 32 }]);
	executeMock.mockResolvedValueOnce([]);

	await getPlatformAnalyticsData({ range: "30d", bucket: "week" }, true);

	const statement = executeMock.mock.calls[0]?.[0] as SQL;
	const compiled = new PgDialect().sqlToQuery(statement);

	expect(compiled.params.filter((value) => value === "7 days")).toHaveLength(3);
	expect(compiled.sql).not.toContain("'7 days'::interval");
	expect(compiled.sql).toContain(
		'"billing_seat_audit"."organization_id" = "subscription"."organization_id"',
	);
});
```

- [ ] **Step 2: Run the regression and verify the intended failure**

```bash
pnpm test -- src/lib/platform-analytics/service.test.ts
```

Expected: FAIL because the current `sql.raw("'7 days'::interval")` emits no bound `"7 days"` parameters.

- [ ] **Step 3: Replace raw interval SQL with a typed closed map**

Add this constant after `BILLING_SUBSCRIPTION_STATUSES` in `service.ts`:

```ts
const INTERVAL_BY_BUCKET = {
	day: "1 day",
	week: "7 days",
	month: "1 month",
} as const satisfies Record<PlatformAnalyticsBucket, string>;
```

Replace `getIntervalSql` with:

```ts
function getIntervalSql(bucket: PlatformAnalyticsBucket): SQL {
	return sql`${INTERVAL_BY_BUCKET[bucket]}::interval`;
}
```

Do not alter the UTC range boundaries or the correlation between `billingSeatAudit.organizationId` and `subscription.organizationId`.

- [ ] **Step 4: Run the platform analytics test and typecheck**

```bash
pnpm test -- src/lib/platform-analytics/service.test.ts
pnpm typecheck
```

Expected: all platform analytics tests pass and typecheck exits successfully.

### Task 4: Validate The Error And Security Wave

**Files:**
- Verify: all files listed in Tasks 1-3

- [ ] **Step 1: Format only changed implementation and test files**

```bash
pnpm exec biome check --write \
  src/components/settings/payroll-export/export-history.tsx \
  src/components/settings/payroll-export/export-history.test.tsx \
  src/lib/platform-analytics/service.ts \
  src/lib/platform-analytics/service.test.ts
```

Expected: Biome completes successfully without touching unrelated files.

- [ ] **Step 2: Run focused tests together**

```bash
pnpm test -- \
  src/components/offline/sw-update-prompt.test.tsx \
  src/hooks/use-push-notifications.test.tsx \
  src/components/ui/virtualized-table.test.tsx \
  src/tolgee/client.test.tsx \
  src/components/settings/payroll-export/export-history.test.tsx \
  src/lib/platform-analytics/service.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 3: Run typecheck and diff validation**

```bash
pnpm typecheck
git diff --check
```

Expected: both commands exit successfully.

- [ ] **Step 4: Run the pinned full React Doctor scan**

```bash
pnpm dlx react-doctor@0.9.2 --json --yes > /tmp/diagnostics-errors-security-after.json
```

Expected: `window-open-without-noopener` and `raw-sql-injection-risk` are absent. The four raw error diagnostics may remain, but all four have the verified occurrence-level false-positive justifications from Task 1.

- [ ] **Step 5: Confirm implementation changes remain unstaged**

```bash
git status --short
```

Expected: only the Task 2-3 implementation and test files are modified or untracked; none are staged. Continue with the bug-warning wave plan before requesting final integration.
