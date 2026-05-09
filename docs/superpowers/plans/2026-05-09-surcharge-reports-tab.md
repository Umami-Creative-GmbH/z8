# Surcharge Reports Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Surcharges settings Reports placeholder with an audit-focused surcharge calculations report.

**Architecture:** Add a focused `SurchargeReports` client component that owns report filters, fetch state, summaries, table rendering, and expandable audit details. Keep authorization and organization scoping inside the existing `getSurchargeCalculationsForPeriod` server action, and wire the new component into the existing `SurchargeManagement` Reports tab.

**Tech Stack:** Next.js 16, React 19, TypeScript, Luxon, Tolgee, Vitest, Testing Library, existing shadcn-style UI primitives.

---

## File Structure

- Create: `apps/webapp/src/components/settings/surcharge-reports.tsx`
  - Responsibility: render filters, fetch surcharge calculations, derive summary totals, render empty/error/loading states, render expandable audit rows.
- Create: `apps/webapp/src/components/settings/surcharge-reports.test.tsx`
  - Responsibility: component tests for totals, empty state, validation, and expanded details.
- Modify: `apps/webapp/src/components/settings/surcharge-management.tsx`
  - Responsibility: import and render `SurchargeReports` in the existing Reports tab instead of the placeholder card.
- Read-only reference: `apps/webapp/src/app/[locale]/(app)/settings/surcharges/actions.ts`
  - Existing `getSurchargeCalculationsForPeriod` must remain the authorization and organization boundary.

## Task 1: Add Surcharge Report Component Tests

**Files:**
- Create: `apps/webapp/src/components/settings/surcharge-reports.test.tsx`
- Read: `apps/webapp/src/lib/surcharges/validation.ts:229-261`

- [ ] **Step 1: Write the failing component tests**

Create `apps/webapp/src/components/settings/surcharge-reports.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SurchargeReports } from "./surcharge-reports";

const getSurchargeCalculationsForPeriodMock = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("@/app/[locale]/(app)/settings/surcharges/actions", () => ({
	getSurchargeCalculationsForPeriod: (...args: unknown[]) =>
		getSurchargeCalculationsForPeriodMock(...args),
}));

const calculation = {
	id: "calc-1",
	employeeId: "employee-1",
	organizationId: "org-1",
	workPeriodId: "wp-1",
	surchargeRuleId: "rule-1",
	surchargeModelId: "model-1",
	calculationDate: new Date("2026-02-10T00:00:00.000Z"),
	baseMinutes: 480,
	qualifyingMinutes: 120,
	surchargeMinutes: 30,
	appliedPercentage: "0.25",
	calculationDetails: {
		workPeriodStartTime: "2026-02-10T20:00:00.000Z",
		workPeriodEndTime: "2026-02-11T04:00:00.000Z",
		rulesApplied: [
			{
				ruleId: "rule-1",
				ruleName: "Night premium",
				ruleType: "time_window",
				percentage: 0.25,
				qualifyingMinutes: 120,
				surchargeMinutes: 30,
			},
		],
		overlapPolicy: "max_wins",
		calculatedAt: "2026-02-11T04:05:00.000Z",
	},
	createdAt: new Date("2026-02-11T04:05:00.000Z"),
	employee: { id: "employee-1", firstName: "Mina", lastName: "Miller" },
};

describe("SurchargeReports", () => {
	it("loads calculations and renders summary totals", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: [calculation],
		});

		render(<SurchargeReports organizationId="org-1" />);

		await waitFor(() => {
			expect(screen.getByText("1 calculation")).toBeInTheDocument();
		});

		expect(screen.getByText("8h 0m")).toBeInTheDocument();
		expect(screen.getByText("2h 0m")).toBeInTheDocument();
		expect(screen.getByText("0h 30m")).toBeInTheDocument();
		expect(screen.getByText("Mina Miller")).toBeInTheDocument();
		expect(screen.getByText("25%")).toBeInTheDocument();
	});

	it("renders an empty state when no calculations match", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({ success: true, data: [] });

		render(<SurchargeReports organizationId="org-1" />);

		await waitFor(() => {
			expect(screen.getByText("No surcharge calculations found")).toBeInTheDocument();
		});
		expect(
			screen.getByText("No surcharge calculations matched the selected filters."),
		).toBeInTheDocument();
	});

	it("expands a calculation row to show audit details", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({
			success: true,
			data: [calculation],
		});

		render(<SurchargeReports organizationId="org-1" />);

		const detailsButton = await screen.findByRole("button", { name: "Show details for Mina Miller" });
		fireEvent.click(detailsButton);

		expect(screen.getByText("Applied rules")).toBeInTheDocument();
		expect(screen.getByText("Night premium")).toBeInTheDocument();
		expect(screen.getByText("time_window")).toBeInTheDocument();
		expect(screen.getByText("Overlap policy: max_wins")).toBeInTheDocument();
	});

	it("validates date ranges before fetching", async () => {
		getSurchargeCalculationsForPeriodMock.mockResolvedValueOnce({ success: true, data: [] });

		render(<SurchargeReports organizationId="org-1" />);

		await screen.findByText("No surcharge calculations found");
		getSurchargeCalculationsForPeriodMock.mockClear();

		const form = screen.getByTestId("surcharge-report-filters");
		fireEvent.change(within(form).getByLabelText("Start date"), {
			target: { value: "2026-03-10" },
		});
		fireEvent.change(within(form).getByLabelText("End date"), {
			target: { value: "2026-03-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

		expect(screen.getByText("Start date must be on or before end date.")).toBeInTheDocument();
		expect(getSurchargeCalculationsForPeriodMock).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --dir apps/webapp test src/components/settings/surcharge-reports.test.tsx
```

