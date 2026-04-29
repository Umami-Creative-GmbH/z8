# Manager Daily Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manager/admin-only `/today` command page that summarizes today's operational exceptions and actions, with a manager-only dashboard entry card.

**Architecture:** Add a focused `manager-daily-briefing` domain module with pure detection helpers and a server loader that composes existing shift, absence, approval, time record, coverage, and payroll data. Render the page as a server route with small client islands for inline approval decisions and dashboard entry behavior.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, Luxon, TanStack React Query for existing approval mutations, Vitest, Testing Library, pnpm.

---

## File Structure

- Create `apps/webapp/src/lib/manager-daily-briefing/types.ts`: shared types for briefing sections, action items, severities, and loader inputs.
- Create `apps/webapp/src/lib/manager-daily-briefing/logic.ts`: pure functions for date bounds, severity sorting, attendance exceptions, absence overlap, coverage risks, payroll issue shaping, and summary counts.
- Create `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts`: server loader that resolves employee scope and collects section data.
- Create `apps/webapp/src/lib/manager-daily-briefing/__tests__/logic.test.ts`: pure unit tests.
- Create `apps/webapp/src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`: loader tests with mocked query adapters.
- Create `apps/webapp/src/app/[locale]/(app)/today/page.tsx`: server page with access handling.
- Create `apps/webapp/src/app/[locale]/(app)/today/today-briefing.tsx`: server-rendered layout components for summary, sections, and links.
- Create `apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.tsx`: client component for inline approve/reject actions.
- Create `apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.test.tsx`: inline action tests.
- Create `apps/webapp/src/components/dashboard/manager-today-widget.tsx`: manager-only dashboard entry card.
- Modify `apps/webapp/src/components/dashboard/widget-registry.ts`: add `manager-today` to the widget registry and default order.
- Modify `apps/webapp/src/components/section-cards.tsx`: register `ManagerTodayWidget`.
- Modify `apps/webapp/src/components/app-sidebar.tsx`: no sidebar item; confirm no change is needed unless tests reveal a route conflict.

## Task 1: Pure Briefing Types And Logic

**Files:**
- Create: `apps/webapp/src/lib/manager-daily-briefing/types.ts`
- Create: `apps/webapp/src/lib/manager-daily-briefing/logic.ts`
- Test: `apps/webapp/src/lib/manager-daily-briefing/__tests__/logic.test.ts`

- [ ] **Step 1: Write failing logic tests**

Create `apps/webapp/src/lib/manager-daily-briefing/__tests__/logic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
	buildSummaryCounts,
	detectAbsencesToday,
	detectAttendanceExceptions,
	detectCoverageRisks,
	sortActionItems,
} from "../logic";
import type { BriefingActionItem } from "../types";

describe("manager daily briefing logic", () => {
	it("detects missing and late clock-ins from published shifts only", () => {
		const now = DateTime.fromISO("2026-04-28T09:20:00.000+02:00");
		const shifts = [
			{
				id: "shift-1",
				employeeId: "emp-1",
				employeeName: "Ada Lovelace",
				teamName: "Operations",
				date: "2026-04-28",
				startTime: "09:00",
				endTime: "17:00",
				status: "published" as const,
			},
			{
				id: "shift-2",
				employeeId: "emp-2",
				employeeName: "Grace Hopper",
				teamName: "Operations",
				date: "2026-04-28",
				startTime: "10:00",
				endTime: "18:00",
				status: "published" as const,
			},
			{
				id: "shift-3",
				employeeId: "emp-3",
				employeeName: "Draft Employee",
				teamName: "Operations",
				date: "2026-04-28",
				startTime: "08:00",
				endTime: "16:00",
				status: "draft" as const,
			},
		];

		const records = [
			{
				id: "record-1",
				employeeId: "emp-2",
				startAt: DateTime.fromISO("2026-04-28T09:55:00.000+02:00").toJSDate(),
				endAt: null,
			},
		];

		expect(detectAttendanceExceptions({ now, shifts, records, graceMinutes: 5 })).toEqual([
			expect.objectContaining({
				id: "attendance:shift-1",
				severity: "critical",
				category: "attendance",
				title: "Ada Lovelace has not clocked in",
			}),
		]);
	});

	it("returns approved absences overlapping today", () => {
		const today = DateTime.fromISO("2026-04-28T12:00:00.000+02:00");
		const result = detectAbsencesToday({
			today,
			absences: [
				{
					id: "absence-1",
					employeeId: "emp-1",
					employeeName: "Ada Lovelace",
					teamName: "Operations",
					categoryName: "Vacation",
					startDate: "2026-04-27",
					endDate: "2026-04-29",
					status: "approved" as const,
				},
				{
					id: "absence-2",
					employeeId: "emp-2",
					employeeName: "Grace Hopper",
					teamName: "Operations",
					categoryName: "Sick leave",
					startDate: "2026-04-28",
					endDate: "2026-04-28",
					status: "pending" as const,
				},
			],
		});

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ id: "absence:absence-1", title: "Ada Lovelace is absent" });
	});

	it("detects coverage risks when staffing is below the rule minimum", () => {
		const risks = detectCoverageRisks({
			dayOfWeek: "tuesday",
			coverageRules: [
				{
					id: "rule-1",
					subareaId: "subarea-1",
					subareaName: "Front desk",
					dayOfWeek: "tuesday",
					startTime: "09:00",
					endTime: "12:00",
					minimumStaffCount: 2,
				},
			],
			publishedShifts: [
				{
					id: "shift-1",
					employeeId: "emp-1",
					employeeName: "Ada Lovelace",
					teamName: "Operations",
					subareaId: "subarea-1",
					subareaName: "Front desk",
					date: "2026-04-28",
					startTime: "09:00",
					endTime: "12:00",
					status: "published" as const,
				},
			],
		});

		expect(risks).toEqual([
			expect.objectContaining({
				id: "coverage:rule-1",
				severity: "high",
				title: "Front desk is understaffed",
			}),
		]);
	});

	it("sorts action items by severity and stable title", () => {
		const items: BriefingActionItem[] = [
			{ id: "2", category: "payroll", severity: "warning", title: "B item", description: "", href: "/settings/payroll-readiness" },
			{ id: "1", category: "attendance", severity: "critical", title: "A item", description: "", href: "/time-tracking" },
			{ id: "3", category: "coverage", severity: "high", title: "C item", description: "", href: "/scheduling" },
		];

		expect(sortActionItems(items).map((item) => item.id)).toEqual(["1", "3", "2"]);
	});

	it("builds summary counts from normalized sections", () => {
		const item: BriefingActionItem = {
			id: "attendance:1",
			category: "attendance",
			severity: "critical",
			title: "Missing clock-in",
			description: "Ada has not clocked in",
			href: "/time-tracking",
		};

		expect(
			buildSummaryCounts({
				needsAction: [item],
				approvals: [item],
				attendance: [item],
				absences: [],
				coverage: [],
				overtime: [],
				payroll: [item],
			}),
		).toEqual({
			criticalIssues: 1,
			openApprovals: 1,
			attendanceExceptions: 1,
			absencesToday: 0,
			coverageRisks: 0,
			overtimeWarnings: 0,
			payrollIssues: 1,
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/manager-daily-briefing/__tests__/logic.test.ts`

