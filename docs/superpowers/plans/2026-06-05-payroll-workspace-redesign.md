# Payroll Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/payroll` into a balanced workspace with usable month/week period navigation, clearer hierarchy, fewer duplicated details, and preserved payroll filtering/export behavior.

**Architecture:** Keep the implementation local to the existing payroll client component and its tests. Add small local Luxon helper functions for period math, then reorganize the component JSX into a top controls card, operational summary cards, scope filters, blockers, employee totals, and exports controls without changing server action contracts.

**Tech Stack:** Next.js client component, React `useState`/`useTransition`, Luxon `DateTime`, shadcn-style UI components, Tabler icons, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
  - Responsibility: Payroll workspace UI, client-side period navigation, filters, export triggers, and presentational helper functions.
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`
  - Responsibility: Component regression tests for rendering, period navigation, filters, and export actions.

No new files are required. Do not modify `apps/webapp/src/db/auth-schema.ts`, database migrations, payroll server actions, or payroll export format code.

## Task 1: Period Navigation Tests

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Add a mutable summary factory and action response helper**

Replace the current top-level `summary` constant with a typed factory so navigation tests can return different periods. Keep the same employee and blocker data.

Add this type import below the existing imports:

```tsx
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
```

Then replace the current `summary` constant with:

```tsx
const baseSummary: PayrollWorkspaceSummary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: DateTime.fromISO("2026-06-30T12:00:00Z"),
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 2, totalWorkedHours: 8, blockerCount: 2 },
	employees: [
		{
			id: "employee-1",
			name: "Ada Lovelace",
			employeeNumber: "E-1",
			teamName: "Ops",
			contractType: "hourly",
			workedHours: 8,
			absenceDaysByCategory: [],
			hasBlockers: true,
		},
		{
			id: "employee-2",
			name: "Grace Hopper",
			employeeNumber: "E-2",
			teamName: "Engineering",
			contractType: "fixed",
			workedHours: 0,
			absenceDaysByCategory: [],
			hasBlockers: false,
		},
	],
	blockers: [
		{
			id: "blocker-1",
			employeeId: "employee-1",
			type: "missing_clock_out",
			label: "Missing clock-out",
		},
		{
			id: "blocker-2",
			employeeId: "employee-1",
			type: "pending_absence",
			label: "Pending absence approval",
		},
	],
};

function buildSummary(overrides: Partial<PayrollWorkspaceSummary> = {}): PayrollWorkspaceSummary {
	return {
		...baseSummary,
		...overrides,
		period: overrides.period ?? baseSummary.period,
		totals: overrides.totals ?? baseSummary.totals,
		employees: overrides.employees ?? baseSummary.employees,
		blockers: overrides.blockers ?? baseSummary.blockers,
	};
}

const summary = buildSummary();
```

Keep the existing `beforeEach`, but update the mocked result to use `summary` from the factory:

```tsx
beforeEach(() => {
	vi.clearAllMocks();
	actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValue({
		success: true,
		data: summary,
	});
});
```

- [ ] **Step 2: Add previous month test**

Add this test inside `describe("PayrollWorkspace", ...)`:

```tsx
it("moves to the previous month from the selected month", async () => {
	actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
		success: true,
		data: buildSummary({
			period: { start: "2026-05-01", end: "2026-05-31", label: "May 2026" },
		}),
	});

	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

	await waitFor(() => {
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: "2026-05-01",
				endDate: "2026-05-31",
				label: "May 2026",
			}),
		);
	});
});
```

- [ ] **Step 3: Add next month test**

```tsx
it("moves to the next month from the selected month", async () => {
	actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
		success: true,
		data: buildSummary({
			period: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
		}),
	});

	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Next period" }));

	await waitFor(() => {
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: "2026-07-01",
				endDate: "2026-07-31",
				label: "July 2026",
			}),
		);
	});
});
```

- [ ] **Step 4: Add previous and next week tests**

```tsx
it("moves to the previous week from the selected week", async () => {
	actionMocks.getPayrollWorkspaceSummaryAction
		.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				period: { start: "2026-06-01", end: "2026-06-07", label: "Jun 1 - Jun 7, 2026" },
			}),
		})
		.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				period: { start: "2026-05-25", end: "2026-05-31", label: "May 25 - May 31, 2026" },
			}),
		});

	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Week" }));
	await waitFor(() => expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1));

	fireEvent.click(screen.getByRole("button", { name: "Previous period" }));

	await waitFor(() => {
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
			expect.objectContaining({
				startDate: "2026-05-25",
				endDate: "2026-05-31",
				label: "May 25 - May 31, 2026",
			}),
		);
	});
});

