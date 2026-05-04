# Smart Absence Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an advisory Smart Absence Planner preview inside the existing absence request dialog.

**Architecture:** Implement planner derivation in a pure library module, expose it through an organization-scoped server action, and render the returned preview in a focused client panel. Keep submission validation unchanged and make planner failures non-blocking.

**Tech Stack:** Next.js server actions, React 19, TanStack Query, TanStack Form, Drizzle, Luxon, Vitest, Testing Library, pnpm.

---

## File Structure

- Create `apps/webapp/src/lib/absences/absence-plan-preview.ts`: pure types and derivation helpers for approval signal, overlap detection, and coverage risk.
- Create `apps/webapp/src/lib/absences/absence-plan-preview.test.ts`: unit tests for derivation logic without database setup.
- Create `apps/webapp/src/app/[locale]/(app)/absences/plan-preview.ts`: server-side query/action that resolves the current employee and gathers organization-scoped planner data.
- Modify `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`: export `getAbsencePlanPreview` through the existing absence action facade.
- Modify `apps/webapp/src/lib/query/keys.ts`: add a query key for absence plan previews.
- Create `apps/webapp/src/components/absences/absence-plan-preview-panel.tsx`: presentational panel for balance, holidays, coverage, approval, loading, and error states.
- Create `apps/webapp/src/components/absences/absence-plan-preview-panel.test.tsx`: component tests for status and non-blocking error rendering.
- Modify `apps/webapp/src/components/absences/request-absence-dialog.tsx`: call preview query when required fields are present and render the panel.
- Modify `apps/webapp/src/components/absences/request-absence-dialog.test.tsx`: verify hidden-until-ready behavior and advisory warnings do not block submit.

---

### Task 1: Planner Types And Pure Rules

**Files:**
- Create: `apps/webapp/src/lib/absences/absence-plan-preview.ts`
- Create: `apps/webapp/src/lib/absences/absence-plan-preview.test.ts`

- [ ] **Step 1: Write the failing planner unit tests**

Create `apps/webapp/src/lib/absences/absence-plan-preview.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
	buildAbsencePlanPreview,
	type AbsencePlanPreviewInput,
	type CoverageEvaluationInput,
} from "./absence-plan-preview";

const baseInput: AbsencePlanPreviewInput = {
	category: {
		id: "cat-vacation",
		name: "Vacation",
		requiresApproval: true,
		countsAgainstVacation: true,
	},
	request: {
		categoryId: "cat-vacation",
		startDate: "2026-05-04",
		startPeriod: "full_day",
		endDate: "2026-05-05",
		endPeriod: "full_day",
	},
	vacationBalance: {
		year: 2026,
		totalDays: 20,
		usedDays: 4,
		pendingDays: 2,
		remainingDays: 14,
	},
	holidays: [],
	existingAbsences: [],
	affectedShifts: [],
	coverage: { risks: [], hasConfiguredRulesForAffectedShifts: true },
	hasManager: true,
};

describe("buildAbsencePlanPreview", () => {
	it("calculates balance impact for vacation-counting categories", () => {
		const preview = buildAbsencePlanPreview(baseInput);

		expect(preview.requestedDays).toBe(2);
		expect(preview.balance?.remainingAfterRequest).toBe(12);
		expect(preview.approvalSignal).toBe("likely");
		expect(preview.reasons).toContain("Request follows the normal approval path.");
	});

	it("does not reduce balance for non-vacation categories", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			category: {
				...baseInput.category,
				countsAgainstVacation: false,
			},
		});

		expect(preview.balance?.remainingAfterRequest).toBe(14);
		expect(preview.reasons).toContain("This absence type does not reduce vacation balance.");
	});

	it("marks insufficient balance as risky", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			vacationBalance: {
				...baseInput.vacationBalance!,
				remainingDays: 1,
			},
		});

		expect(preview.approvalSignal).toBe("risky");
		expect(preview.warnings).toContain("Vacation balance would be negative after this request.");
	});

	it("includes holidays inside the request range", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			holidays: [
				{
					id: "holiday-1",
					name: "Liberation Day",
					startDate: new Date("2026-05-05T00:00:00.000Z"),
					endDate: new Date("2026-05-05T00:00:00.000Z"),
					categoryId: "public",
				},
			],
		});

		expect(preview.holidays).toEqual([
			{
				id: "holiday-1",
				name: "Liberation Day",
				startDate: "2026-05-05",
				endDate: "2026-05-05",
			},
		]);
		expect(preview.requestedDays).toBe(1);
	});

	it("marks pending or approved absence overlaps as risky", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			existingAbsences: [
				{
					id: "absence-1",
					startDate: "2026-05-05",
					endDate: "2026-05-06",
					status: "pending",
					categoryName: "Vacation",
				},
			],
		});

		expect(preview.approvalSignal).toBe("risky");
		expect(preview.overlaps).toHaveLength(1);
		expect(preview.warnings).toContain("Request overlaps an existing pending absence.");
	});

	it("marks missing balance as needs_review", () => {
		const preview = buildAbsencePlanPreview({
			...baseInput,
			vacationBalance: null,
		});

		expect(preview.approvalSignal).toBe("needs_review");
		expect(preview.reasons).toContain("Vacation balance is unavailable for this year.");
	});

	it("marks coverage risks as risky", () => {
		const coverage: CoverageEvaluationInput = {
			risks: [
				{
					date: "2026-05-04",
					subareaId: "subarea-1",
					subareaName: "Front Desk",
					startTime: "09:00",
					endTime: "17:00",
					minimumStaffCount: 2,
					staffCountAfterAbsence: 1,
				},
			],
			hasConfiguredRulesForAffectedShifts: true,
		};

		const preview = buildAbsencePlanPreview({ ...baseInput, coverage });

		expect(preview.approvalSignal).toBe("risky");
		expect(preview.coverage.risks[0]?.subareaName).toBe("Front Desk");
		expect(preview.warnings).toContain("Published coverage would drop below the configured minimum.");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter webapp test -- src/lib/absences/absence-plan-preview.test.ts
```