Expected: FAIL because `../logic` and `../types` do not exist.

- [ ] **Step 3: Add shared types**

Create `apps/webapp/src/lib/manager-daily-briefing/types.ts`:

```ts
import type { ApprovalType, UnifiedApprovalItem } from "@/lib/approvals/domain/types";

export type BriefingSeverity = "critical" | "high" | "warning" | "info";

export type BriefingCategory =
	| "approval"
	| "attendance"
	| "absence"
	| "coverage"
	| "overtime"
	| "payroll";

export interface BriefingActionItem {
	id: string;
	category: BriefingCategory;
	severity: BriefingSeverity;
	title: string;
	description: string;
	href: string;
	employeeId?: string;
	employeeName?: string;
	teamName?: string | null;
	meta?: Record<string, string | number | boolean | null>;
}

export interface BriefingApprovalActionItem extends BriefingActionItem {
	category: "approval";
	approvalId: string;
	approvalType: ApprovalType;
	entityId: string;
	requesterName: string;
	summary: string;
}

export interface BriefingSummaryCounts {
	criticalIssues: number;
	openApprovals: number;
	attendanceExceptions: number;
	absencesToday: number;
	coverageRisks: number;
	overtimeWarnings: number;
	payrollIssues: number;
}

export interface BriefingSection<TItem extends BriefingActionItem = BriefingActionItem> {
	id: string;
	title: string;
	description: string;
	items: TItem[];
	error?: string;
	emptyState: {
		title: string;
		description: string;
	};
}

export interface ManagerDailyBriefing {
	generatedAt: string;
	date: string;
	summary: BriefingSummaryCounts;
	needsAction: BriefingActionItem[];
	sections: {
		approvals: BriefingSection<BriefingApprovalActionItem>;
		attendance: BriefingSection;
		absences: BriefingSection;
		coverage: BriefingSection;
		overtime: BriefingSection;
		payroll: BriefingSection;
	};
}

export interface BriefingShiftInput {
	id: string;
	employeeId: string | null;
	employeeName: string;
	teamName: string | null;
	date: string;
	startTime: string;
	endTime: string;
	status: "draft" | "published" | "cancelled";
	subareaId?: string | null;
	subareaName?: string | null;
}

export interface BriefingTimeRecordInput {
	id: string;
	employeeId: string;
	startAt: Date;
	endAt: Date | null;
}

export interface BriefingAbsenceInput {
	id: string;
	employeeId: string;
	employeeName: string;
	teamName: string | null;
	categoryName: string;
	startDate: string;
	endDate: string;
	status: "pending" | "approved" | "rejected";
}

export interface BriefingCoverageRuleInput {
	id: string;
	subareaId: string;
	subareaName: string;
	dayOfWeek: string;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
}

export interface BriefingSectionBuckets {
	needsAction: BriefingActionItem[];
	approvals: BriefingActionItem[];
	attendance: BriefingActionItem[];
	absences: BriefingActionItem[];
	coverage: BriefingActionItem[];
	overtime: BriefingActionItem[];
	payroll: BriefingActionItem[];
}

export function approvalToBriefingItem(approval: UnifiedApprovalItem): BriefingApprovalActionItem {
	return {
		id: `approval:${approval.id}`,
		category: "approval",
		severity: approval.priority === "urgent" ? "critical" : approval.priority === "high" ? "high" : "warning",
		title: approval.display.title,
		description: approval.display.subtitle,
		href: `/approvals/inbox?types=${approval.approvalType}`,
		employeeId: approval.requester.id,
		employeeName: approval.requester.name,
		teamName: null,
		approvalId: approval.id,
		approvalType: approval.approvalType,
		entityId: approval.entityId,
		requesterName: approval.requester.name,
		summary: approval.display.summary,
	};
}
```