it("moves to the next week from the selected week", async () => {
	actionMocks.getPayrollWorkspaceSummaryAction
		.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				period: { start: "2026-06-01", end: "2026-06-07", label: "Jun 1 - Jun 7, 2026" },
			}),
		})
		.mockResolvedValueOnce({
			success: true,
			data: buildSummary({
				period: { start: "2026-06-08", end: "2026-06-14", label: "Jun 8 - Jun 14, 2026" },
			}),
		});

	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Week" }));
	await waitFor(() => expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledTimes(1));

	fireEvent.click(screen.getByRole("button", { name: "Next period" }));

	await waitFor(() => {
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenLastCalledWith(
			expect.objectContaining({
				startDate: "2026-06-08",
				endDate: "2026-06-14",
				label: "Jun 8 - Jun 14, 2026",
			}),
		);
	});
});
```

- [ ] **Step 5: Add current-period navigation test with mocked Luxon time**

```tsx
it("returns to the current month", async () => {
	vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
	actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValueOnce({
		success: true,
		data: buildSummary({
			period: { start: "2026-08-01", end: "2026-08-31", label: "August 2026" },
		}),
	});

	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Current period" }));

	await waitFor(() => {
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: "2026-08-01",
				endDate: "2026-08-31",
				label: "August 2026",
			}),
		);
	});
});
```

Update the `beforeEach` to use fake timers and add `afterEach` cleanup:

```tsx
beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
	vi.clearAllMocks();
	actionMocks.getPayrollWorkspaceSummaryAction.mockResolvedValue({
		success: true,
		data: summary,
	});
});

afterEach(() => {
	vi.useRealTimers();
});
```

Add `afterEach` to the Vitest import:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 6: Run tests and verify they fail for missing controls**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/components/payroll/payroll-workspace.test.tsx
```

Expected: FAIL because `Previous period`, `Next period`, and `Current period` controls do not exist yet.

## Task 2: Implement Period Navigation And Top Controls

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Test: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Update Tabler icon imports**

Add the navigation icons to the existing import list:

```tsx
import {
	IconAlertTriangle,
	IconCalendarWeek,
	IconChevronLeft,
	IconChevronRight,
	IconDownload,
	IconFileExport,
	IconLoader2,
	IconRefresh,
	IconUsers,
} from "@tabler/icons-react";
```

- [ ] **Step 2: Add period navigation handlers**

Add these functions near `applyDateMode`:

```tsx
function navigatePeriod(direction: "previous" | "next") {
	if (dateMode === "custom") return;

	const currentStart = DateTime.fromISO(summary.period.start, { zone: "utc" });
	const amount = direction === "previous" ? -1 : 1;
	const nextStart = currentStart.plus({ [dateMode]: amount }).startOf(dateMode);

	refreshSummary(buildPeriodRequest(nextStart, dateMode));
}

function returnToCurrentPeriod() {
	if (dateMode === "custom") return;

	refreshSummary(buildPeriodRequest(DateTime.utc().startOf(dateMode), dateMode));
}
```

- [ ] **Step 3: Replace `applyDateMode` period construction**

Replace the non-custom section of `applyDateMode` with a call to the shared helper:

```tsx
function applyDateMode(nextMode: PayrollDateRangeMode) {
	setDateMode(nextMode);

	if (nextMode === "custom") return;

	refreshSummary(buildPeriodRequest(DateTime.utc().startOf(nextMode), nextMode));
}
```

- [ ] **Step 4: Add local period helper functions**

Add these helper functions near `basePeriodRequest`:

```tsx
function buildPeriodRequest(start: DateTime, mode: Exclude<PayrollDateRangeMode, "custom">) {
	const normalizedStart = start.startOf(mode);
	const end = normalizedStart.endOf(mode);

	return {
		startDate: normalizedStart.toISODate() ?? "",
		endDate: end.toISODate() ?? "",
		label: formatPeriodLabel(normalizedStart, end, mode),
	};
}
```

- [ ] **Step 5: Replace the current header controls JSX**

Replace lines 203-263 of `payroll-workspace.tsx` with this header and controls card structure:

```tsx
<header className="space-y-1">
	<h1 className="text-3xl font-semibold tracking-tight">Payroll</h1>
	<p className="text-muted-foreground">
		Review payroll totals, readiness, and exports for the selected period.
	</p>
</header>

<Card className="overflow-hidden border-primary/10 shadow-sm">
	<CardHeader className="gap-4 border-b bg-muted/30 lg:flex-row lg:items-start lg:justify-between">
		<div className="space-y-2">
			<CardDescription>Selected period</CardDescription>
			<CardTitle className="text-2xl">{summary.period.label}</CardTitle>
			<p className="text-muted-foreground text-sm">
				{summary.period.start} to {summary.period.end}
			</p>
		</div>
		<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
			<div className="flex items-center gap-1">
				<Button
					type="button"
					variant="outline"
					size="icon"
					aria-label="Previous period"
					disabled={dateMode === "custom" || isPending}
					onClick={() => navigatePeriod("previous")}
				>
					<IconChevronLeft aria-hidden="true" className="size-4" />
				</Button>
				<Button
					type="button"
					variant="outline"
					size="icon"
					aria-label="Next period"
					disabled={dateMode === "custom" || isPending}
					onClick={() => navigatePeriod("next")}
				>
					<IconChevronRight aria-hidden="true" className="size-4" />
				</Button>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={dateMode === "custom" || isPending}
				onClick={returnToCurrentPeriod}
			>
				<IconRefresh aria-hidden="true" className="size-4" />
				Current period
			</Button>
		</div>
	</CardHeader>
	<CardContent className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
		<div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-end">
			<div className="flex gap-1 rounded-lg bg-muted p-1">
				{(["month", "week", "custom"] as const).map((mode) => (
					<Button
						key={mode}
						type="button"
						variant={dateMode === mode ? "default" : "ghost"}
						size="sm"
						disabled={isPending}
						onClick={() => applyDateMode(mode)}
					>
						{toTitleCase(mode)}
					</Button>
				))}
			</div>

			<div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
				<div className="space-y-1">
					<Label htmlFor="payroll-start-date">Start</Label>
					<Input
						id="payroll-start-date"
						name="payroll-start-date"
						autoComplete="off"
						type="date"
						value={startDate}
						disabled={dateMode !== "custom" || isPending}
						onChange={(event) => setStartDate(event.target.value)}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="payroll-end-date">End</Label>
					<Input
						id="payroll-end-date"
						name="payroll-end-date"
						autoComplete="off"
						type="date"
						value={endDate}
						disabled={dateMode !== "custom" || isPending}
						onChange={(event) => setEndDate(event.target.value)}
					/>
				</div>
				<Button
					type="button"
					disabled={dateMode !== "custom" || isPending}
					onClick={applyCustomRange}
				>
					{isPending ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconCalendarWeek aria-hidden="true" className="size-4" />
					)}
					Apply
				</Button>
			</div>
		</div>

		<div className="flex flex-col gap-3 lg:items-end">
			<p className="text-muted-foreground text-sm">
				{summary.totals.employeeCount} employees in scope
			</p>
			{filtersHaveNoMatches ? (
				<p className="text-destructive text-sm">No employees match the selected payroll filters.</p>
			) : null}
			<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
				<div className="flex flex-col gap-2 sm:min-w-56">
					<Label>Payroll export target</Label>
					<Select
						value={formatId}
						onValueChange={setFormatId}
						disabled={!hasExportFormats || isPending}
					>
						<SelectTrigger aria-label="Payroll export target" className="w-full">
							<SelectValue placeholder="Select format" />
						</SelectTrigger>
						<SelectContent>
							{exportFormats.map((format) => (
								<SelectItem key={format.id} value={format.id}>
									{format.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{!hasExportFormats ? (
						<p className="text-muted-foreground text-sm">No configured payroll export target</p>
					) : null}
				</div>

				<Button
					type="button"
					variant="outline"
					disabled={isPending || filtersHaveNoMatches}
					onClick={downloadPdf}
				>
					{isPending ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconDownload aria-hidden="true" className="size-4" />
					)}
					Download PDF
				</Button>

				<Button
					type="button"
					disabled={!hasExportFormats || isPending || filtersHaveNoMatches}
					onClick={triggerExport}
				>
					{isPending ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconFileExport aria-hidden="true" className="size-4" />
					)}
					Trigger export
				</Button>
			</div>
		</div>
	</CardContent>
</Card>
```

- [ ] **Step 6: Remove the old bottom `Exports` card**

Delete the `Card` beginning with `<CardTitle>Exports</CardTitle>` through its closing `</Card>` because export controls now live in the top controls card.

- [ ] **Step 7: Run payroll workspace tests**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/components/payroll/payroll-workspace.test.tsx
```

Expected: PASS for period navigation tests and existing filter tests, except render assertions may still need updates for renamed controls in Task 3.

- [ ] **Step 8: Commit period navigation implementation**

Run:

```bash
git add apps/webapp/src/components/payroll/payroll-workspace.tsx apps/webapp/src/components/payroll/payroll-workspace.test.tsx
git commit -m "feat(payroll): add period navigation controls"
```

## Task 3: Redesign Summary, Scope, Blockers, And Render Tests

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Add the ready employee count**

Add this derived value near the other derived constants:

```tsx
const readyEmployeeCount = summary.employees.filter((employee) => !employee.hasBlockers).length;
```

- [ ] **Step 2: Replace summary cards**

Replace the existing summary card section with:

```tsx
<section className="grid gap-4 md:grid-cols-4">
	<SummaryCard
		icon={<IconUsers aria-hidden="true" className="size-5" />}
		label="Employees"
		value={summary.totals.employeeCount.toString()}
	/>
	<SummaryCard label="Worked hours" value={formatHours(summary.totals.totalWorkedHours)} />
	<SummaryCard label="Ready" value={readyEmployeeCount.toString()} />
	<SummaryCard
		label="Blockers"
		value={summary.totals.blockerCount.toString()}
		tone={summary.totals.blockerCount > 0 ? "warning" : "default"}
	/>
