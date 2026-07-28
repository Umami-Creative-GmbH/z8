# Payroll Absence Day Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exact approved absence dates and full-day/AM/PM detail to the combined PDF downloaded from `/payroll`.

**Architecture:** Add a small Temporal-based calendar expansion unit that converts approved payroll absence ranges into primitive day-detail rows. Integrate those rows into the existing organization- and employee-scoped payroll summary, derive category totals from the same details, and render grouped employee sections in the existing React PDF without changing payroll connector data or contracts.

**Tech Stack:** TypeScript, Temporal via `temporal-polyfill`, Drizzle ORM, React, `@react-pdf/renderer`, Vitest, MDX

---

## File Structure

- Create `apps/webapp/src/lib/payroll-workspace/absence-details.ts`: expand logical absence ranges into clipped, sorted day details and aggregate their day values.
- Create `apps/webapp/src/lib/payroll-workspace/absence-details.test.ts`: focused Temporal calendar tests for full-day, partial-day, multi-day, clipping, weekend, ordering, and invalid-range behavior.
- Modify `apps/webapp/src/lib/payroll-workspace/types.ts`: define the wire-safe day-detail shape and use logical date strings for summary absence rows.
- Modify `apps/webapp/src/lib/payroll-workspace/summary.ts`: map canonical absence database boundaries to logical date keys, build details, and derive category totals from those details.
- Modify `apps/webapp/src/lib/payroll-workspace/summary.test.ts`: verify summary integration, totals/detail consistency, and deterministic output.
- Modify `apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx`: add grouped, paginated absence-detail sections and an explicit empty state.
- Modify `apps/webapp/src/lib/payroll-workspace/pdf-exporter.test.tsx`: verify grouping data and PDF generation for populated and empty details.
- Modify `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`: update the typed summary fixture for the new required summary field; no UI behavior changes.
- Modify `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`: document the `/payroll` combined PDF and distinguish it from connector exports.

### Task 1: Expand Logical Absence Ranges

**Files:**
- Create: `apps/webapp/src/lib/payroll-workspace/absence-details.ts`
- Create: `apps/webapp/src/lib/payroll-workspace/absence-details.test.ts`
- Modify: `apps/webapp/src/lib/payroll-workspace/types.ts:28-37,51-75`

- [ ] **Step 1: Add the day-detail and logical-row types**

In `apps/webapp/src/lib/payroll-workspace/types.ts`, replace the timestamp fields on `PayrollSummaryAbsenceRow` and add a day-detail type:

```ts
export interface PayrollSummaryAbsenceRow {
	employeeId: string;
	categoryId: string;
	categoryName: string;
	startDate: string;
	endDate: string;
	startPeriod: PayrollDayPeriod;
	endPeriod: PayrollDayPeriod;
}

export interface PayrollAbsenceDetail {
	employeeId: string;
	categoryId: string;
	categoryName: string;
	date: string;
	period: PayrollDayPeriod;
}
```

Add the required primitive array to `PayrollWorkspaceSummary` after `employees`:

```ts
	employees: PayrollEmployeeSummary[];
	absenceDetails: PayrollAbsenceDetail[];
	blockers: PayrollBlocker[];
```

- [ ] **Step 2: Write failing expansion tests**