- [ ] **Step 4: Add pure logic implementation**

Create `apps/webapp/src/lib/manager-daily-briefing/logic.ts`:

```ts
import { DateTime } from "luxon";
import type {
	BriefingAbsenceInput,
	BriefingActionItem,
	BriefingCoverageRuleInput,
	BriefingSectionBuckets,
	BriefingShiftInput,
	BriefingTimeRecordInput,
} from "./types";

const SEVERITY_RANK = {
	critical: 0,
	high: 1,
	warning: 2,
	info: 3,
} as const;

export function sortActionItems<T extends BriefingActionItem>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
		if (severityDiff !== 0) return severityDiff;
		return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
	});
}

function shiftStart(date: string, startTime: string, zone: string): DateTime {
	return DateTime.fromISO(`${date}T${startTime}`, { zone });
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
	return aStart < bEnd && bStart < aEnd;
}

export function detectAttendanceExceptions(input: {
	now: DateTime;
	shifts: BriefingShiftInput[];
	records: BriefingTimeRecordInput[];
	graceMinutes: number;
}): BriefingActionItem[] {
	const zone = input.now.zoneName;
	const today = input.now.toISODate();
	const openRecordEmployeeIds = new Set(
		input.records.filter((record) => record.endAt === null).map((record) => record.employeeId),
	);

	return sortActionItems(
		input.shifts
			.filter((shift) => shift.status === "published")
			.filter((shift) => shift.date === today)
			.filter((shift) => shift.employeeId !== null)
			.filter((shift) => !openRecordEmployeeIds.has(shift.employeeId as string))
			.filter((shift) => shiftStart(shift.date, shift.startTime, zone).plus({ minutes: input.graceMinutes }) <= input.now)
			.map((shift) => ({
				id: `attendance:${shift.id}`,
				category: "attendance" as const,
				severity: "critical" as const,
				title: `${shift.employeeName} has not clocked in`,
				description: `Expected at ${shift.startTime}${shift.teamName ? ` for ${shift.teamName}` : ""}.`,
				href: "/time-tracking",
				employeeId: shift.employeeId as string,
				employeeName: shift.employeeName,
				teamName: shift.teamName,
				meta: { shiftId: shift.id, startTime: shift.startTime },
			})),
	);
}

export function detectAbsencesToday(input: {
	today: DateTime;
	absences: BriefingAbsenceInput[];
}): BriefingActionItem[] {
	const today = input.today.toISODate();
	return sortActionItems(
		input.absences
			.filter((absence) => absence.status === "approved")
			.filter((absence) => absence.startDate <= today && absence.endDate >= today)
			.map((absence) => ({
				id: `absence:${absence.id}`,
				category: "absence" as const,
				severity: "info" as const,
				title: `${absence.employeeName} is absent`,
				description: `${absence.categoryName}, ${absence.startDate} to ${absence.endDate}.`,
				href: "/absences",
				employeeId: absence.employeeId,
				employeeName: absence.employeeName,
				teamName: absence.teamName,
			})),
	);
}

export function detectCoverageRisks(input: {
	dayOfWeek: string;
	coverageRules: BriefingCoverageRuleInput[];
	publishedShifts: BriefingShiftInput[];
}): BriefingActionItem[] {
	return sortActionItems(
		input.coverageRules
			.filter((rule) => rule.dayOfWeek === input.dayOfWeek)
			.map((rule) => {
				const staffed = input.publishedShifts.filter(
					(shift) =>
						shift.status === "published" &&
						shift.subareaId === rule.subareaId &&
						shift.employeeId !== null &&
						overlaps(shift.startTime, shift.endTime, rule.startTime, rule.endTime),
				).length;

				if (staffed >= rule.minimumStaffCount) return null;

				const missing = rule.minimumStaffCount - staffed;
				return {
					id: `coverage:${rule.id}`,
					category: "coverage" as const,
					severity: missing >= 2 ? ("critical" as const) : ("high" as const),
					title: `${rule.subareaName} is understaffed`,
					description: `${staffed}/${rule.minimumStaffCount} employees scheduled from ${rule.startTime} to ${rule.endTime}.`,
					href: "/scheduling",
					meta: { ruleId: rule.id, missing },
				};
			})
			.filter((item): item is BriefingActionItem => item !== null),
	);
}

export function buildSummaryCounts(sections: BriefingSectionBuckets) {
	return {
		criticalIssues: sections.needsAction.filter((item) => item.severity === "critical").length,
		openApprovals: sections.approvals.length,
		attendanceExceptions: sections.attendance.length,
		absencesToday: sections.absences.length,
		coverageRisks: sections.coverage.length,
		overtimeWarnings: sections.overtime.length,
		payrollIssues: sections.payroll.length,
	};
}
```

- [ ] **Step 5: Run logic tests**

Run: `pnpm --dir apps/webapp test src/lib/manager-daily-briefing/__tests__/logic.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/webapp/src/lib/manager-daily-briefing/types.ts apps/webapp/src/lib/manager-daily-briefing/logic.ts apps/webapp/src/lib/manager-daily-briefing/__tests__/logic.test.ts
git commit -m "feat: add manager daily briefing logic"
```