Expected: FAIL because `./surcharge-reports` does not exist.

- [ ] **Step 3: Commit the failing tests**

Run:

```bash
git add apps/webapp/src/components/settings/surcharge-reports.test.tsx
git commit -m "test: cover surcharge reports tab"
```

## Task 2: Implement SurchargeReports

**Files:**
- Create: `apps/webapp/src/components/settings/surcharge-reports.tsx`
- Test: `apps/webapp/src/components/settings/surcharge-reports.test.tsx`

- [ ] **Step 1: Add the component implementation**

Create `apps/webapp/src/components/settings/surcharge-reports.tsx`:

```tsx
"use client";

import { IconChevronDown, IconChevronRight, IconFileAnalytics } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";
import { getSurchargeCalculationsForPeriod } from "@/app/[locale]/(app)/settings/surcharges/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { SurchargeCalculationWithDetails } from "@/lib/surcharges/validation";

interface SurchargeReportsProps {
	organizationId: string;
}

type ReportFilters = {
	startDate: string;
	endDate: string;
	employeeId: string;
};

function getDefaultFilters(): ReportFilters {
	const now = DateTime.now();
	return {
		startDate: now.startOf("month").toISODate() ?? "",
		endDate: now.endOf("month").toISODate() ?? "",
		employeeId: "",
	};
}

function formatEmployeeName(calculation: SurchargeCalculationWithDetails) {
	const name = [calculation.employee.firstName, calculation.employee.lastName]
		.filter(Boolean)
		.join(" ")
		.trim();
	return name || calculation.employee.id;
}

function formatMinutes(minutes: number) {
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

function formatPercentage(value: string | number) {
	const percentage = Number(value) * 100;
	return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(2)}%`;
}

function formatDate(value: Date | string) {
	const date = value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value);
	return date.isValid ? date.toFormat("LLL d, yyyy") : "-";
}

function formatDateTime(value: Date | string) {
	const date = value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value);
	return date.isValid ? date.toFormat("LLL d, yyyy HH:mm") : "-";
}

function parseDateBoundary(value: string, boundary: "start" | "end") {
	const parsed = DateTime.fromISO(value, { zone: "utc" });
	if (!parsed.isValid) {
		return null;
	}
	return (boundary === "start" ? parsed.startOf("day") : parsed.endOf("day")).toJSDate();
}