Create `apps/webapp/src/lib/payroll-workspace/absence-details.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPayrollAbsenceDetails, payrollAbsenceDetailDays } from "./absence-details";

const june = { start: "2026-06-01", end: "2026-06-30" };

describe("buildPayrollAbsenceDetails", () => {
	it("expands same-day full, AM, and PM absences", () => {
		expect(
			buildPayrollAbsenceDetails(
				[
					{
						employeeId: "employee-1",
						categoryId: "sick",
						categoryName: "Sick",
						startDate: "2026-06-03",
						endDate: "2026-06-03",
						startPeriod: "full_day",
						endPeriod: "full_day",
					},
					{
						employeeId: "employee-1",
						categoryId: "vacation",
						categoryName: "Vacation",
						startDate: "2026-06-04",
						endDate: "2026-06-04",
						startPeriod: "am",
						endPeriod: "am",
					},
					{
						employeeId: "employee-1",
						categoryId: "personal",
						categoryName: "Personal",
						startDate: "2026-06-05",
						endDate: "2026-06-05",
						startPeriod: "pm",
						endPeriod: "pm",
					},
				],
				june,
			),
		).toEqual([
			{
				employeeId: "employee-1",
				categoryId: "sick",
				categoryName: "Sick",
				date: "2026-06-03",
				period: "full_day",
			},
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-04",
				period: "am",
			},
			{
				employeeId: "employee-1",
				categoryId: "personal",
				categoryName: "Personal",
				date: "2026-06-05",
				period: "pm",
			},
		]);
	});

	it("clips a multi-day range and preserves boundary periods", () => {
		expect(
			buildPayrollAbsenceDetails(
				[
					{
						employeeId: "employee-1",
						categoryId: "sick",
						categoryName: "Sick",
						startDate: "2026-05-31",
						endDate: "2026-06-02",
						startPeriod: "pm",
						endPeriod: "am",
					},
				],
				june,
			),
		).toEqual([
			{
				employeeId: "employee-1",
				categoryId: "sick",
				categoryName: "Sick",
				date: "2026-06-01",
				period: "full_day",
			},
			{
				employeeId: "employee-1",
				categoryId: "sick",
				categoryName: "Sick",
				date: "2026-06-02",
				period: "am",
			},
		]);
	});

	it("includes recorded weekend dates and sorts deterministically", () => {
		const details = buildPayrollAbsenceDetails(
			[
				{
					employeeId: "employee-2",
					categoryId: "vacation",
					categoryName: "Vacation",
					startDate: "2026-06-07",
					endDate: "2026-06-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				{
					employeeId: "employee-1",
					categoryId: "sick",
					categoryName: "Sick",
					startDate: "2026-06-06",
					endDate: "2026-06-07",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
			],
			june,
		);

		expect(details.map((detail) => `${detail.employeeId}:${detail.date}:${detail.categoryName}`)).toEqual([
			"employee-1:2026-06-06:Sick",
			"employee-1:2026-06-07:Sick",
			"employee-2:2026-06-07:Vacation",
		]);
	});

	it("drops reversed ranges", () => {
		expect(
			buildPayrollAbsenceDetails(
				[
					{
						employeeId: "employee-1",
						categoryId: "sick",
						categoryName: "Sick",
						startDate: "2026-06-05",
						endDate: "2026-06-04",
						startPeriod: "full_day",
						endPeriod: "full_day",
					},
				],
				june,
			),
		).toEqual([]);
	});
});

describe("payrollAbsenceDetailDays", () => {
	it("values full days as one and AM/PM as half a day", () => {
		expect(payrollAbsenceDetailDays("full_day")).toBe(1);
		expect(payrollAbsenceDetailDays("am")).toBe(0.5);
		expect(payrollAbsenceDetailDays("pm")).toBe(0.5);
	});
});
```

- [ ] **Step 3: Run the new test to verify it fails**

Run: `pnpm --dir apps/webapp test src/lib/payroll-workspace/absence-details.test.ts`

Expected: FAIL because `./absence-details` does not exist.

- [ ] **Step 4: Implement Temporal-based date expansion**

Create `apps/webapp/src/lib/payroll-workspace/absence-details.ts`:

```ts
import { Temporal } from "temporal-polyfill";
import type {
	PayrollAbsenceDetail,
	PayrollDayPeriod,
	PayrollPeriod,
	PayrollSummaryAbsenceRow,
} from "./types";

export function buildPayrollAbsenceDetails(
	rows: PayrollSummaryAbsenceRow[],
	period: Pick<PayrollPeriod, "start" | "end">,
): PayrollAbsenceDetail[] {
	const periodStart = Temporal.PlainDate.from(period.start);
	const periodEnd = Temporal.PlainDate.from(period.end);
	const details: PayrollAbsenceDetail[] = [];

	for (const row of rows) {
		const recordStart = Temporal.PlainDate.from(row.startDate);
		const recordEnd = Temporal.PlainDate.from(row.endDate);
		if (Temporal.PlainDate.compare(recordEnd, recordStart) < 0) continue;

		const firstDate = Temporal.PlainDate.compare(recordStart, periodStart) < 0 ? periodStart : recordStart;
		const lastDate = Temporal.PlainDate.compare(recordEnd, periodEnd) > 0 ? periodEnd : recordEnd;
		if (Temporal.PlainDate.compare(lastDate, firstDate) < 0) continue;

		for (
			let date = firstDate;
			Temporal.PlainDate.compare(date, lastDate) <= 0;
			date = date.add({ days: 1 })
		) {
			details.push({
				employeeId: row.employeeId,
				categoryId: row.categoryId,
				categoryName: row.categoryName,
				date: date.toString(),
				period: absencePeriodForDate(date, recordStart, recordEnd, row.startPeriod, row.endPeriod),
			});
		}
	}

	return details.sort(
		(a, b) =>
			a.employeeId.localeCompare(b.employeeId) ||
			a.date.localeCompare(b.date) ||
			a.categoryName.localeCompare(b.categoryName) ||
			a.categoryId.localeCompare(b.categoryId),
	);
}

export function payrollAbsenceDetailDays(period: PayrollDayPeriod): number {
	return period === "full_day" ? 1 : 0.5;
}

function absencePeriodForDate(
	date: Temporal.PlainDate,
	recordStart: Temporal.PlainDate,
	recordEnd: Temporal.PlainDate,
	startPeriod: PayrollDayPeriod,
	endPeriod: PayrollDayPeriod,
): PayrollDayPeriod {
	if (recordStart.equals(recordEnd)) {
		return startPeriod === endPeriod ? startPeriod : "full_day";
	}
	if (date.equals(recordStart)) return startPeriod;
	if (date.equals(recordEnd)) return endPeriod;
	return "full_day";
}
```