## Task 2: Server Loader And Scope Rules

**Files:**
- Create: `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts`
- Test: `apps/webapp/src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`

- [ ] **Step 1: Write failing loader tests around scope and partial errors**

Create `apps/webapp/src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { getManagerDailyBriefingFromSources } from "../get-manager-daily-briefing";

describe("getManagerDailyBriefingFromSources", () => {
	it("uses all active organization employees for admins", async () => {
		const sources = createSources();
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "admin-1", role: "admin" },
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(sources.getScopedEmployees).toHaveBeenCalledWith({
			organizationId: "org-1",
			currentEmployeeId: "admin-1",
			role: "admin",
		});
		expect(briefing.summary.attendanceExceptions).toBe(1);
	});

	it("uses managed employees for managers", async () => {
		const sources = createSources();
		await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(sources.getScopedEmployees).toHaveBeenCalledWith({
			organizationId: "org-1",
			currentEmployeeId: "manager-1",
			role: "manager",
		});
	});

	it("keeps rendering sections when approvals fail", async () => {
		const sources = createSources({ getApprovals: vi.fn().mockRejectedValue(new Error("approval query failed")) });
		const briefing = await getManagerDailyBriefingFromSources({
			organizationId: "org-1",
			currentEmployee: { id: "manager-1", role: "manager" },
			now: DateTime.fromISO("2026-04-28T09:20:00.000+02:00"),
			sources,
		});

		expect(briefing.sections.approvals.error).toBe("approval query failed");
		expect(briefing.summary.attendanceExceptions).toBe(1);
	});
});

function createSources(overrides = {}) {
	return {
		getScopedEmployees: vi.fn().mockResolvedValue([
			{ id: "emp-1", name: "Ada Lovelace", teamName: "Operations" },
		]),
		getPublishedShifts: vi.fn().mockResolvedValue([
			{
				id: "shift-1",
				employeeId: "emp-1",
				employeeName: "Ada Lovelace",
				teamName: "Operations",
				date: "2026-04-28",
				startTime: "09:00",
				endTime: "17:00",
				status: "published",
			},
		]),
		getOpenTimeRecords: vi.fn().mockResolvedValue([]),
		getApprovedAbsences: vi.fn().mockResolvedValue([]),
		getCoverageRules: vi.fn().mockResolvedValue([]),
		getApprovals: vi.fn().mockResolvedValue([]),
		getOvertimeWarnings: vi.fn().mockResolvedValue([]),
		getPayrollIssues: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}
```

- [ ] **Step 2: Run loader tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`

Expected: FAIL because `get-manager-daily-briefing.ts` does not exist.

- [ ] **Step 3: Implement source-composed loader**

Create `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts` with this public shape:

```ts
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceEntry, coverageRule, employee, employeeManagers, payrollWageTypeMapping, shift, timeRecord } from "@/db/schema";
import { ApprovalQueryService, ApprovalQueryServiceLive } from "@/lib/approvals/application/approval-query.service";
import { Effect } from "effect";
import { buildSummaryCounts, detectAbsencesToday, detectAttendanceExceptions, detectCoverageRisks, sortActionItems } from "./logic";
import { approvalToBriefingItem, type BriefingActionItem, type BriefingApprovalActionItem, type ManagerDailyBriefing } from "./types";

type CurrentEmployee = { id: string; role: "admin" | "manager" | "employee" };
type ScopedEmployee = { id: string; name: string; teamName: string | null };

export interface BriefingSources {
	getScopedEmployees(input: { organizationId: string; currentEmployeeId: string; role: CurrentEmployee["role"] }): Promise<ScopedEmployee[]>;
	getPublishedShifts(input: { organizationId: string; employeeIds: string[]; today: string }): Promise<any[]>;
	getOpenTimeRecords(input: { organizationId: string; employeeIds: string[]; dayStart: Date; dayEnd: Date }): Promise<any[]>;
	getApprovedAbsences(input: { organizationId: string; employeeIds: string[]; today: string }): Promise<any[]>;
	getCoverageRules(input: { organizationId: string }): Promise<any[]>;
	getApprovals(input: { organizationId: string; approverId: string }): Promise<BriefingApprovalActionItem[]>;
	getOvertimeWarnings(input: { organizationId: string; employeeIds: string[]; today: string }): Promise<BriefingActionItem[]>;
	getPayrollIssues(input: { organizationId: string; employeeIds: string[] }): Promise<BriefingActionItem[]>;
}