Expected: FAIL because `apps/webapp/src/lib/absences/absence-plan-preview.ts` does not exist.

- [ ] **Step 3: Implement the pure planner module**

Create `apps/webapp/src/lib/absences/absence-plan-preview.ts` with:

```ts
import { DateTime } from "luxon";
import { calculateBusinessDaysWithHalfDays, dateRangesOverlap } from "./date-utils";
import type { AbsenceRequest, DayPeriod, Holiday, VacationBalance } from "./types";

export type ApprovalSignal = "likely" | "needs_review" | "risky";

export interface AbsencePlanPreviewRequest extends Pick<AbsenceRequest, "categoryId" | "startDate" | "startPeriod" | "endDate" | "endPeriod"> {}

export interface PlannerCategory {
	id: string;
	name: string;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
}

export interface ExistingAbsenceForPreview {
	id: string;
	startDate: string;
	endDate: string;
	status: "pending" | "approved" | "rejected";
	categoryName: string;
}

export interface AffectedShiftPreview {
	id: string;
	date: string;
	startTime: string;
	endTime: string;
	subareaId: string;
	subareaName: string;
}

export interface CoverageRiskPreview {
	date: string;
	subareaId: string;
	subareaName: string;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
	staffCountAfterAbsence: number;
}

export interface CoverageEvaluationInput {
	risks: CoverageRiskPreview[];
	hasConfiguredRulesForAffectedShifts: boolean;
}

export interface AbsencePlanPreviewInput {
	category: PlannerCategory;
	request: AbsencePlanPreviewRequest;
	vacationBalance: VacationBalance | null;
	holidays: Holiday[];
	existingAbsences: ExistingAbsenceForPreview[];
	affectedShifts: AffectedShiftPreview[];
	coverage: CoverageEvaluationInput;
	hasManager: boolean;
}

export interface AbsencePlanHolidayPreview {
	id: string;
	name: string;
	startDate: string;
	endDate: string;
}

export interface AbsencePlanBalancePreview {
	remainingBeforeRequest: number;
	remainingAfterRequest: number;
	countsAgainstVacation: boolean;
}

export interface AbsencePlanPreview {
	requestedDays: number;
	balance: AbsencePlanBalancePreview | null;
	holidays: AbsencePlanHolidayPreview[];
	overlaps: ExistingAbsenceForPreview[];
	affectedShifts: AffectedShiftPreview[];
	coverage: CoverageEvaluationInput;
	approvalSignal: ApprovalSignal;
	reasons: string[];
	warnings: string[];
}

export function buildAbsencePlanPreview(input: AbsencePlanPreviewInput): AbsencePlanPreview {
	const requestedDays = calculateBusinessDaysWithHalfDays(
		input.request.startDate,
		input.request.startPeriod,
		input.request.endDate,
		input.request.endPeriod,
		input.holidays,
	);
	const holidays = input.holidays.map((holiday) => ({
		id: holiday.id,
		name: holiday.name,
		startDate: toDateKey(holiday.startDate),
		endDate: toDateKey(holiday.endDate),
	}));
	const overlaps = input.existingAbsences.filter(
		(absence) =>
			absence.status !== "rejected" &&
			dateRangesOverlap(
				input.request.startDate,
				input.request.endDate,
				absence.startDate,
				absence.endDate,
			),
	);
	const balance = input.vacationBalance
		? {
				remainingBeforeRequest: input.vacationBalance.remainingDays,
				remainingAfterRequest: input.category.countsAgainstVacation
					? input.vacationBalance.remainingDays - requestedDays
					: input.vacationBalance.remainingDays,
				countsAgainstVacation: input.category.countsAgainstVacation,
			}
		: null;
	const reasons: string[] = [];
	const warnings: string[] = [];

	if (!input.category.countsAgainstVacation) {
		reasons.push("This absence type does not reduce vacation balance.");
	}
	if (!balance) {
		reasons.push("Vacation balance is unavailable for this year.");
	} else if (balance.remainingAfterRequest < 0) {
		warnings.push("Vacation balance would be negative after this request.");
	}
	if (!input.hasManager && input.category.requiresApproval) {
		reasons.push("No manager is assigned; current behavior auto-approves this request.");
	}
	if (input.coverage.risks.length > 0) {
		warnings.push("Published coverage would drop below the configured minimum.");
	} else if (input.affectedShifts.length > 0 && !input.coverage.hasConfiguredRulesForAffectedShifts) {
		reasons.push("No coverage rules are configured for affected scheduled work.");
	}
	for (const overlap of overlaps) {
		warnings.push(`Request overlaps an existing ${overlap.status} absence.`);
	}
	if (reasons.length === 0 && warnings.length === 0) {
		reasons.push(
			input.category.requiresApproval
				? "Request follows the normal approval path."
				: "This absence type does not require approval.",
		);
	}

	return {
		requestedDays,
		balance,
		holidays,
		overlaps,
		affectedShifts: input.affectedShifts,
		coverage: input.coverage,
		approvalSignal: getApprovalSignal({ balance, overlaps, coverage: input.coverage }),
		reasons,
		warnings,
	};
}

function getApprovalSignal(input: {
	balance: AbsencePlanBalancePreview | null;
	overlaps: ExistingAbsenceForPreview[];
	coverage: CoverageEvaluationInput;
}): ApprovalSignal {
	if (
		(input.balance && input.balance.remainingAfterRequest < 0) ||
		input.overlaps.length > 0 ||
		input.coverage.risks.length > 0
	) {
		return "risky";
	}
	if (!input.balance) {
		return "needs_review";
	}
	return "likely";
}

function toDateKey(date: Date): string {
	return DateTime.fromJSDate(date, { zone: "utc" }).toISODate() ?? "";
}
```