- [ ] **Step 5: Run the focused tests**

Run: `pnpm --dir apps/webapp test src/lib/payroll-workspace/absence-details.test.ts`

Expected: PASS with 5 tests.

- [ ] **Step 6: Commit the expansion unit**

```bash
git add apps/webapp/src/lib/payroll-workspace/types.ts apps/webapp/src/lib/payroll-workspace/absence-details.ts apps/webapp/src/lib/payroll-workspace/absence-details.test.ts
git commit -m "feat(payroll): expand absence ranges by day"
```

### Task 2: Integrate Details Into The Scoped Payroll Summary

**Files:**
- Modify: `apps/webapp/src/lib/payroll-workspace/summary.ts:44-115,338-389,513-584`
- Modify: `apps/webapp/src/lib/payroll-workspace/summary.test.ts:11-196`
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx:35-77`

- [ ] **Step 1: Replace aggregate-only absence fixtures with logical ranges**

In `apps/webapp/src/lib/payroll-workspace/summary.test.ts`, change the two absence rows in `groups absence days by employee and category` to:

```ts
			absenceRows: [
				{
					employeeId: "employee-1",
					categoryId: "vacation",
					categoryName: "Vacation",
					startDate: "2026-06-10",
					endDate: "2026-06-11",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
				{
					employeeId: "employee-1",
					categoryId: "sick",
					categoryName: "Sick",
					startDate: "2026-06-12",
					endDate: "2026-06-12",
					startPeriod: "full_day",
					endPeriod: "full_day",
				},
			],
```

After the existing category-total assertion, add:

```ts
		expect(summary.absenceDetails).toEqual([
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-10",
				period: "full_day",
			},
			{
				employeeId: "employee-1",
				categoryId: "vacation",
				categoryName: "Vacation",
				date: "2026-06-11",
				period: "full_day",
			},
			{
				employeeId: "employee-1",
				categoryId: "sick",
				categoryName: "Sick",
				date: "2026-06-12",
				period: "full_day",
			},
		]);
```

Remove the old `calculatePayrollAbsenceDays` test block and remove that function from the test imports. Task 1 now owns calendar expansion coverage.

- [ ] **Step 2: Run the summary test to verify integration fails**

Run: `pnpm --dir apps/webapp test src/lib/payroll-workspace/summary.test.ts`

Expected: FAIL because `buildPayrollSummaryFromRows` does not return `absenceDetails` and still expects aggregate/timestamp rows.

- [ ] **Step 3: Derive details and category totals from one source**

In `apps/webapp/src/lib/payroll-workspace/summary.ts`, import the new helpers:

```ts
import { buildPayrollAbsenceDetails, payrollAbsenceDetailDays } from "./absence-details";
```

Replace the existing `absenceDaysByEmployee` row loop inside `buildPayrollSummaryFromRows` with:

```ts
	const absenceDetails = buildPayrollAbsenceDetails(input.absenceRows, input.period);
	const absenceDaysByEmployee = new Map<
		string,
		Map<string, { categoryId: string; categoryName: string; days: number }>
	>();
	for (const detail of absenceDetails) {
		const employeeAbsences = absenceDaysByEmployee.get(detail.employeeId) ?? new Map();
		const existing = employeeAbsences.get(detail.categoryId);
		employeeAbsences.set(detail.categoryId, {
			categoryId: detail.categoryId,
			categoryName: detail.categoryName,
			days: (existing?.days ?? 0) + payrollAbsenceDetailDays(detail.period),
		});
		absenceDaysByEmployee.set(detail.employeeId, employeeAbsences);
	}