export async function getManagerDailyBriefingFromSources(input: {
	organizationId: string;
	currentEmployee: CurrentEmployee;
	now: DateTime;
	sources: BriefingSources;
}): Promise<ManagerDailyBriefing> {
	const today = input.now.toISODate();
	const employees = await input.sources.getScopedEmployees({
		organizationId: input.organizationId,
		currentEmployeeId: input.currentEmployee.id,
		role: input.currentEmployee.role,
	});
	const employeeIds = employees.map((item) => item.id);
	const dayStart = input.now.startOf("day").toJSDate();
	const dayEnd = input.now.endOf("day").toJSDate();
	const dayOfWeek = input.now.setLocale("en").weekdayLong.toLowerCase();

	const [shiftsResult, recordsResult, absencesResult, coverageRulesResult, approvalsResult, overtimeResult, payrollResult] = await Promise.allSettled([
		input.sources.getPublishedShifts({ organizationId: input.organizationId, employeeIds, today }),
		input.sources.getOpenTimeRecords({ organizationId: input.organizationId, employeeIds, dayStart, dayEnd }),
		input.sources.getApprovedAbsences({ organizationId: input.organizationId, employeeIds, today }),
		input.sources.getCoverageRules({ organizationId: input.organizationId }),
		input.sources.getApprovals({ organizationId: input.organizationId, approverId: input.currentEmployee.id }),
		input.sources.getOvertimeWarnings({ organizationId: input.organizationId, employeeIds, today }),
		input.sources.getPayrollIssues({ organizationId: input.organizationId, employeeIds }),
	]);

	const shifts = fulfilled(shiftsResult, []);
	const records = fulfilled(recordsResult, []);
	const absences = fulfilled(absencesResult, []);
	const coverageRules = fulfilled(coverageRulesResult, []);
	const approvals = fulfilled(approvalsResult, []);
	const overtime = fulfilled(overtimeResult, []);
	const payroll = fulfilled(payrollResult, []);
	const attendance = detectAttendanceExceptions({ now: input.now, shifts, records, graceMinutes: 5 });
	const absencesToday = detectAbsencesToday({ today: input.now, absences });
	const coverage = detectCoverageRisks({ dayOfWeek, coverageRules, publishedShifts: shifts });
	const needsAction = sortActionItems([...approvals, ...attendance, ...coverage, ...overtime, ...payroll]).slice(0, 12);
	const summary = buildSummaryCounts({ needsAction, approvals, attendance, absences: absencesToday, coverage, overtime, payroll });

	return {
		generatedAt: input.now.toISO(),
		date: today,
		summary,
		needsAction,
		sections: {
			approvals: section("approvals", "Approvals", "Requests awaiting your decision.", approvals, "No approvals pending", approvalsResult),
			attendance: section("attendance", "Attendance Exceptions", "People expected from published shifts who have not clocked in.", attendance, "Everyone expected has clocked in", recordsResult),
			absences: section("absences", "Absences Today", "Approved absences overlapping today.", absencesToday, "No one is absent today", absencesResult),
			coverage: section("coverage", "Coverage Risks", "Understaffed subareas and unassigned shift risks.", coverage, "No coverage risks detected", coverageRulesResult),
			overtime: section("overtime", "Overtime Warnings", "Overtime signals for today.", overtime, "No overtime warnings", overtimeResult),
			payroll: section("payroll", "Payroll Issues", "Issues likely to affect payroll readiness.", payroll, "No payroll-impacting issues", payrollResult),
		},
	};
}

function fulfilled<T>(result: PromiseSettledResult<T>, fallback: T): T {
	return result.status === "fulfilled" ? result.value : fallback;
}

function resultError(result: PromiseSettledResult<unknown>): string | undefined {
	return result.status === "rejected" ? (result.reason instanceof Error ? result.reason.message : "Section could not be loaded") : undefined;
}

function section<T extends BriefingActionItem>(id: string, title: string, description: string, items: T[], emptyTitle: string, sourceResult: PromiseSettledResult<unknown>) {
	return {
		id,
		title,
		description,
		items,
		error: resultError(sourceResult),
		emptyState: { title: emptyTitle, description: "No action is needed in this section." },
	};
}
```

Add this exported wrapper below the helper functions, then replace the source query bodies with Drizzle queries that return the shapes from `types.ts`:

```ts
export async function getManagerDailyBriefing(input: { currentEmployee: { id: string; organizationId: string; role: "admin" | "manager" | "employee" } }) {
	return getManagerDailyBriefingFromSources({
		organizationId: input.currentEmployee.organizationId,
		currentEmployee: {
			id: input.currentEmployee.id,
			role: input.currentEmployee.role,
		},
		now: DateTime.local(),
		sources: createDatabaseBriefingSources(),
	});
}