export function SurchargeReports({ organizationId }: SurchargeReportsProps) {
	const { t } = useTranslate();
	const [filters, setFilters] = useState<ReportFilters>(() => getDefaultFilters());
	const [calculations, setCalculations] = useState<SurchargeCalculationWithDetails[]>([]);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [validationError, setValidationError] = useState<string | null>(null);

	const loadCalculations = useCallback(async () => {
		const startDate = parseDateBoundary(filters.startDate, "start");
		const endDate = parseDateBoundary(filters.endDate, "end");

		if (!startDate || !endDate) {
			setValidationError(
				t("settings.surcharges.reports.invalidDates", "Please enter a valid date range."),
			);
			return;
		}

		if (startDate > endDate) {
			setValidationError(
				t(
					"settings.surcharges.reports.invalidDateOrder",
					"Start date must be on or before end date.",
				),
			);
			return;
		}

		setValidationError(null);
		setIsLoading(true);
		setError(null);

		try {
			const employeeId = filters.employeeId.trim() || undefined;
			const result = await getSurchargeCalculationsForPeriod(
				organizationId,
				startDate,
				endDate,
				employeeId,
			);

			if (!result.success) {
				setError(result.error || t("settings.surcharges.reports.loadFailed", "Failed to load calculations"));
				return;
			}

			setCalculations(result.data);
		} catch (loadError) {
			console.error("Failed to load surcharge calculations:", loadError);
			setError(t("common.unexpectedError", "An unexpected error occurred"));
		} finally {
			setIsLoading(false);
		}
	}, [filters, organizationId, t]);

	useEffect(() => {
		void loadCalculations();
	}, [loadCalculations]);

	const totals = calculations.reduce(
		(acc, calculation) => ({
			baseMinutes: acc.baseMinutes + calculation.baseMinutes,
			qualifyingMinutes: acc.qualifyingMinutes + calculation.qualifyingMinutes,
			surchargeMinutes: acc.surchargeMinutes + calculation.surchargeMinutes,
		}),
		{ baseMinutes: 0, qualifyingMinutes: 0, surchargeMinutes: 0 },
	);

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.surcharges.reports", "Surcharge Reports")}</CardTitle>
					<CardDescription>
						{t(
							"settings.surcharges.reports.auditDescription",
							"Review surcharge calculations, totals, and audit details for a selected period.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						data-testid="surcharge-report-filters"
						className="grid gap-4 md:grid-cols-[1fr_1fr_1.4fr_auto]"
						onSubmit={(event) => {
							event.preventDefault();
							void loadCalculations();
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="surcharge-report-start-date">
								{t("settings.surcharges.reports.startDate", "Start date")}
							</Label>
							<Input
								id="surcharge-report-start-date"
								type="date"
								value={filters.startDate}
								onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="surcharge-report-end-date">
								{t("settings.surcharges.reports.endDate", "End date")}
							</Label>
							<Input
								id="surcharge-report-end-date"
								type="date"
								value={filters.endDate}
								onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="surcharge-report-employee-id">
								{t("settings.surcharges.reports.employeeId", "Employee ID")}
							</Label>
							<Input
								id="surcharge-report-employee-id"
								placeholder={t("settings.surcharges.reports.employeePlaceholder", "Optional employee ID")}
								value={filters.employeeId}
								onChange={(event) => setFilters((current) => ({ ...current, employeeId: event.target.value }))}
							/>
						</div>
						<Button type="submit" className="self-end" disabled={isLoading}>
							{t("settings.surcharges.reports.applyFilters", "Apply filters")}
						</Button>
					</form>
					{validationError ? (
						<p className="mt-3 text-destructive text-sm">{validationError}</p>
					) : null}
				</CardContent>
			</Card>

			{error ? (
				<Alert variant="destructive">
					<AlertTitle>{t("settings.surcharges.reports.errorTitle", "Could not load report")}</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="pb-2"><CardDescription>{t("settings.surcharges.reports.totalCalculations", "Calculations")}</CardDescription></CardHeader>
					<CardContent><div className="font-semibold text-2xl">{calculations.length} {calculations.length === 1 ? "calculation" : "calculations"}</div></CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2"><CardDescription>{t("settings.surcharges.reports.baseHours", "Base hours")}</CardDescription></CardHeader>
					<CardContent><div className="font-semibold text-2xl">{formatMinutes(totals.baseMinutes)}</div></CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2"><CardDescription>{t("settings.surcharges.reports.qualifyingHours", "Qualifying hours")}</CardDescription></CardHeader>
					<CardContent><div className="font-semibold text-2xl">{formatMinutes(totals.qualifyingMinutes)}</div></CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2"><CardDescription>{t("settings.surcharges.reports.creditedHours", "Credited hours")}</CardDescription></CardHeader>
					<CardContent><div className="font-semibold text-2xl">{formatMinutes(totals.surchargeMinutes)}</div></CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.surcharges.reports.auditTable", "Audit details")}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="py-8 text-center text-muted-foreground">{t("settings.surcharges.reports.loading", "Loading calculations...")}</div>
					) : calculations.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon"><IconFileAnalytics className="size-5" /></EmptyMedia>
								<EmptyTitle>{t("settings.surcharges.reports.emptyTitle", "No surcharge calculations found")}</EmptyTitle>
								<EmptyDescription>{t("settings.surcharges.reports.emptyDescription", "No surcharge calculations matched the selected filters.")}</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-10" />
									<TableHead>{t("settings.surcharges.reports.date", "Date")}</TableHead>
									<TableHead>{t("settings.surcharges.reports.employee", "Employee")}</TableHead>
									<TableHead>{t("settings.surcharges.reports.base", "Base")}</TableHead>
									<TableHead>{t("settings.surcharges.reports.qualifying", "Qualifying")}</TableHead>
									<TableHead>{t("settings.surcharges.reports.credit", "Credit")}</TableHead>
									<TableHead>{t("settings.surcharges.reports.percentage", "Percentage")}</TableHead>
									<TableHead>{t("settings.surcharges.reports.created", "Created")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{calculations.map((calculation) => {
									const employeeName = formatEmployeeName(calculation);
									const isExpanded = expandedId === calculation.id;
									return (
										<>
											<TableRow key={calculation.id}>
												<TableCell>
													<Button variant="ghost" size="icon" aria-label={`${isExpanded ? "Hide" : "Show"} details for ${employeeName}`} onClick={() => setExpandedId(isExpanded ? null : calculation.id)}>
														{isExpanded ? <IconChevronDown className="size-4" /> : <IconChevronRight className="size-4" />}
													</Button>
												</TableCell>
												<TableCell>{formatDate(calculation.calculationDate)}</TableCell>
												<TableCell>{employeeName}</TableCell>
												<TableCell>{formatMinutes(calculation.baseMinutes)}</TableCell>
												<TableCell>{formatMinutes(calculation.qualifyingMinutes)}</TableCell>
												<TableCell>{formatMinutes(calculation.surchargeMinutes)}</TableCell>
												<TableCell>{formatPercentage(calculation.appliedPercentage)}</TableCell>
												<TableCell>{formatDateTime(calculation.createdAt)}</TableCell>
											</TableRow>
											{isExpanded ? (
												<TableRow key={`${calculation.id}-details`}>
													<TableCell colSpan={8} className="bg-muted/30">
														{calculation.calculationDetails ? (
															<div className="space-y-3 p-3">
																<div className="grid gap-2 text-sm md:grid-cols-3">
																	<div>Work period: {formatDateTime(calculation.calculationDetails.workPeriodStartTime)} - {formatDateTime(calculation.calculationDetails.workPeriodEndTime)}</div>
																	<div>Overlap policy: {calculation.calculationDetails.overlapPolicy}</div>
																	<div>Calculated at: {formatDateTime(calculation.calculationDetails.calculatedAt)}</div>
																</div>
																<div className="font-medium text-sm">{t("settings.surcharges.reports.appliedRules", "Applied rules")}</div>
																<div className="space-y-2">
																	{calculation.calculationDetails.rulesApplied.map((rule) => (
																		<div key={rule.ruleId} className="flex flex-wrap items-center gap-2 text-sm">
																			<span className="font-medium">{rule.ruleName}</span>
																			<Badge variant="outline">{rule.ruleType}</Badge>
																			<span>{formatPercentage(rule.percentage)}</span>
																			<span>{formatMinutes(rule.qualifyingMinutes)} qualifying</span>
																			<span>{formatMinutes(rule.surchargeMinutes)} credit</span>
																		</div>
																	))}
																</div>
															</div>
														) : (
															<div className="p-3 text-muted-foreground text-sm">{t("settings.surcharges.reports.noDetails", "No calculation details were recorded for this row.")}</div>
														)}
													</TableCell>
												</TableRow>
											) : null}
										</>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
```

- [ ] **Step 2: Run the focused test and verify what remains**

Run:

```bash
pnpm --dir apps/webapp test src/components/settings/surcharge-reports.test.tsx
```

Expected: Tests may fail on formatting, fragment keys, or accessible text. Fix only the minimal issues in `surcharge-reports.tsx` or `surcharge-reports.test.tsx` until the command passes.

- [ ] **Step 3: Run Biome on touched files**

Run:

```bash
pnpm --dir apps/webapp exec biome check src/components/settings/surcharge-reports.tsx src/components/settings/surcharge-reports.test.tsx
```

Expected: PASS. If Biome reports formatting issues, run:

```bash
pnpm --dir apps/webapp exec biome check --write src/components/settings/surcharge-reports.tsx src/components/settings/surcharge-reports.test.tsx
```

Then rerun the check command and expect PASS.

- [ ] **Step 4: Commit the component**

Run:

```bash
git add apps/webapp/src/components/settings/surcharge-reports.tsx apps/webapp/src/components/settings/surcharge-reports.test.tsx
git commit -m "feat: add surcharge reports component"
```

## Task 3: Wire Reports Tab To New Component

**Files:**
- Modify: `apps/webapp/src/components/settings/surcharge-management.tsx`
- Test: `apps/webapp/src/components/settings/surcharge-reports.test.tsx`

- [ ] **Step 1: Replace the placeholder tab content**

Modify `apps/webapp/src/components/settings/surcharge-management.tsx`:

```tsx
import { SurchargeReports } from "./surcharge-reports";
```

Replace the existing Reports tab block:

```tsx
<TabsContent value="reports" className="space-y-4">
	<SurchargeReports organizationId={organizationId} />
</TabsContent>
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
pnpm --dir apps/webapp test src/components/settings/surcharge-reports.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run the existing surcharge action behavior tests**

Run:

```bash
pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/surcharges/actions.behavior.test.ts'
```

Expected: PASS. These tests confirm manager-visible scoping still works through the existing action.

- [ ] **Step 4: Run Biome on touched settings files**

Run:

```bash
pnpm --dir apps/webapp exec biome check src/components/settings/surcharge-management.tsx src/components/settings/surcharge-reports.tsx src/components/settings/surcharge-reports.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the tab integration**

Run:

```bash
git add apps/webapp/src/components/settings/surcharge-management.tsx apps/webapp/src/components/settings/surcharge-reports.tsx apps/webapp/src/components/settings/surcharge-reports.test.tsx
git commit -m "feat: finish surcharge reports tab"
```

## Task 4: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/settings/surcharge-reports.tsx`
- Verify: `apps/webapp/src/components/settings/surcharge-management.tsx`
- Verify: `apps/webapp/src/app/[locale]/(app)/settings/surcharges/actions.behavior.test.ts`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp test src/components/settings/surcharge-reports.test.tsx 'src/app/[locale]/(app)/settings/surcharges/actions.behavior.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run full webapp tests if time permits**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If unrelated failures appear, record the failing test names and confirm the focused surcharge report tests still pass.

- [ ] **Step 3: Run production build if environment allows**

Run:

```bash
CI=true pnpm build:webapp
```

Expected: PASS. If the build requires unavailable system-level environment variables, stop the build and report that it was skipped because Phase CLI variables are unavailable to agents.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: no uncommitted changes from this task. If verification commands changed generated files, inspect them and commit only relevant changes.

## Self-Review

Spec coverage:

- Inline report component: Task 2 and Task 3.
- Filters with current-month defaults: Task 2.
- Summary totals: Task 1 and Task 2.
- Audit table and expandable details: Task 1 and Task 2.
- Loading, empty, error, validation states: Task 1 and Task 2.
- Server-side permission boundary: Task 3 verifies existing action tests; no client authorization logic is added.
- No exports, saved views, new route, or schema changes: plan touches only the component, its test, and tab wiring.

Placeholder scan: no TBD/TODO/implement-later placeholders are present.

Type consistency: `SurchargeReports` uses `SurchargeCalculationWithDetails` from `apps/webapp/src/lib/surcharges/validation.ts`, and the test fixture matches that shape.