```

Add `absenceDetails` to the returned summary immediately after `employees`:

```ts
		employees,
		absenceDetails,
		blockers: input.blockers,
```

Delete `calculatePayrollAbsenceDays`, `getAbsenceSlotsForDay`, `firstAbsenceSlot`, `lastAbsenceSlot`, and their now-unused `PayrollDayPeriod` import. Keep work-period overlap helpers unchanged.

- [ ] **Step 4: Map database timestamp boundaries to logical date keys at the boundary**

In `getAbsenceRows`, keep all existing organization, approval-state, period, and `allowedEmployeeIds` constraints. Change only the returned row mapping:

```ts
	return rows.map((row) => ({
		employeeId: row.employeeId,
		categoryId: row.categoryId,
		categoryName: row.categoryName,
		startDate: row.startAt.toISOString().slice(0, 10),
		endDate: (row.endAt ?? row.startAt).toISOString().slice(0, 10),
		startPeriod: row.startPeriod,
		endPeriod: row.endPeriod,
	}));
```

This conversion occurs at the Drizzle `Date` boundary. All calendar iteration remains in Temporal and all summary output remains primitive strings.

- [ ] **Step 5: Update the client-component typed fixture**

In `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`, add the required field between `employees` and `blockers`:

```ts
	absenceDetails: [],
```

In `buildSummary`, preserve overrides for it:

```ts
		absenceDetails: overrides.absenceDetails ?? baseSummary.absenceDetails,
```

- [ ] **Step 6: Run summary and payroll workspace tests**

Run: `pnpm --dir apps/webapp test src/lib/payroll-workspace/absence-details.test.ts src/lib/payroll-workspace/summary.test.ts src/components/payroll/payroll-workspace.test.tsx`

Expected: PASS. The summary test proves detail/totals consistency; existing component tests prove the new wire field does not alter the `/payroll` UI.

- [ ] **Step 7: Run existing authorization action tests**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/payroll/actions.test.ts' 'src/app/[locale]/(app)/payroll/actions.start-export.test.ts'`

Expected: PASS. These tests preserve server-side intersection with the payroll officer's allowed employee IDs. Confirm the changed absence query still contains all four constraints: `timeRecord.organizationId`, approved state, selected-period overlap, and `allowedEmployeeIds`.

- [ ] **Step 8: Commit the summary integration**

```bash
git add apps/webapp/src/lib/payroll-workspace/summary.ts apps/webapp/src/lib/payroll-workspace/summary.test.ts apps/webapp/src/components/payroll/payroll-workspace.test.tsx
git commit -m "feat(payroll): include absence day details in summaries"
```

### Task 3: Render Employee Absence Details In The PDF

**Files:**
- Modify: `apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx:4-175,189-306`
- Modify: `apps/webapp/src/lib/payroll-workspace/pdf-exporter.test.tsx:1-42`

- [ ] **Step 1: Add populated and empty grouping tests**

In `apps/webapp/src/lib/payroll-workspace/pdf-exporter.test.tsx`, import the pure grouping helper:

```ts
import {
	buildPayrollAbsenceSections,
	exportPayrollSummaryToPDF,
	generatePayrollPDFFilename,
} from "./pdf-exporter";
```

Replace the existing `summary` fixture so its totals and details represent the same approved absence dates:

```ts
const summary: PayrollWorkspaceSummary = {
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: "2026-06-30T12:00:00.000Z",
	generatedBy: { id: "payroll-1", name: "Payroll User" },
	totals: { employeeCount: 1, totalWorkedHours: 12.5, blockerCount: 1 },
	employees: [
		{
			id: "employee-1",
			name: "Ada Lovelace",
			employeeNumber: "E-1",
			teamName: "Ops",
			contractType: "hourly",
			workedHours: 12.5,
			absenceDaysByCategory: [
				{ categoryId: "sick", categoryName: "Sick", days: 1 },
				{ categoryId: "vacation", categoryName: "Vacation", days: 0.5 },
			],
			hasBlockers: true,
		},
	],
	absenceDetails: [
		{
			employeeId: "employee-1",
			categoryId: "sick",
			categoryName: "Sick",
			date: "2026-06-03",
			period: "full_day",
		},
		{
			employeeId: "employee-1",
			categoryId: "vacation",
			categoryName: "Vacation",
			date: "2026-06-08",
			period: "am",
		},
	],
	blockers: [
		{
			id: "blocker-1",
			employeeId: "employee-1",
			type: "missing_clock_out",
			label: "Missing clock-out",
		},
	],
};
```