function createDatabaseBriefingSources(): BriefingSources {
	return {
		async getScopedEmployees({ organizationId, currentEmployeeId, role }) {
			if (role === "admin") {
				const rows = await db.query.employee.findMany({
					where: (e, { and, eq }) => and(eq(e.organizationId, organizationId), eq(e.isActive, true)),
					with: { user: true, team: true },
				});
				return rows.map((row) => ({ id: row.id, name: row.user.name, teamName: row.team?.name ?? null }));
			}

			const rows = await db.query.employeeManagers.findMany({
				where: eq(employeeManagers.managerId, currentEmployeeId),
				with: { employee: { with: { user: true, team: true } } },
			});
			return rows
				.filter((row) => row.employee.organizationId === organizationId && row.employee.isActive)
				.map((row) => ({ id: row.employee.id, name: row.employee.user.name, teamName: row.employee.team?.name ?? null }));
		},

		async getApprovals({ organizationId, approverId }) {
			const result = await Effect.runPromise(
				ApprovalQueryService.pipe(
					Effect.flatMap((service) =>
						service.getApprovals({ organizationId, approverId, status: "pending", limit: 20 }),
					),
					Effect.provide(ApprovalQueryServiceLive),
				),
			);
			return result.items.map(approvalToBriefingItem);
		},

		async getPublishedShifts({ organizationId, employeeIds, today }) {
			if (employeeIds.length === 0) return [];
			const rows = await db.query.shift.findMany({
				where: and(eq(shift.organizationId, organizationId), inArray(shift.employeeId, employeeIds), eq(shift.date, new Date(today)), eq(shift.status, "published")),
				with: { employee: { with: { user: true, team: true } }, subarea: true },
			});
			return rows.map((row) => ({
				id: row.id,
				employeeId: row.employeeId,
				employeeName: row.employee?.user.name ?? "Unassigned",
				teamName: row.employee?.team?.name ?? null,
				date: today,
				startTime: row.startTime,
				endTime: row.endTime,
				status: row.status,
				subareaId: row.subareaId,
				subareaName: row.subarea?.name ?? null,
			}));
		},

		async getOpenTimeRecords({ organizationId, employeeIds, dayStart, dayEnd }) {
			if (employeeIds.length === 0) return [];
			return db.query.timeRecord.findMany({
				where: and(eq(timeRecord.organizationId, organizationId), inArray(timeRecord.employeeId, employeeIds), gte(timeRecord.startAt, dayStart), lte(timeRecord.startAt, dayEnd), isNull(timeRecord.endAt)),
			});
		},

		async getApprovedAbsences({ organizationId, employeeIds, today }) {
			if (employeeIds.length === 0) return [];
			const rows = await db.query.absenceEntry.findMany({
				where: and(eq(absenceEntry.organizationId, organizationId), inArray(absenceEntry.employeeId, employeeIds), eq(absenceEntry.status, "approved"), lte(absenceEntry.startDate, today), gte(absenceEntry.endDate, today)),
				with: { employee: { with: { user: true, team: true } }, category: true },
			});
			return rows.map((row) => ({ id: row.id, employeeId: row.employeeId, employeeName: row.employee.user.name, teamName: row.employee.team?.name ?? null, categoryName: row.category.name, startDate: row.startDate, endDate: row.endDate, status: row.status }));
		},

		async getCoverageRules({ organizationId }) {
			const rows = await db.query.coverageRule.findMany({ where: eq(coverageRule.organizationId, organizationId), with: { subarea: true } });
			return rows.map((row) => ({ id: row.id, subareaId: row.subareaId, subareaName: row.subarea.name, dayOfWeek: row.dayOfWeek, startTime: row.startTime, endTime: row.endTime, minimumStaffCount: row.minimumStaffCount }));
		},

		async getOvertimeWarnings() {
			return [];
		},

		async getPayrollIssues({ organizationId }) {
			const mappings = await db.query.payrollWageTypeMapping.findMany({ with: { config: true } });
			const hasActiveMapping = mappings.some((mapping) => mapping.config.organizationId === organizationId && mapping.isActive);
			return hasActiveMapping ? [] : [{ id: "payroll:wage-mapping", category: "payroll", severity: "warning", title: "Payroll wage mappings need review", description: "No active wage mappings were found for this organization.", href: "/settings/payroll-readiness" }];
		},
	};
}
```

- [ ] **Step 4: Run loader tests**

Run: `pnpm --dir apps/webapp test src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts apps/webapp/src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts
git commit -m "feat: load manager daily briefing data"
```

## Task 3: Today Page UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/today/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/today/today-briefing.tsx`

- [ ] **Step 1: Add the server page**

Create `apps/webapp/src/app/[locale]/(app)/today/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { getCurrentEmployee } from "../team/actions";
import { getManagerDailyBriefing } from "@/lib/manager-daily-briefing/get-manager-daily-briefing";
import { TodayBriefing } from "./today-briefing";

export default async function TodayPage() {
	const currentEmployee = await getCurrentEmployee();

	if (!currentEmployee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view today&apos;s manager briefing" />
			</div>
		);
	}

	if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
		redirect("/");
	}

	const briefing = await getManagerDailyBriefing({ currentEmployee });

	return <TodayBriefing briefing={briefing} />;
}
```

- [ ] **Step 2: Add the server-rendered briefing layout**

Create `apps/webapp/src/app/[locale]/(app)/today/today-briefing.tsx` with a header, summary cards, Needs Action list, and section cards. Use `Card`, `Badge`, and `Button` from `@/components/ui`. Import `TodayApprovalsPanel` but pass only `briefing.sections.approvals.items` to it.

Use this shape for the main layout:

```tsx
import { IconAlertTriangle, IconArrowRight, IconCalendarOff, IconClock, IconShieldCheck } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefingActionItem, ManagerDailyBriefing } from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";
import { TodayApprovalsPanel } from "./today-approvals-panel";

export function TodayBriefing({ briefing }: { briefing: ManagerDailyBriefing }) {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<p className="text-sm font-medium text-primary">Today</p>
				<h1 className="text-3xl font-bold tracking-tight">Manager Daily Briefing</h1>
				<p className="text-muted-foreground">Operational exceptions and decisions that need attention today.</p>
			</div>
			<div className="grid gap-3 px-4 sm:grid-cols-2 xl:grid-cols-4 lg:px-6">
				<SummaryCard label="Critical issues" value={briefing.summary.criticalIssues} />
				<SummaryCard label="Open approvals" value={briefing.summary.openApprovals} />
				<SummaryCard label="Clock-in exceptions" value={briefing.summary.attendanceExceptions} />
				<SummaryCard label="Payroll issues" value={briefing.summary.payrollIssues} />
			</div>
			<div className="grid gap-6 px-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)] lg:px-6">
				<Card>
					<CardHeader>
						<CardTitle>Needs Action</CardTitle>
						<CardDescription>Highest-priority items across today&apos;s briefing.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{briefing.needsAction.length > 0 ? briefing.needsAction.map((item) => <ActionRow key={item.id} item={item} />) : <EmptyState title="All clear" description="No urgent manager actions were found for today." />}
					</CardContent>
				</Card>
				<TodayApprovalsPanel items={briefing.sections.approvals.items} error={briefing.sections.approvals.error} />
			</div>
			<div className="grid gap-6 px-4 lg:grid-cols-2 lg:px-6">
				<SectionCard section={briefing.sections.attendance} />
				<SectionCard section={briefing.sections.absences} />
				<SectionCard section={briefing.sections.coverage} />
				<SectionCard section={briefing.sections.overtime} />
				<SectionCard section={briefing.sections.payroll} />
			</div>
		</div>
	);
}
```