- [ ] **Step 4: Run the planner tests**

Run:

```bash
pnpm --filter webapp test -- src/lib/absences/absence-plan-preview.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/webapp/src/lib/absences/absence-plan-preview.ts apps/webapp/src/lib/absences/absence-plan-preview.test.ts
git commit -m "feat: add absence plan preview rules"
```

Expected: commit succeeds.

---

### Task 2: Server Action And Organization-Scoped Data Loading

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/absences/plan-preview.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/absences/plan-preview.test.ts`

- [ ] **Step 1: Write the failing server-action tests**

Create `apps/webapp/src/app/[locale]/(app)/absences/plan-preview.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { getAbsencePlanPreview } from "./plan-preview";

const state = vi.hoisted(() => ({
	currentEmployee: vi.fn(),
	getVacationBalance: vi.fn(),
	getHolidays: vi.fn(),
	db: {
		query: {
			absenceCategory: { findFirst: vi.fn() },
			absenceEntry: { findMany: vi.fn() },
			shift: { findMany: vi.fn() },
			coverageRule: { findMany: vi.fn() },
		},
	},
}));

vi.mock("@/db", () => ({ db: state.db }));
vi.mock("./current-employee", () => ({ getCurrentEmployee: state.currentEmployee }));
vi.mock("./queries", () => ({
	getVacationBalance: state.getVacationBalance,
	getHolidays: state.getHolidays,
}));