Add these tests before the byte-array smoke test:

```ts
	it("groups absence details by employee in report order", () => {
		expect(buildPayrollAbsenceSections(summary)).toEqual([
			{
				employeeId: "employee-1",
				employeeName: "Ada Lovelace",
				employeeNumber: "E-1",
				rows: [
					{ date: "2026-06-03", categoryName: "Sick", periodLabel: "Full day" },
					{ date: "2026-06-08", categoryName: "Vacation", periodLabel: "AM" },
				],
			},
		]);
	});

	it("returns no employee sections when the report has no approved absences", () => {
		expect(buildPayrollAbsenceSections({ ...summary, absenceDetails: [] })).toEqual([]);
	});
```

- [ ] **Step 2: Run the PDF tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/payroll-workspace/pdf-exporter.test.tsx`

Expected: FAIL because `buildPayrollAbsenceSections` is not exported.

- [ ] **Step 3: Implement deterministic report grouping**

In `apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx`, add:

```ts
export interface PayrollAbsenceSection {
	employeeId: string;
	employeeName: string;
	employeeNumber: string | null;
	rows: Array<{ date: string; categoryName: string; periodLabel: string }>;
}

export function buildPayrollAbsenceSections(
	summary: PayrollWorkspaceSummary,
): PayrollAbsenceSection[] {
	const detailsByEmployee = new Map<string, typeof summary.absenceDetails>();
	for (const detail of summary.absenceDetails) {
		detailsByEmployee.set(detail.employeeId, [
			...(detailsByEmployee.get(detail.employeeId) ?? []),
			detail,
		]);
	}

	return summary.employees.flatMap((employee) => {
		const details = detailsByEmployee.get(employee.id);
		if (!details?.length) return [];

		return [
			{
				employeeId: employee.id,
				employeeName: employee.name,
				employeeNumber: employee.employeeNumber,
				rows: details
					.toSorted(
						(a, b) =>
							a.date.localeCompare(b.date) ||
							a.categoryName.localeCompare(b.categoryName) ||
							a.categoryId.localeCompare(b.categoryId),
					)
					.map((detail) => ({
						date: detail.date,
						categoryName: detail.categoryName,
						periodLabel:
							detail.period === "full_day" ? "Full day" : detail.period.toUpperCase(),
					})),
			},
		];
	});
}
```

The summary already sorts employees by name, so iterating `summary.employees` provides the required employee-name order and omits employees without details.

- [ ] **Step 4: Add compact PDF detail styles**

Add these entries to `styleDefinitions` before `footer`:

```ts
	absenceSection: {
		marginTop: 14,
	},
	absenceEmployee: {
		marginBottom: 9,
		borderWidth: 1,
		borderColor: "#CBD5E1",
	},
	absenceEmployeeHeader: {
		padding: 6,
		backgroundColor: "#EFF6FF",
		fontWeight: "bold" as const,
		color: "#1E3A8A",
	},
	absenceRow: {
		flexDirection: "row" as const,
		borderTopWidth: 1,
		borderTopColor: "#E2E8F0",
	},
	absenceDateCell: {
		width: "24%",
		padding: 5,
	},
	absenceCategoryCell: {
		width: "56%",
		padding: 5,
	},
	absencePeriodCell: {
		width: "20%",
		padding: 5,
	},
	emptyAbsences: {
		padding: 9,
		borderWidth: 1,
		borderColor: "#CBD5E1",
		backgroundColor: "#F8FAFC",
		color: "#64748B",
	},
```

- [ ] **Step 5: Render the grouped details after employee totals**

Inside `exportPayrollSummaryToPDF`, calculate sections after styles are created:

```ts
	const absenceSections = buildPayrollAbsenceSections(summary);
```

Insert this JSX after the employee totals table and before the footer:

```tsx
				<View style={styles.absenceSection}>
					<Text style={styles.sectionTitle}>Absence details</Text>
					{absenceSections.length === 0 ? (
						<Text style={styles.emptyAbsences}>
							No approved absences for the selected period.
						</Text>
					) : (
						absenceSections.map((section) => (
							<View key={section.employeeId} style={styles.absenceEmployee}>
								<Text style={styles.absenceEmployeeHeader}>
									{section.employeeName} ({section.employeeNumber ?? "No employee no."})
								</Text>
								{section.rows.map((row, index) => (
									<View
										key={`${row.date}-${row.categoryName}-${index}`}
										style={styles.absenceRow}
									>
										<Text style={styles.absenceDateCell}>{row.date}</Text>
										<Text style={styles.absenceCategoryCell}>{row.categoryName}</Text>
										<Text style={styles.absencePeriodCell}>{row.periodLabel}</Text>
									</View>
								))}
							</View>
						))
					)}
				</View>