Add local `SummaryCard`, `ActionRow`, `SectionCard`, `SeverityBadge`, and `EmptyState` components in the same file. Keep them presentational and typed.

- [ ] **Step 3: Run type-aware tests for the route files**

Run: `pnpm --dir apps/webapp test --runInBand src/lib/manager-daily-briefing/__tests__/logic.test.ts src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`

Expected: PASS. If Vitest rejects `--runInBand`, rerun without it: `pnpm --dir apps/webapp test src/lib/manager-daily-briefing/__tests__/logic.test.ts src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`.

- [ ] **Step 4: Commit Task 3**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/today/page.tsx' 'apps/webapp/src/app/[locale]/(app)/today/today-briefing.tsx'
git commit -m "feat: add manager today briefing page"
```

## Task 4: Inline Approval Client Island

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.test.tsx`

- [ ] **Step 1: Write failing client tests**

Create `apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TodayApprovalsPanel } from "./today-approvals-panel";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("TodayApprovalsPanel", () => {
	beforeEach(() => {
		refreshMock.mockClear();
		global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }) as unknown as typeof fetch;
	});

	it("approves an item inline and refreshes the briefing", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		await userEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/approvals/inbox/approval-1/approve", { method: "POST" }));
		expect(refreshMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the row visible when approval fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ success: false, error: "Cannot approve" }) }) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		await userEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		expect(await screen.findByText("Vacation request")).toBeInTheDocument();
		expect(refreshMock).not.toHaveBeenCalled();
	});
});

function approvalItem() {
	return {
		id: "approval:approval-1",
		category: "approval" as const,
		severity: "warning" as const,
		title: "Vacation request",
		description: "Apr 28",
		href: "/approvals/inbox?types=absence_entry",
		approvalId: "approval-1",
		approvalType: "absence_entry" as const,
		entityId: "absence-1",
		requesterName: "Ada Lovelace",
		summary: "Vacation on Apr 28",
	};
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/today/today-approvals-panel.test.tsx'`

Expected: FAIL because `today-approvals-panel.tsx` does not exist.

- [ ] **Step 3: Implement the client panel**

Create `apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.tsx`:

```tsx
"use client";

import { IconCheck, IconExternalLink, IconLoader2, IconX } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefingApprovalActionItem } from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";

export function TodayApprovalsPanel({ items, error }: { items: BriefingApprovalActionItem[]; error?: string }) {
	const router = useRouter();
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [isRefreshing, startTransition] = useTransition();

	async function decide(item: BriefingApprovalActionItem, action: "approve" | "reject") {
		setPendingId(`${action}:${item.approvalId}`);
		const response = await fetch(`/api/approvals/inbox/${item.approvalId}/${action}`, { method: "POST" });
		const payload = (await response.json()) as { success?: boolean; error?: string };
		setPendingId(null);

		if (!payload.success) {
			toast.error(payload.error ?? `Could not ${action} approval`);
			return;
		}

		toast.success(action === "approve" ? "Approval accepted" : "Approval rejected");
		startTransition(() => router.refresh());
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-3">
					<div>
						<CardTitle>Approvals</CardTitle>
						<CardDescription>Simple decisions can be handled here.</CardDescription>
					</div>
					<Button asChild variant="outline" size="sm">
						<Link href="/approvals/inbox">
							Open inbox
							<IconExternalLink className="ml-2 size-4" aria-hidden="true" />
						</Link>
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
				{items.length === 0 && !error ? <p className="text-sm text-muted-foreground">No approvals pending.</p> : null}
				{items.map((item) => (
					<div key={item.id} className="rounded-lg border p-3">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<p className="font-medium">{item.title}</p>
									<Badge variant="secondary">{item.approvalType.replaceAll("_", " ")}</Badge>
								</div>
								<p className="text-sm text-muted-foreground">{item.requesterName} · {item.summary}</p>
							</div>
						</div>
						<div className="mt-3 flex flex-wrap gap-2">
							<Button size="sm" onClick={() => decide(item, "approve")} disabled={pendingId !== null || isRefreshing} aria-label={`Approve ${item.title}`}>
								{pendingId === `approve:${item.approvalId}` ? <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : <IconCheck className="mr-2 size-4" aria-hidden="true" />}
								Approve
							</Button>
							<Button size="sm" variant="outline" onClick={() => decide(item, "reject")} disabled={pendingId !== null || isRefreshing} aria-label={`Reject ${item.title}`}>
								<IconX className="mr-2 size-4" aria-hidden="true" />
								Reject
							</Button>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 4: Run client tests**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/today/today-approvals-panel.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.tsx' 'apps/webapp/src/app/[locale]/(app)/today/today-approvals-panel.test.tsx'
git commit -m "feat: add inline today approval actions"
```