</section>
```

- [ ] **Step 3: Rename and tighten the filters card**

Change the filters card title and description to:

```tsx
<CardTitle>Payroll scope</CardTitle>
<CardDescription>
	Narrow this payroll workspace by assigned employees or teams.
</CardDescription>
```

Update the card content classes from `grid gap-5 md:grid-cols-2` to:

```tsx
<CardContent className="grid gap-6 md:grid-cols-2">
```

- [ ] **Step 4: Tighten blocker panel copy**

Replace the blocker alert title and description wrapper with:

```tsx
<AlertTitle>{summary.blockers.length} payroll blockers need review</AlertTitle>
<AlertDescription>
	<ul className="mt-2 grid gap-1">
		{summary.blockers.map((blocker) => (
			<li key={blocker.id}>{blocker.label}</li>
		))}
	</ul>
</AlertDescription>
```

- [ ] **Step 5: Remove full-row hourly highlighting**

Replace the employee table row opening with a plain table row:

```tsx
<TableRow key={employee.id}>
```

Leave the contract and status badges in place.

- [ ] **Step 6: Update render test expectations**

In `renders summary cards, employee rows, period controls, and blockers`, replace the assertions that expect duplicated period and old exports labels with:

```tsx
expect(screen.getByText("Payroll")).toBeTruthy();
expect(screen.getByText("Review payroll totals, readiness, and exports for the selected period.")).toBeTruthy();
expect(screen.getByRole("heading", { name: "June 2026" })).toBeTruthy();
expect(screen.queryByText("Selected period")).toBeTruthy();
expect(screen.getByRole("button", { name: "Previous period" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Next period" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Current period" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Month" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Week" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Custom" })).toBeTruthy();
expect(screen.getByLabelText("Start")).toBeTruthy();
expect(screen.getByLabelText("End")).toBeTruthy();
expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
expect(screen.getByText("Employees")).toBeTruthy();
expect(screen.getByText("Worked hours")).toBeTruthy();
expect(screen.getByText("8.00 h")).toBeTruthy();
expect(screen.getByText("Ready")).toBeTruthy();
expect(screen.getByText("Blockers")).toBeTruthy();
expect(screen.getByText("Payroll scope")).toBeTruthy();
expect(screen.getByLabelText("Ada Lovelace")).toBeTruthy();
expect(screen.getByLabelText("Grace Hopper")).toBeTruthy();
expect(screen.getByLabelText("Ops")).toBeTruthy();
expect(screen.getByLabelText("Engineering")).toBeTruthy();
expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThanOrEqual(2);
expect(screen.getByText("Missing clock-out")).toBeTruthy();
expect(screen.getByText("Download PDF")).toBeTruthy();
expect(screen.getByText("Trigger export")).toBeTruthy();
```

Then add a specific regression assertion that the old duplicate summary card is gone by checking card labels through text count:

```tsx
expect(screen.getAllByText("Selected period")).toHaveLength(1);
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/components/payroll/payroll-workspace.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Run type/lint-relevant verification for the webapp**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS. If the repository test runner is broader or slower than expected, keep the full output and identify whether failures are related to this payroll change before making further edits.

- [ ] **Step 9: Commit UI redesign**

Run:

```bash
git add apps/webapp/src/components/payroll/payroll-workspace.tsx apps/webapp/src/components/payroll/payroll-workspace.test.tsx
git commit -m "feat(payroll): redesign workspace controls"
```

## Task 4: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Verify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Inspect changed files**

Run:

```bash
git status --short
git diff --stat HEAD~2..HEAD
git diff HEAD~2..HEAD -- apps/webapp/src/components/payroll/payroll-workspace.tsx apps/webapp/src/components/payroll/payroll-workspace.test.tsx
```

Expected: Only the payroll workspace component and test file changed after the design/plan commits. The diff should show no server action, database, or permission changes.

- [ ] **Step 2: Run focused payroll tests once more**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/components/payroll/payroll-workspace.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full webapp tests**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS.

- [ ] **Step 4: Optional production build check**

Run if time allows or if the component/test changes touched imports that may affect build output:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 5: Report completion**

Summarize:

- Period navigation added for month and week.
- Payroll UI reorganized into controls, summaries, scope, blockers, and employee totals.
- Duplicate selected-period summary card removed.
- Focused and full verification results.