describe("getAbsencePlanPreview", () => {
	it("returns organization-scoped preview data", async () => {
		state.currentEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			managerId: "manager-1",
		});
		state.db.query.absenceCategory.findFirst.mockResolvedValue({
			id: "cat-vacation",
			name: "Vacation",
			requiresApproval: true,
			countsAgainstVacation: true,
		});
		state.getVacationBalance.mockResolvedValue({
			year: 2026,
			totalDays: 20,
			usedDays: 4,
			pendingDays: 2,
			remainingDays: 14,
		});
		state.getHolidays.mockResolvedValue([]);
		state.db.query.absenceEntry.findMany.mockResolvedValue([]);
		state.db.query.shift.findMany.mockResolvedValue([]);
		state.db.query.coverageRule.findMany.mockResolvedValue([]);

		const result = await getAbsencePlanPreview({
			categoryId: "cat-vacation",
			startDate: "2026-05-04",
			startPeriod: "full_day",
			endDate: "2026-05-05",
			endPeriod: "full_day",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.requestedDays).toBe(2);
		expect(result.data.approvalSignal).toBe("likely");
		expect(state.db.query.absenceCategory.findFirst).toHaveBeenCalledOnce();
		expect(state.getVacationBalance).toHaveBeenCalledWith("employee-1", 2026);
	});

	it("returns an error when there is no current employee", async () => {
		state.currentEmployee.mockResolvedValue(null);

		const result = await getAbsencePlanPreview({
			categoryId: "cat-vacation",
			startDate: "2026-05-04",
			startPeriod: "full_day",
			endDate: "2026-05-05",
			endPeriod: "full_day",
		});

		expect(result).toEqual({ success: false, error: "No active employee found" });
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter webapp test -- 'src/app/[locale]/(app)/absences/plan-preview.test.ts'
```

Expected: FAIL because `plan-preview.ts` does not exist.

- [ ] **Step 3: Implement the server action**

Create `apps/webapp/src/app/[locale]/(app)/absences/plan-preview.ts` with:

```ts
"use server";

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceCategory, absenceEntry, coverageRule, shift } from "@/db/schema";
import {
	buildAbsencePlanPreview,
	type AbsencePlanPreview,
	type AbsencePlanPreviewRequest,
	type AffectedShiftPreview,
	type CoverageEvaluationInput,
	type CoverageRiskPreview,
	type ExistingAbsenceForPreview,
} from "@/lib/absences/absence-plan-preview";
import { getCurrentEmployee } from "./current-employee";
import { getHolidays, getVacationBalance } from "./queries";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function getAbsencePlanPreview(
	request: AbsencePlanPreviewRequest,
): Promise<Result<AbsencePlanPreview>> {
	try {
		const currentEmployee = await getCurrentEmployee();
		if (!currentEmployee) {
			return { success: false, error: "No active employee found" };
		}

		const category = await db.query.absenceCategory.findFirst({
			where: and(
				eq(absenceCategory.id, request.categoryId),
				eq(absenceCategory.organizationId, currentEmployee.organizationId),
				eq(absenceCategory.isActive, true),
			),
		});
		if (!category) {
			return { success: false, error: "Absence category not found" };
		}

		const start = DateTime.fromISO(request.startDate);
		const end = DateTime.fromISO(request.endDate);
		if (!start.isValid || !end.isValid || start > end) {
			return { success: false, error: "Invalid preview date range" };
		}

		const [vacationBalance, holidays, existingAbsences, affectedShiftRows] = await Promise.all([
			getVacationBalance(currentEmployee.id, start.year),
			getHolidays(currentEmployee.id, start.toJSDate(), end.toJSDate()),
			db.query.absenceEntry.findMany({
				where: and(
					eq(absenceEntry.employeeId, currentEmployee.id),
					eq(absenceEntry.organizationId, currentEmployee.organizationId),
					lte(absenceEntry.startDate, request.endDate),
					gte(absenceEntry.endDate, request.startDate),
				),
				with: { category: true },
			}),
			db.query.shift.findMany({
				where: and(
					eq(shift.organizationId, currentEmployee.organizationId),
					eq(shift.employeeId, currentEmployee.id),
					eq(shift.status, "published"),
					gte(shift.date, start.toJSDate()),
					lte(shift.date, end.toJSDate()),
				),
				with: { subarea: true },
			}),
		]);

		const affectedShifts: AffectedShiftPreview[] = affectedShiftRows.map((row) => ({
			id: row.id,
			date: toDateKey(row.date),
			startTime: row.startTime,
			endTime: row.endTime,
			subareaId: row.subareaId,
			subareaName: row.subarea?.name ?? "Scheduled area",
		}));
		const coverage = await getCoverageEvaluation(currentEmployee.organizationId, affectedShifts);

		return {
			success: true,
			data: buildAbsencePlanPreview({
				category: {
					id: category.id,
					name: category.name,
					requiresApproval: category.requiresApproval,
					countsAgainstVacation: category.countsAgainstVacation,
				},
				request,
				vacationBalance,
				holidays,
				existingAbsences: existingAbsences.map((absence): ExistingAbsenceForPreview => ({
					id: absence.id,
					startDate: absence.startDate,
					endDate: absence.endDate,
					status: absence.status,
					categoryName: absence.category?.name ?? "Absence",
				})),
				affectedShifts,
				coverage,
				hasManager: Boolean(currentEmployee.managerId),
			}),
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Planning preview unavailable",
		};
	}
}

async function getCoverageEvaluation(
	organizationId: string,
	affectedShifts: AffectedShiftPreview[],
): Promise<CoverageEvaluationInput> {
	const subareaIds = [...new Set(affectedShifts.map((item) => item.subareaId))];
	if (subareaIds.length === 0) {
		return { risks: [], hasConfiguredRulesForAffectedShifts: true };
	}

	const rules = await db.query.coverageRule.findMany({
		where: and(
			eq(coverageRule.organizationId, organizationId),
			inArray(coverageRule.subareaId, subareaIds),
		),
	});
	const risks: CoverageRiskPreview[] = [];

	for (const affectedShift of affectedShifts) {
		const weekday = DateTime.fromISO(affectedShift.date).weekdayLong?.toLowerCase();
		const matchingRules = rules.filter(
			(rule) =>
				rule.subareaId === affectedShift.subareaId &&
				rule.dayOfWeek === weekday &&
				timesOverlap(rule.startTime, rule.endTime, affectedShift.startTime, affectedShift.endTime),
		);

		for (const rule of matchingRules) {
			const staffCountAfterAbsence = await countPublishedStaffAfterAbsence({
				organizationId,
				subareaId: affectedShift.subareaId,
				date: affectedShift.date,
				startTime: rule.startTime,
				endTime: rule.endTime,
				excludedShiftId: affectedShift.id,
			});
			if (staffCountAfterAbsence < rule.minimumStaffCount) {
				risks.push({
					date: affectedShift.date,
					subareaId: affectedShift.subareaId,
					subareaName: affectedShift.subareaName,
					startTime: rule.startTime,
					endTime: rule.endTime,
					minimumStaffCount: rule.minimumStaffCount,
					staffCountAfterAbsence,
				});
			}
		}
	}

	return { risks, hasConfiguredRulesForAffectedShifts: rules.length > 0 };
}

async function countPublishedStaffAfterAbsence(params: {
	organizationId: string;
	subareaId: string;
	date: string;
	startTime: string;
	endTime: string;
	excludedShiftId: string;
}): Promise<number> {
	const rows = await db.query.shift.findMany({
		where: and(
			eq(shift.organizationId, params.organizationId),
			eq(shift.subareaId, params.subareaId),
			eq(shift.status, "published"),
			eq(shift.date, DateTime.fromISO(params.date).toJSDate()),
		),
	});

	return rows.filter(
		(row) =>
			row.id !== params.excludedShiftId &&
			Boolean(row.employeeId) &&
			timesOverlap(params.startTime, params.endTime, row.startTime, row.endTime),
	).length;
}

function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
	return startA < endB && startB < endA;
}

function toDateKey(date: Date): string {
	return DateTime.fromJSDate(date, { zone: "utc" }).toISODate() ?? "";
}
```

- [ ] **Step 4: Export the action facade**

Modify `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`:

```ts
import { getAbsencePlanPreview as getAbsencePlanPreviewAction } from "./plan-preview";
```

Add after `getVacationBalance`:

```ts
export async function getAbsencePlanPreview(
	...args: Parameters<typeof getAbsencePlanPreviewAction>
) {
	return getAbsencePlanPreviewAction(...args);
}
```

- [ ] **Step 5: Run the server-action tests**

Run:

```bash
pnpm --filter webapp test -- 'src/app/[locale]/(app)/absences/plan-preview.test.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/absences/plan-preview.ts' 'apps/webapp/src/app/[locale]/(app)/absences/plan-preview.test.ts' 'apps/webapp/src/app/[locale]/(app)/absences/actions.ts'
git commit -m "feat: add absence planner server preview"
```

Expected: commit succeeds.

---

### Task 3: Preview Query Key And Panel Component

**Files:**
- Modify: `apps/webapp/src/lib/query/keys.ts`
- Create: `apps/webapp/src/components/absences/absence-plan-preview-panel.tsx`
- Create: `apps/webapp/src/components/absences/absence-plan-preview-panel.test.tsx`

- [ ] **Step 1: Write the failing panel tests**

Create `apps/webapp/src/components/absences/absence-plan-preview-panel.test.tsx` with:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AbsencePlanPreviewPanel } from "./absence-plan-preview-panel";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

describe("AbsencePlanPreviewPanel", () => {
	it("renders a risky advisory preview", () => {
		render(
			<AbsencePlanPreviewPanel
				preview={{
					requestedDays: 2,
					balance: {
						remainingBeforeRequest: 1,
						remainingAfterRequest: -1,
						countsAgainstVacation: true,
					},
					holidays: [],
					overlaps: [],
					affectedShifts: [],
					coverage: { risks: [], hasConfiguredRulesForAffectedShifts: true },
					approvalSignal: "risky",
					reasons: [],
					warnings: ["Vacation balance would be negative after this request."],
				}}
			/>,
		);

		expect(screen.getByText("Smart planner")).toBeTruthy();
		expect(screen.getByText("Risky")).toBeTruthy();
		expect(screen.getByText("Vacation balance would be negative after this request.")).toBeTruthy();
	});

	it("renders a non-blocking error state", () => {
		render(<AbsencePlanPreviewPanel error="Planning preview unavailable" />);

		expect(screen.getByText("Planning preview unavailable. You can still submit your request.")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the panel tests to verify they fail**

Run:

```bash
pnpm --filter webapp test -- src/components/absences/absence-plan-preview-panel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add the query key**

Modify `apps/webapp/src/lib/query/keys.ts` after the vacation policy assignment keys:

```ts
	// Absence plan previews
	absencePlanPreview: {
		all: ["absence-plan-preview"] as const,
		detail: <T extends object>(orgId: string, input: T) =>
			["absence-plan-preview", orgId, input] as const,
	},
```

- [ ] **Step 4: Implement the panel component**

Create `apps/webapp/src/components/absences/absence-plan-preview-panel.tsx` with:

```tsx
"use client";

import { IconAlertTriangle, IconCalendar, IconCheck, IconInfoCircle, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { AbsencePlanPreview } from "@/lib/absences/absence-plan-preview";
import { formatDays } from "@/lib/absences/date-utils";
import { cn } from "@/lib/utils";

interface AbsencePlanPreviewPanelProps {
	preview?: AbsencePlanPreview;
	isLoading?: boolean;
	error?: string | null;
}

export function AbsencePlanPreviewPanel({
	preview,
	isLoading = false,
	error = null,
}: AbsencePlanPreviewPanelProps) {
	const { t } = useTranslate();

	if (isLoading) {
		return (
			<section className="rounded-lg border bg-muted/30 p-3 text-sm" aria-live="polite">
				<div className="flex items-center gap-2 text-muted-foreground">
					<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
					{t("absences.planner.loading", "Checking balance, holidays, and coverage...")}
				</div>
			</section>
		);
	}

	if (error) {
		return (
			<section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100" aria-live="polite">
				<div className="flex items-start gap-2">
					<IconInfoCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span>{t("absences.planner.unavailable", "Planning preview unavailable. You can still submit your request.")}</span>
				</div>
			</section>
		);
	}

	if (!preview) {
		return null;
	}

	return (
		<section className="rounded-lg border bg-card p-3 text-sm shadow-sm" aria-labelledby="absence-plan-preview-title">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h3 id="absence-plan-preview-title" className="font-medium">
						{t("absences.planner.title", "Smart planner")}
					</h3>
					<p className="text-muted-foreground text-xs">
						{t("absences.planner.description", "Advisory preview before you submit.")}
					</p>
				</div>
				<span className={cn("rounded-full px-2 py-1 font-medium text-xs", signalClassName(preview.approvalSignal))}>
					{signalLabel(preview.approvalSignal)}
				</span>
			</div>

			<div className="mt-3 grid gap-2 sm:grid-cols-2">
				<PreviewTile icon={<IconCalendar className="size-4" />} label={t("absences.planner.balance", "Balance")}>
					{preview.balance ? (
						<span>
							{formatDays(preview.requestedDays, t)} requested, {formatDays(preview.balance.remainingAfterRequest, t)} remaining
						</span>
					) : (
						<span>{t("absences.planner.balanceUnavailable", "Balance unavailable")}</span>
					)}
				</PreviewTile>
				<PreviewTile icon={<IconInfoCircle className="size-4" />} label={t("absences.planner.holidays", "Holidays")}>
					{preview.holidays.length > 0
						? preview.holidays.map((holiday) => holiday.name).join(", ")
						: t("absences.planner.noHolidays", "No assigned holidays in range")}
				</PreviewTile>
				<PreviewTile icon={<IconAlertTriangle className="size-4" />} label={t("absences.planner.coverage", "Coverage")}>
					{preview.coverage.risks.length > 0
						? `${preview.coverage.risks.length} coverage warning(s)`
						: t("absences.planner.noCoverageRisk", "No published coverage risk")}
				</PreviewTile>
				<PreviewTile icon={<IconCheck className="size-4" />} label={t("absences.planner.approval", "Approval")}>
					{preview.reasons[0] ?? t("absences.planner.advisory", "Advisory only")}
				</PreviewTile>
			</div>

			{preview.warnings.length > 0 && (
				<ul className="mt-3 space-y-1 text-amber-700 text-xs dark:text-amber-300">
					{preview.warnings.map((warning) => (
						<li key={warning}>{warning}</li>
					))}
				</ul>
			)}
		</section>
	);
}

function PreviewTile({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
	return (
		<div className="rounded-md border bg-muted/20 p-2">
			<div className="mb-1 flex items-center gap-1.5 font-medium text-xs">
				{icon}
				{label}
			</div>
			<div className="text-muted-foreground text-xs">{children}</div>
		</div>
	);
}

function signalLabel(signal: AbsencePlanPreview["approvalSignal"]): string {
	if (signal === "risky") return "Risky";
	if (signal === "needs_review") return "Needs review";
	return "Likely";
}

function signalClassName(signal: AbsencePlanPreview["approvalSignal"]): string {
	if (signal === "risky") return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
	if (signal === "needs_review") return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
	return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300";
}
```

- [ ] **Step 5: Run the panel tests**

Run:

```bash
pnpm --filter webapp test -- src/components/absences/absence-plan-preview-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add apps/webapp/src/lib/query/keys.ts apps/webapp/src/components/absences/absence-plan-preview-panel.tsx apps/webapp/src/components/absences/absence-plan-preview-panel.test.tsx
git commit -m "feat: add absence planner preview panel"
```

Expected: commit succeeds.

---

### Task 4: Request Dialog Integration

**Files:**
- Modify: `apps/webapp/src/components/absences/request-absence-dialog.tsx`
- Modify: `apps/webapp/src/components/absences/request-absence-dialog.test.tsx`

- [ ] **Step 1: Write failing dialog tests for planner behavior**

Modify `apps/webapp/src/components/absences/request-absence-dialog.test.tsx` to include these imports:

```ts
import userEvent from "@testing-library/user-event";
```

Replace the actions mock with:

```ts
const actions = vi.hoisted(() => ({
	requestAbsence: vi.fn(),
	getAbsencePlanPreview: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/absences/actions", () => actions);
```

Add these tests inside the existing `describe("RequestAbsenceDialog", () => {` block:

```tsx
	it("keeps the planner hidden until required fields are selected", () => {
		render(
			<RequestAbsenceDialog
				open
				onOpenChange={vi.fn()}
				remainingDays={10}
				categories={[
					{
						id: "vacation",
						name: "Vacation",
						type: "vacation",
						color: null,
						requiresApproval: true,
						countsAgainstVacation: true,
					},
				]}
			/>,
		);

		expect(screen.queryByText("Smart planner")).toBeNull();
	});

	it("does not block submit because of planner warnings", async () => {
		const user = userEvent.setup();
		actions.requestAbsence.mockResolvedValue({ success: true, data: { absenceId: "absence-1" } });
		actions.getAbsencePlanPreview.mockResolvedValue({
			success: true,
			data: {
				requestedDays: 1,
				balance: { remainingBeforeRequest: 10, remainingAfterRequest: 9, countsAgainstVacation: true },
				holidays: [],
				overlaps: [],
				affectedShifts: [],
				coverage: {
					risks: [
						{
							date: "2026-05-04",
							subareaId: "subarea-1",
							subareaName: "Front Desk",
							startTime: "09:00",
							endTime: "17:00",
							minimumStaffCount: 2,
							staffCountAfterAbsence: 1,
						},
					],
					hasConfiguredRulesForAffectedShifts: true,
				},
				approvalSignal: "risky",
				reasons: [],
				warnings: ["Published coverage would drop below the configured minimum."],
			},
		});

		render(
			<RequestAbsenceDialog
				open
				onOpenChange={vi.fn()}
				remainingDays={10}
				initialDate="2026-05-04"
				categories={[
					{
						id: "vacation",
						name: "Vacation",
						type: "vacation",
						color: null,
						requiresApproval: true,
						countsAgainstVacation: true,
					},
				]}
			/>,
		);

		await user.click(screen.getByRole("combobox", { name: /absence type/i }));
		await user.click(screen.getByText("Vacation"));
		await user.click(screen.getByRole("button", { name: /submit/i }));

		expect(actions.requestAbsence).toHaveBeenCalledOnce();
	});
```

- [ ] **Step 2: Run the dialog tests to verify they fail**

Run:

```bash
pnpm --filter webapp test -- src/components/absences/request-absence-dialog.test.tsx
```

Expected: FAIL because `RequestAbsenceDialog` does not call or render the planner.

- [ ] **Step 3: Integrate the planner query in the dialog**

Modify `apps/webapp/src/components/absences/request-absence-dialog.tsx` imports:

```tsx
import { useQuery } from "@tanstack/react-query";
import { getAbsencePlanPreview, requestAbsence } from "@/app/[locale]/(app)/absences/actions";
import { queryKeys } from "@/lib/query/keys";
import { AbsencePlanPreviewPanel } from "./absence-plan-preview-panel";
```

Inside `RequestAbsenceDialog`, add this subscription before the `return`:

```tsx
	const previewValues = form.useStore((state) => ({
		categoryId: state.values.categoryId,
		startDate: state.values.startDate,
		startPeriod: state.values.startPeriod,
		endDate: state.values.endDate,
		endPeriod: state.values.endPeriod,
	}));
	const canLoadPreview = Boolean(
		previewValues.categoryId && previewValues.startDate && previewValues.endDate,
	);
	const plannerQuery = useQuery({
		queryKey: queryKeys.absencePlanPreview.detail("current", previewValues),
		queryFn: async () => {
			const result = await getAbsencePlanPreview(previewValues);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open && canLoadPreview,
		staleTime: 30_000,
	});
```

Render the panel near the end of `ActionPanelBody`, after the notes field and before the footer:

```tsx
						{canLoadPreview && (
							<AbsencePlanPreviewPanel
								preview={plannerQuery.data}
								isLoading={plannerQuery.isLoading || plannerQuery.isFetching}
								error={plannerQuery.error instanceof Error ? plannerQuery.error.message : null}
							/>
						)}
```

- [ ] **Step 4: Run the dialog tests**

Run:

```bash
pnpm --filter webapp test -- src/components/absences/request-absence-dialog.test.tsx
```

Expected: PASS. If the submit-button role text differs, update only the query in the test to match the existing accessible name rendered by `RequestAbsenceDialog`.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add apps/webapp/src/components/absences/request-absence-dialog.tsx apps/webapp/src/components/absences/request-absence-dialog.test.tsx
git commit -m "feat: show smart absence planner in request dialog"
```

Expected: commit succeeds.

---

### Task 5: Final Verification And Quality Checks

**Files:**
- Verify all files changed by Tasks 1-4.

- [ ] **Step 1: Run all targeted absence planner tests**

Run:

```bash
pnpm --filter webapp test -- src/lib/absences/absence-plan-preview.test.ts 'src/app/[locale]/(app)/absences/plan-preview.test.ts' src/components/absences/absence-plan-preview-panel.test.tsx src/components/absences/request-absence-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the webapp test suite if it does not require unavailable environment variables**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS, or stop and record the exact environment-variable-related blocker from the command output.

- [ ] **Step 3: Run git status and inspect the final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intentional Smart Absence Planner changes are present.

- [ ] **Step 4: Commit final verification fixes if any were needed**

If Step 1 or Step 2 required code fixes, run:

```bash
git add apps/webapp/src/lib/absences/absence-plan-preview.ts apps/webapp/src/lib/absences/absence-plan-preview.test.ts apps/webapp/src/app/[locale]/(app)/absences/plan-preview.ts apps/webapp/src/app/[locale]/(app)/absences/plan-preview.test.ts apps/webapp/src/app/[locale]/(app)/absences/actions.ts apps/webapp/src/lib/query/keys.ts apps/webapp/src/components/absences/absence-plan-preview-panel.tsx apps/webapp/src/components/absences/absence-plan-preview-panel.test.tsx apps/webapp/src/components/absences/request-absence-dialog.tsx apps/webapp/src/components/absences/request-absence-dialog.test.tsx
git commit -m "fix: stabilize smart absence planner"
```

Expected: commit succeeds, or no commit is created because no verification fixes were needed.

---

## Self-Review Notes

- Spec coverage: the plan covers inline dialog preview, server-backed organization scoping, balance impact, assigned holidays, existing absence overlaps, published-shift coverage risks, explainable approval signals, non-blocking errors, no persistence, and targeted tests.
- Placeholder scan: no implementation steps depend on unspecified functions; every new function and type referenced by later tasks is introduced in an earlier task.
- Type consistency: `AbsencePlanPreviewRequest`, `AbsencePlanPreview`, `CoverageEvaluationInput`, and `ApprovalSignal` are defined in Task 1 and reused by the server action, panel, and dialog tasks.