## Task 5: Dashboard Entry Card

**Files:**
- Create: `apps/webapp/src/components/dashboard/manager-today-widget.tsx`
- Modify: `apps/webapp/src/components/dashboard/widget-registry.ts`
- Modify: `apps/webapp/src/components/section-cards.tsx`

- [ ] **Step 1: Add widget ID to registry**

Modify `apps/webapp/src/components/dashboard/widget-registry.ts`:

```ts
export type WidgetId =
	| "manager-today"
	| "managed-employees"
	| "pending-approvals"
	| "team-overview"
	| "quick-stats"
	| "whos-out-today"
	| "upcoming-time-off"
	| "recently-approved"
	| "birthday-reminders"
	| "hydration"
	| "vacation-balance"
	| "presence-status";

export const DEFAULT_WIDGET_ORDER: WidgetId[] = [
	"manager-today",
	"managed-employees",
	"pending-approvals",
	"team-overview",
	"quick-stats",
	"presence-status",
	"whos-out-today",
	"upcoming-time-off",
	"recently-approved",
	"birthday-reminders",
	"hydration",
	"vacation-balance",
];
```

- [ ] **Step 2: Add manager-only widget component**

Create `apps/webapp/src/components/dashboard/manager-today-widget.tsx`:

```tsx
"use client";

import { IconArrowRight, IconCalendarStats } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentEmployee } from "@/app/[locale]/(app)/team/actions";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

export function ManagerTodayWidget() {
	const employeeQuery = useQuery({
		queryKey: ["dashboard", "manager-today", "current-employee"],
		queryFn: getCurrentEmployee,
		staleTime: 60_000,
	});

	const role = employeeQuery.data?.role;
	if (!employeeQuery.isLoading && role !== "manager" && role !== "admin") return null;

	return (
		<DashboardWidget id="manager-today">
			<WidgetCard
				title="Today"
				description="Daily operational briefing for managers"
				icon={<IconCalendarStats className="size-4 text-primary" />}
				loading={employeeQuery.isLoading}
			>
				<div className="space-y-4">
					<p className="text-sm text-muted-foreground">
						Review absences, missing clock-ins, approvals, coverage risks, overtime, and payroll-impacting issues.
					</p>
					<Button asChild className="w-full">
						<Link href="/today">
							Open Today
							<IconArrowRight className="ml-2 size-4" aria-hidden="true" />
						</Link>
					</Button>
				</div>
			</WidgetCard>
		</DashboardWidget>
	);
}
```

- [ ] **Step 3: Register widget in SectionCards**

Modify `apps/webapp/src/components/section-cards.tsx`:

```tsx
import { ManagerTodayWidget } from "@/components/dashboard/manager-today-widget";

const WIDGET_COMPONENTS: Record<WidgetId, React.ComponentType> = {
	"manager-today": ManagerTodayWidget,
	"managed-employees": ManagedEmployeesWidget,
	"pending-approvals": PendingApprovalsWidget,
	"team-overview": TeamOverviewWidget,
	"quick-stats": QuickStatsWidget,
	"whos-out-today": WhosOutTodayWidget,
	"upcoming-time-off": UpcomingTimeOffWidget,
	"recently-approved": RecentlyApprovedWidget,
	"birthday-reminders": BirthdayRemindersWidget,
	hydration: HydrationWidget,
	"vacation-balance": VacationBalanceWidget,
	"presence-status": PresenceStatusWidget,
};
```

- [ ] **Step 4: Run targeted tests**

Run: `pnpm --dir apps/webapp test src/lib/manager-daily-briefing/__tests__/logic.test.ts src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/webapp/src/components/dashboard/manager-today-widget.tsx apps/webapp/src/components/dashboard/widget-registry.ts apps/webapp/src/components/section-cards.tsx
git commit -m "feat: add manager today dashboard entry"
```

## Task 6: Verification And Cleanup

**Files:**
- Modify only files that fail verification.

- [ ] **Step 1: Run all targeted Manager Daily Briefing tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/manager-daily-briefing/__tests__/logic.test.ts src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts 'src/app/[locale]/(app)/today/today-approvals-panel.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run webapp test suite**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `pnpm build:webapp`

Expected: PASS. If the build needs environment variables that are unavailable to agents, skip this command and record the exact missing variables in the final response.

- [ ] **Step 4: Manual UI checklist**

Start the app if environment access permits: `pnpm dev:webapp`.

Check:

- Dashboard shows the Today card for manager/admin users.
- Dashboard does not show the Today card for employee users.
- `/today` redirects employee users to `/`.
- `/today` shows a no-employee error when the session has no employee profile.
- Needs Action appears before supporting sections on mobile width.
- Inline approve keeps the row visible on API failure.
- Non-approval actions link to existing pages.

- [ ] **Step 5: Commit verification fixes**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize manager daily briefing"
```

If no fixes were needed, do not create an empty commit.

## Self-Review Notes

- Spec coverage: The plan covers `/today`, dashboard-only entry, manager/admin access, organization-scoped loader, published-shift-only attendance exceptions, inline approval actions, deep links for non-approval issues, section-level errors, empty states, and targeted verification.
- Placeholder scan: The plan contains concrete file paths, commands, and code shapes for each implementation task.
- Type consistency: Shared `BriefingActionItem`, `BriefingApprovalActionItem`, `ManagerDailyBriefing`, and `BriefingSources` names are used consistently across tasks.