```

The employee container deliberately remains wrappable so long absence lists flow onto later pages instead of being truncated or pushed outside the page.

- [ ] **Step 6: Run the PDF tests**

Run: `pnpm --dir apps/webapp test src/lib/payroll-workspace/pdf-exporter.test.tsx`

Expected: PASS with filename, grouping, empty-state, and PDF byte-array tests.

- [ ] **Step 7: Commit the PDF report change**

```bash
git add apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx apps/webapp/src/lib/payroll-workspace/pdf-exporter.test.tsx
git commit -m "feat(payroll): list absence dates in PDF reports"
```

### Task 4: Document The Payroll Officer Workflow

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx:9-16,146-155`

- [ ] **Step 1: Add the combined PDF workflow to the guide**

In `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`, add this section before `## Running Exports`:

```mdx
## Combined Payroll PDF

Payroll officers and org admins with access to **Payroll** can download one combined PDF for the selected period and employee scope.

The PDF includes:

- worked-hour and approved-absence totals per employee
- payroll blockers that still require review
- every approved absence date, grouped by employee
- the absence category and whether each date is a full day, morning (**AM**), or afternoon (**PM**)

Use these day-level details when approved sickness, vacation, or other absence dates must be entered manually into another legal or payroll system. Multi-day absences list every recorded calendar date, including weekends and holidays contained in the approved record.

The combined PDF is an audit and manual-entry report. It does not alter the configured DATEV, Lexware, Sage, Personio, SAP SuccessFactors, or Workday export formats and payloads described below.
```

Update the overview after the Settings instructions with:

```mdx
Use **Payroll** to review the employee scope and download the combined PDF with exact approved absence dates.
```

- [ ] **Step 2: Check the MDX content for syntax and scope accuracy**

Run: `pnpm --dir apps/docs build`

Expected: PASS, including Fumadocs MDX compilation and the payroll export guide route.

Confirm the text says approved absences, every recorded calendar date, full-day/AM/PM, `/payroll` scope, and PDF-only connector behavior.

- [ ] **Step 3: Commit the guide update**

```bash
git add apps/docs/content/docs/guide/admin-guide/payroll-export.mdx
git commit -m "docs: explain payroll absence day report"
```

### Task 5: Verify The Complete Change

**Files:**
- Verify: `apps/webapp/src/lib/payroll-workspace/absence-details.ts`
- Verify: `apps/webapp/src/lib/payroll-workspace/summary.ts`
- Verify: `apps/webapp/src/lib/payroll-workspace/pdf-exporter.tsx`
- Verify: `apps/docs/content/docs/guide/admin-guide/payroll-export.mdx`

- [ ] **Step 1: Run all focused payroll workspace tests**

Run: `pnpm --dir apps/webapp test src/lib/payroll-workspace/absence-details.test.ts src/lib/payroll-workspace/summary.test.ts src/lib/payroll-workspace/pdf-exporter.test.tsx src/components/payroll/payroll-workspace.test.tsx 'src/app/[locale]/(app)/payroll/actions.test.ts' 'src/app/[locale]/(app)/payroll/actions.start-export.test.ts'`

Expected: PASS with no failed tests.

- [ ] **Step 2: Run the webapp typecheck**

Run: `pnpm --dir apps/webapp typecheck`

Expected: PASS with no TypeScript errors. This catches every `PayrollWorkspaceSummary` fixture that needs the required `absenceDetails` field.

- [ ] **Step 3: Verify connector files are unchanged**

Run: `git diff 25500f57 -- apps/webapp/src/lib/payroll-export`

Expected: no output. The feature must not modify file-based formatters or API connector payloads.

- [ ] **Step 4: Inspect formatting and whitespace**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Review the final diff against the design**

Run: `git diff 25500f57 --stat && git status --short`

Expected: the feature diff contains only the implementation plan, payroll workspace source/tests, and the payroll export guide. Unrelated concurrent work may remain in the worktree but must not be staged, reverted, or modified.

- [ ] **Step 6: Record verification without an empty commit**

If every command passes, retain the three focused implementation commits from Tasks 2-4 plus the expansion-unit commit from Task 1. Do not create an empty verification commit.
