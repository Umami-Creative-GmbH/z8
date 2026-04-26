# Approval Performance Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded analytics approval rate with real, organization-scoped approval performance metrics across unified approvals and travel expense claims.

**Architecture:** Add a small pure helper module that normalizes approval-like rows and computes metrics, then use it from `AnalyticsService.getManagerEffectiveness`. Keep database access in the existing service and keep `analytics/page.tsx` as a thin client that renders returned metrics and bottlenecks.

**Tech Stack:** TypeScript, Next.js client page and server actions, Drizzle ORM, Effect services, Luxon for date math, Vitest and React Testing Library.

---

## File Structure

- Create: `apps/webapp/src/lib/analytics/approval-performance.ts`
  - Owns pure types and calculations for normalized approval analytics rows.
  - Does not import database schema or React.
- Create: `apps/webapp/src/lib/analytics/__tests__/approval-performance.test.ts`
  - Tests approval rate, decision time, grouping, travel expense inclusion semantics, draft exclusion semantics, and SLA warning behavior through pure helper inputs.
- Modify: `apps/webapp/src/lib/analytics/types.ts`
  - Extends `ManagerEffectivenessData` with decision-time and bottleneck fields.
- Modify: `apps/webapp/src/lib/effect/services/analytics.service.ts`
  - Fetches organization-scoped `approval_request` and `travel_expense_claim` rows.
  - Converts rows to normalized analytics rows and calls the helper.
- Create: `apps/webapp/src/app/[locale]/(app)/analytics/page.test.tsx`
  - Verifies the page requests manager effectiveness analytics and renders the real approval rate.
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/page.tsx`
  - Loads `getManagerEffectivenessData(dateRange)` and renders real KPI and compact bottlenecks.

## Task 1: Add Pure Approval Performance Calculations

**Files:**
- Create: `apps/webapp/src/lib/analytics/approval-performance.ts`
- Create: `apps/webapp/src/lib/analytics/__tests__/approval-performance.test.ts`

- [ ] **Step 1: Write failing tests for approval metrics**

Create `apps/webapp/src/lib/analytics/__tests__/approval-performance.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildApprovalPerformanceData } from "../approval-performance";

const baseSubmittedAt = new Date("2026-04-01T08:00:00.000Z");

describe("buildApprovalPerformanceData", () => {
	const baseRow = {
		source: "approval_request" as const,
		type: "absence_entry",
		organizationId: "org-1",
		requesterEmployeeId: "employee-1",
		requesterTeamId: "team-1",
		requesterTeamName: "Operations",
		approverEmployeeId: "manager-1",
		approverName: "Mina Manager",
		status: "approved" as const,
		submittedAt: baseSubmittedAt,
		decidedAt: new Date("2026-04-01T12:00:00.000Z"),
		slaStatus: "on_time" as const,
	};

	it("calculates approval rate from decided rows and excludes pending rows", () => {
		const result = buildApprovalPerformanceData([
			baseRow,
			{
				...baseRow,
				status: "rejected",
				decidedAt: new Date("2026-04-01T10:00:00.000Z"),
			},
			{
				...baseRow,
				status: "pending",
				decidedAt: null,
			},
		]);

		expect(result.approvalMetrics.totalApprovals).toBe(1);
		expect(result.approvalMetrics.totalRejections).toBe(1);
		expect(result.approvalMetrics.approvalRate).toBe(50);
	});

	it("calculates average decision time in hours from decidedAt and submittedAt", () => {
		const result = buildApprovalPerformanceData([
			baseRow,
			{
				...baseRow,
				decidedAt: new Date("2026-04-01T16:00:00.000Z"),
			},
		]);

		expect(result.approvalMetrics.avgDecisionTimeHours).toBe(6);
		expect(result.approvalMetrics.avgResponseTime).toBe(0.25);
	});

	it("counts pending SLA warnings for approaching and overdue rows", () => {
		const result = buildApprovalPerformanceData([
			{
				...baseRow,
				status: "pending",
				decidedAt: null,
				slaStatus: "approaching",
			},
			{
				...baseRow,
				status: "pending",
				decidedAt: null,
				slaStatus: "overdue",
			},
			{
				...baseRow,
				status: "pending",
				decidedAt: null,
				slaStatus: null,
			},
		]);

		expect(result.approvalMetrics.pendingSlaWarnings).toBe(2);
		expect(result.byManager[0]?.pendingSlaWarnings).toBe(2);
	});

	it("groups bottlenecks by manager, requester team, and approval type", () => {
		const result = buildApprovalPerformanceData([
			baseRow,
			{
				...baseRow,
				source: "travel_expense_claim",
				type: "travel_expense_claim",
				requesterTeamId: "team-2",
				requesterTeamName: "Field Sales",
				approverEmployeeId: "manager-2",
				approverName: "Tara Travel",
				status: "pending",
				decidedAt: null,
				slaStatus: "overdue",
			},
		]);

		expect(result.byManager.map((row) => row.managerName)).toEqual(["Tara Travel", "Mina Manager"]);
		expect(result.byTeam.map((row) => row.label)).toContain("Field Sales");
		expect(result.byType.map((row) => row.label)).toContain("Travel Expense Claim");
	});

	it("excludes draft-like rows before calculation", () => {
		const result = buildApprovalPerformanceData([
			baseRow,
			{
				...baseRow,
				source: "travel_expense_claim",
				type: "travel_expense_claim",
				status: "draft",
				decidedAt: null,
			},
		]);

		expect(result.approvalMetrics.totalApprovals).toBe(1);
		expect(result.byType).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/webapp test src/lib/analytics/__tests__/approval-performance.test.ts`

Expected: FAIL with an import error for `../approval-performance`.

- [ ] **Step 3: Implement the pure helper module**

Create `apps/webapp/src/lib/analytics/approval-performance.ts`:

```ts
import type { ManagerEffectivenessData } from "./types";

export type ApprovalAnalyticsStatus = "pending" | "approved" | "rejected" | "draft";
export type ApprovalAnalyticsSource = "approval_request" | "travel_expense_claim";
export type ApprovalAnalyticsSlaStatus = "on_time" | "approaching" | "overdue" | null;

export type ApprovalAnalyticsRow = {
	source: ApprovalAnalyticsSource;
	type: string;
	organizationId: string;
	requesterEmployeeId: string;
	requesterTeamId: string | null;
	requesterTeamName: string | null;
	approverEmployeeId: string | null;
	approverName: string | null;
	status: ApprovalAnalyticsStatus;
	submittedAt: Date;
	decidedAt: Date | null;
	slaStatus: ApprovalAnalyticsSlaStatus;
};

type GroupAccumulator = {
	id: string;
	label: string;
	approved: number;
	rejected: number;
	pending: number;
	pendingSlaWarnings: number;
	decisionTimeHours: number[];
};

function roundToTwoDecimals(value: number): number {
	return Math.round(value * 100) / 100;
}

function decisionTimeHours(row: ApprovalAnalyticsRow): number | null {
	if (!row.decidedAt) return null;
	return (row.decidedAt.getTime() - row.submittedAt.getTime()) / (1000 * 60 * 60);
}

function isSlaWarning(row: ApprovalAnalyticsRow): boolean {
	return row.status === "pending" && (row.slaStatus === "approaching" || row.slaStatus === "overdue");
}

function formatTypeLabel(type: string): string {
	return type
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function createGroup(id: string, label: string): GroupAccumulator {
	return {
		id,
		label,
		approved: 0,
		rejected: 0,
		pending: 0,
		pendingSlaWarnings: 0,
		decisionTimeHours: [],
	};
}

function addRowToGroup(group: GroupAccumulator, row: ApprovalAnalyticsRow): void {
	if (row.status === "approved") group.approved += 1;
	if (row.status === "rejected") group.rejected += 1;
	if (row.status === "pending") group.pending += 1;
	if (isSlaWarning(row)) group.pendingSlaWarnings += 1;

	const hours = decisionTimeHours(row);
	if (hours !== null) group.decisionTimeHours.push(hours);
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toBottleneckRow(group: GroupAccumulator) {
	const decided = group.approved + group.rejected;
	const avgDecisionTimeHours = roundToTwoDecimals(average(group.decisionTimeHours));

	return {
		id: group.id,
		label: group.label,
		approvedCount: group.approved,
		rejectedCount: group.rejected,
		pendingCount: group.pending,
		pendingSlaWarnings: group.pendingSlaWarnings,
		avgDecisionTimeHours,
		approvalRate: decided > 0 ? roundToTwoDecimals((group.approved / decided) * 100) : 0,
	};
}

function sortBottlenecks<T extends { pendingSlaWarnings: number; pendingCount: number; avgDecisionTimeHours: number }>(
	rows: T[],
): T[] {
	return rows.sort(
		(a, b) =>
			b.pendingSlaWarnings - a.pendingSlaWarnings ||
			b.pendingCount - a.pendingCount ||
			b.avgDecisionTimeHours - a.avgDecisionTimeHours,
	);
}

function groupRows(
	rows: ApprovalAnalyticsRow[],
	selectGroup: (row: ApprovalAnalyticsRow) => { id: string; label: string },
) {
	const groups = new Map<string, GroupAccumulator>();

	for (const row of rows) {
		const selected = selectGroup(row);
		const existing = groups.get(selected.id) ?? createGroup(selected.id, selected.label);
		addRowToGroup(existing, row);
		groups.set(selected.id, existing);
	}

	return sortBottlenecks(Array.from(groups.values()).map(toBottleneckRow));
}

export function buildApprovalPerformanceData(inputRows: ApprovalAnalyticsRow[]): ManagerEffectivenessData {
	const rows = inputRows.filter((row) => row.status !== "draft");
	const approvedRows = rows.filter((row) => row.status === "approved");
	const rejectedRows = rows.filter((row) => row.status === "rejected");
	const decisionTimes = rows.map(decisionTimeHours).filter((value): value is number => value !== null);
	const decidedCount = approvedRows.length + rejectedRows.length;
	const avgDecisionTimeHours = roundToTwoDecimals(average(decisionTimes));

	const byManagerGroups = groupRows(rows, (row) => ({
		id: row.approverEmployeeId ?? "unassigned",
		label: row.approverName ?? "Unassigned",
	}));

	return {
		approvalMetrics: {
			avgResponseTime: roundToTwoDecimals(avgDecisionTimeHours / 24),
			avgDecisionTimeHours,
			totalApprovals: approvedRows.length,
			totalRejections: rejectedRows.length,
			approvalRate: decidedCount > 0 ? roundToTwoDecimals((approvedRows.length / decidedCount) * 100) : 0,
			pendingSlaWarnings: rows.filter(isSlaWarning).length,
		},
		byManager: byManagerGroups.map((row) => ({
			managerId: row.id,
			managerName: row.label,
			avgResponseTime: roundToTwoDecimals(row.avgDecisionTimeHours / 24),
			avgDecisionTimeHours: row.avgDecisionTimeHours,
			totalApprovals: row.approvedCount,
			totalRejections: row.rejectedCount,
			approvalRate: row.approvalRate,
			teamSize: 0,
			pendingCount: row.pendingCount,
			pendingSlaWarnings: row.pendingSlaWarnings,
		})),
		byTeam: groupRows(rows, (row) => ({
			id: row.requesterTeamId ?? "unassigned",
			label: row.requesterTeamName ?? "Unassigned",
		})),
		byType: groupRows(rows, (row) => ({
			id: row.type,
			label: formatTypeLabel(row.type),
		})),
		responseTimeDistribution: buildResponseTimeDistribution(decisionTimes),
		trends: buildMonthlyTrends(rows),
	};
}

function buildResponseTimeDistribution(decisionTimes: number[]) {
	const buckets = [
		{ bucket: "< 1 day", count: 0 },
		{ bucket: "1-3 days", count: 0 },
		{ bucket: "3-7 days", count: 0 },
		{ bucket: "> 7 days", count: 0 },
	];

	for (const hours of decisionTimes) {
		if (hours < 24) buckets[0].count += 1;
		else if (hours <= 72) buckets[1].count += 1;
		else if (hours <= 168) buckets[2].count += 1;
		else buckets[3].count += 1;
	}

	return buckets.map((bucket) => ({
		...bucket,
		percentage: decisionTimes.length > 0 ? Math.round((bucket.count / decisionTimes.length) * 100) : 0,
	}));
}

function buildMonthlyTrends(rows: ApprovalAnalyticsRow[]) {
	const monthly = new Map<string, { approvals: number; rejections: number; decisionTimes: number[] }>();

	for (const row of rows) {
		const month = row.submittedAt.toISOString().slice(0, 7);
		const existing = monthly.get(month) ?? { approvals: 0, rejections: 0, decisionTimes: [] };
		if (row.status === "approved") existing.approvals += 1;
		if (row.status === "rejected") existing.rejections += 1;
		const hours = decisionTimeHours(row);
		if (hours !== null) existing.decisionTimes.push(hours);
		monthly.set(month, existing);
	}

	return Array.from(monthly.entries())
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([month, data]) => ({
			month,
			approvals: data.approvals,
			rejections: data.rejections,
			avgResponseTime: roundToTwoDecimals(average(data.decisionTimes) / 24),
			avgDecisionTimeHours: roundToTwoDecimals(average(data.decisionTimes)),
		}));
}
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm --dir apps/webapp test src/lib/analytics/__tests__/approval-performance.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit helper and tests**

Run:

```bash
git add apps/webapp/src/lib/analytics/approval-performance.ts apps/webapp/src/lib/analytics/__tests__/approval-performance.test.ts
git commit -m "feat: add approval performance calculations"
```

Expected: commit succeeds.

## Task 2: Extend Analytics Types

**Files:**
- Modify: `apps/webapp/src/lib/analytics/types.ts:143-170`
- Test: `apps/webapp/src/lib/analytics/__tests__/types.approval-performance.test.ts`

- [ ] **Step 1: Add type-level test for new analytics shape**

Create `apps/webapp/src/lib/analytics/__tests__/types.approval-performance.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { ManagerEffectivenessData } from "../types";

describe("ManagerEffectivenessData approval performance shape", () => {
	it("supports decision-time and bottleneck metrics", () => {
		const data = {
			approvalMetrics: {
				avgResponseTime: 0.25,
				avgDecisionTimeHours: 6,
				totalApprovals: 2,
				totalRejections: 1,
				approvalRate: 66.67,
				pendingSlaWarnings: 3,
			},
			byManager: [
				{
					managerId: "manager-1",
					managerName: "Mina Manager",
					avgResponseTime: 0.25,
					avgDecisionTimeHours: 6,
					totalApprovals: 2,
					totalRejections: 1,
					approvalRate: 66.67,
					teamSize: 4,
					pendingCount: 2,
					pendingSlaWarnings: 1,
				},
			],
			byTeam: [
				{
					id: "team-1",
					label: "Operations",
					approvedCount: 2,
					rejectedCount: 1,
					pendingCount: 2,
					pendingSlaWarnings: 1,
					avgDecisionTimeHours: 6,
					approvalRate: 66.67,
				},
			],
			byType: [
				{
					id: "absence_entry",
					label: "Absence Entry",
					approvedCount: 2,
					rejectedCount: 1,
					pendingCount: 2,
					pendingSlaWarnings: 1,
					avgDecisionTimeHours: 6,
					approvalRate: 66.67,
				},
			],
			responseTimeDistribution: [{ bucket: "< 1 day", count: 3, percentage: 100 }],
			trends: [
				{
					month: "2026-04",
					approvals: 2,
					rejections: 1,
					avgResponseTime: 0.25,
					avgDecisionTimeHours: 6,
				},
			],
		} satisfies ManagerEffectivenessData;

		expect(data.approvalMetrics.pendingSlaWarnings).toBe(3);
	});
});
```

- [ ] **Step 2: Run type test to verify it fails**

Run: `pnpm --dir apps/webapp test src/lib/analytics/__tests__/types.approval-performance.test.ts`

Expected: FAIL with TypeScript errors for missing fields in `ManagerEffectivenessData`.

- [ ] **Step 3: Extend `ManagerEffectivenessData`**

In `apps/webapp/src/lib/analytics/types.ts`, replace the `ManagerEffectivenessData` type with:

```ts
export type ApprovalBottleneckRow = {
	id: string;
	label: string;
	approvedCount: number;
	rejectedCount: number;
	pendingCount: number;
	pendingSlaWarnings: number;
	avgDecisionTimeHours: number;
	approvalRate: number;
};

export type ManagerEffectivenessData = {
	approvalMetrics: {
		avgResponseTime: number;
		avgDecisionTimeHours: number;
		totalApprovals: number;
		totalRejections: number;
		approvalRate: number;
		pendingSlaWarnings: number;
	};
	byManager: Array<{
		managerId: string;
		managerName: string;
		avgResponseTime: number;
		avgDecisionTimeHours: number;
		totalApprovals: number;
		totalRejections: number;
		approvalRate: number;
		teamSize: number;
		pendingCount: number;
		pendingSlaWarnings: number;
	}>;
	byTeam: ApprovalBottleneckRow[];
	byType: ApprovalBottleneckRow[];
	responseTimeDistribution: Array<{
		bucket: string;
		count: number;
		percentage: number;
	}>;
	trends: Array<{
		month: string;
		approvals: number;
		rejections: number;
		avgResponseTime: number;
		avgDecisionTimeHours: number;
	}>;
};
```

- [ ] **Step 4: Run analytics type and helper tests**

Run: `pnpm --dir apps/webapp test src/lib/analytics/__tests__/types.approval-performance.test.ts src/lib/analytics/__tests__/approval-performance.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit type changes**

Run:

```bash
git add apps/webapp/src/lib/analytics/types.ts apps/webapp/src/lib/analytics/__tests__/types.approval-performance.test.ts
git commit -m "feat: extend approval analytics types"
```

Expected: commit succeeds.

## Task 3: Use Real Approval Sources In AnalyticsService

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/analytics.service.ts:9-19`
- Modify: `apps/webapp/src/lib/effect/services/analytics.service.ts:912-1114`

- [ ] **Step 1: Run current analytics helper tests before service changes**

Run: `pnpm --dir apps/webapp test src/lib/analytics/__tests__/approval-performance.test.ts`

Expected: PASS.

- [ ] **Step 2: Update imports in `analytics.service.ts`**

Add `inArray` to the Drizzle imports and add travel expense schema plus helper imports:

```ts
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
	absenceEntry,
	approvalRequest,
	employee,
	employeeCostCenterAssignment,
	employeeManagers,
	travelExpenseClaim,
	workPeriod,
} from "@/db/schema";
import {
	buildApprovalPerformanceData,
	type ApprovalAnalyticsRow,
} from "@/lib/analytics/approval-performance";
import { calculateSLADeadline, calculateSLAStatus } from "@/lib/approvals/domain/sla-calculator";
import type { ApprovalPriority, ApprovalType } from "@/lib/approvals/domain/types";
```

- [ ] **Step 3: Replace `getManagerEffectiveness` implementation**

Replace the body of `getManagerEffectiveness: (params: ManagerEffectivenessParams) => Effect.gen(...)` with this implementation:

```ts
getManagerEffectiveness: (params: ManagerEffectivenessParams) =>
	Effect.gen(function* (_) {
		const { organizationId, dateRange, managerId } = params;

		const approvalRequests = yield* _(
			dbService.query("getApprovalRequestsForEffectiveness", async () => {
				return await dbService.db.query.approvalRequest.findMany({
					where: and(
						eq(approvalRequest.organizationId, organizationId),
						gte(approvalRequest.createdAt, dateRange.start),
						lte(approvalRequest.createdAt, dateRange.end),
						managerId ? eq(approvalRequest.approverId, managerId) : undefined,
					),
					with: {
						approver: { with: { user: true } },
						requester: { with: { user: true, team: true } },
					},
				});
			}),
		);

		const travelClaims = yield* _(
			dbService.query("getTravelExpenseClaimsForEffectiveness", async () => {
				return await dbService.db.query.travelExpenseClaim.findMany({
					where: and(
						eq(travelExpenseClaim.organizationId, organizationId),
						gte(travelExpenseClaim.submittedAt, dateRange.start),
						lte(travelExpenseClaim.submittedAt, dateRange.end),
						inArray(travelExpenseClaim.status, ["submitted", "approved", "rejected"]),
						managerId ? eq(travelExpenseClaim.approverId, managerId) : undefined,
					),
					with: {
						employee: { with: { user: true, team: true } },
						approver: { with: { user: true } },
					},
				});
			}),
		);

		const approvalRows: ApprovalAnalyticsRow[] = approvalRequests.map((request) => {
			const type = request.entityType as ApprovalType;
			const slaDeadline = calculateSLADeadline(type, "normal" satisfies ApprovalPriority, request.createdAt);
			const slaStatus = request.status === "pending" ? calculateSLAStatus(slaDeadline).status : null;

			return {
				source: "approval_request",
				type: request.entityType,
				organizationId: request.organizationId,
				requesterEmployeeId: request.requestedBy,
				requesterTeamId: request.requester?.teamId ?? null,
				requesterTeamName: request.requester?.team?.name ?? null,
				approverEmployeeId: request.approverId,
				approverName: request.approver?.user.name ?? null,
				status: request.status,
				submittedAt: request.createdAt,
				decidedAt: request.approvedAt,
				slaStatus,
			};
		});

		const travelRows: ApprovalAnalyticsRow[] = travelClaims
			.filter((claim) => claim.submittedAt !== null)
			.map((claim) => {
				const slaDeadline = calculateSLADeadline(
					"travel_expense_claim",
					"normal" satisfies ApprovalPriority,
					claim.submittedAt!,
				);
				const status = claim.status === "submitted" ? "pending" : claim.status;
				const slaStatus = status === "pending" ? calculateSLAStatus(slaDeadline).status : null;

				return {
					source: "travel_expense_claim",
					type: "travel_expense_claim",
					organizationId: claim.organizationId,
					requesterEmployeeId: claim.employeeId,
					requesterTeamId: claim.employee?.teamId ?? null,
					requesterTeamName: claim.employee?.team?.name ?? null,
					approverEmployeeId: claim.approverId,
					approverName: claim.approver?.user.name ?? null,
					status,
					submittedAt: claim.submittedAt!,
					decidedAt: claim.decidedAt,
					slaStatus,
				};
			});

		const data = buildApprovalPerformanceData([...approvalRows, ...travelRows]);

		const managerIds = data.byManager
			.map((row) => row.managerId)
			.filter((id) => id !== "unassigned");

		const teamSizes = yield* _(
			dbService.query("getApprovalAnalyticsTeamSizes", async () => {
				if (managerIds.length === 0) return [];
				return await dbService.db
					.select({
						managerId: employeeManagers.managerId,
						count: sql<number>`count(*)::int`,
					})
					.from(employeeManagers)
					.where(inArray(employeeManagers.managerId, managerIds))
					.groupBy(employeeManagers.managerId);
			}),
		);

		const teamSizeMap = new Map(teamSizes.map((row) => [row.managerId, row.count]));

		return {
			...data,
			byManager: data.byManager.map((row) => ({
				...row,
				teamSize: teamSizeMap.get(row.managerId) ?? 0,
			})),
		};
	}),
```

- [ ] **Step 4: Fix type errors from unsupported SLA type if needed**

If TypeScript rejects `"travel_expense_claim"` for `calculateSLADeadline`, update `apps/webapp/src/lib/approvals/domain/sla-calculator.ts` default rules by adding normal travel expense defaults after the time correction rules:

```ts
	{
		approvalType: "travel_expense_claim",
		priority: "normal",
		deadlineHours: 48,
		escalationEnabled: true,
	},
	{
		approvalType: "travel_expense_claim",
		priority: "high",
		deadlineHours: 24,
		escalationEnabled: true,
	},
	{
		approvalType: "travel_expense_claim",
		priority: "urgent",
		deadlineHours: 8,
		escalationEnabled: true,
	},
	{
		approvalType: "travel_expense_claim",
		priority: "low",
		deadlineHours: 72,
		escalationEnabled: false,
	},
```

- [ ] **Step 5: Run targeted tests**

Run: `pnpm --dir apps/webapp test src/lib/analytics/__tests__/approval-performance.test.ts src/lib/analytics/__tests__/types.approval-performance.test.ts`

Expected: PASS.

- [ ] **Step 6: Run TypeScript/build check for service integration**

Run: `pnpm --dir apps/webapp build`

Expected: build completes without TypeScript errors. If it fails because environment variables are unavailable, stop the build and record the exact missing variable message in the final verification notes.

- [ ] **Step 7: Commit service integration**

Run:

```bash
git add apps/webapp/src/lib/effect/services/analytics.service.ts apps/webapp/src/lib/approvals/domain/sla-calculator.ts
git commit -m "feat: include approval sources in analytics"
```

Expected: commit succeeds. If `sla-calculator.ts` was not changed, omit it from `git add`.

## Task 4: Render Real Approval Analytics On Overview Page

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/analytics/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/page.tsx:20-67`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/page.tsx:145-154`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/page.tsx:222-223`

- [ ] **Step 1: Write failing page test**

Create `apps/webapp/src/app/[locale]/(app)/analytics/page.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getTeamPerformanceDataMock, getAbsencePatternsDataMock, getManagerEffectivenessDataMock } = vi.hoisted(
	() => ({
		getTeamPerformanceDataMock: vi.fn(),
		getAbsencePatternsDataMock: vi.fn(),
		getManagerEffectivenessDataMock: vi.fn(),
	}),
);

vi.mock("next/dynamic", () => ({
	default: () => () => null,
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn() },
}));

vi.mock("@/components/analytics/export-button", () => ({
	ExportButton: () => <button type="button">Export</button>,
}));

vi.mock("@/components/reports/date-range-picker", () => ({
	DateRangePicker: () => <div>Date range</div>,
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/chart", () => ({
	ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ChartTooltip: () => null,
	ChartTooltipContent: () => null,
}));

vi.mock("./actions", () => ({
	getTeamPerformanceData: getTeamPerformanceDataMock,
	getAbsencePatternsData: getAbsencePatternsDataMock,
	getManagerEffectivenessData: getManagerEffectivenessDataMock,
}));

import AnalyticsOverviewPage from "./page";

describe("AnalyticsOverviewPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getTeamPerformanceDataMock.mockResolvedValue({
			success: true,
			data: { teams: [], organizationTotal: 0, dateRange: { start: new Date(), end: new Date() } },
		});
		getAbsencePatternsDataMock.mockResolvedValue({
			success: true,
			data: {
				summary: { totalAbsences: 0, totalDays: 0, avgDaysPerAbsence: 0, absenceRate: 0 },
				byType: [],
				byTeam: [],
				patterns: {
					sickLeavePatterns: { avgDuration: 0, peakMonths: [], frequentEmployees: [] },
					vacationClustering: { score: 0, hotspots: [] },
				},
				timeline: [],
			},
		});
		getManagerEffectivenessDataMock.mockResolvedValue({
			success: true,
			data: {
				approvalMetrics: {
					avgResponseTime: 0.25,
					avgDecisionTimeHours: 6,
					totalApprovals: 8,
					totalRejections: 2,
					approvalRate: 80,
					pendingSlaWarnings: 3,
				},
				byManager: [],
				byTeam: [{ id: "team-1", label: "Operations", approvedCount: 8, rejectedCount: 2, pendingCount: 4, pendingSlaWarnings: 3, avgDecisionTimeHours: 6, approvalRate: 80 }],
				byType: [],
				responseTimeDistribution: [],
				trends: [],
			},
		});
	});

	it("renders approval rate from manager effectiveness analytics", async () => {
		render(<AnalyticsOverviewPage />);

		await waitFor(() => {
			expect(getManagerEffectivenessDataMock).toHaveBeenCalled();
		});

		expect(screen.getByText("80.0%")).toBeTruthy();
		expect(screen.getByText("Of decided requests approved")).toBeTruthy();
		expect(screen.getByText("Approval Bottlenecks")).toBeTruthy();
		expect(screen.getByText("Operations")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run page test to verify it fails**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/analytics/page.test.tsx'`

Expected: FAIL because `getManagerEffectivenessData` is not imported or rendered by the page.

- [ ] **Step 3: Update page state and data loading**

In `apps/webapp/src/app/[locale]/(app)/analytics/page.tsx`, update imports and state:

```tsx
import type { AbsencePatternsData, ManagerEffectivenessData, TeamPerformanceData } from "@/lib/analytics/types";
import { getAbsencePatternsData, getManagerEffectivenessData, getTeamPerformanceData } from "./actions";

const [managerData, setManagerData] = useState<ManagerEffectivenessData | null>(null);
```

Replace the `Promise.all` block with:

```tsx
const [teamResult, absenceResult, managerResult] = await Promise.all([
	getTeamPerformanceData(dateRange),
	getAbsencePatternsData(dateRange),
	getManagerEffectivenessData(dateRange),
]);

if (teamResult.success && teamResult.data) {
	setTeamData(teamResult.data);
}
if (absenceResult.success && absenceResult.data) {
	setAbsenceData(absenceResult.data);
}
if (managerResult.success && managerResult.data) {
	setManagerData(managerResult.data);
} else {
	setManagerData(null);
}
```

Replace the approval KPI calculation with:

```tsx
approvalRate: managerData?.approvalMetrics.approvalRate ?? 0,
```

- [ ] **Step 4: Update KPI helper text and add bottleneck rows**

Change the Approval Rate helper text to:

```tsx
<p className="text-xs text-muted-foreground">Of decided requests approved</p>
```

Add this card after the existing chart grid and before the closing fragment:

```tsx
<Card>
	<CardHeader>
		<CardTitle>Approval Bottlenecks</CardTitle>
		<CardDescription>Pending approvals with SLA warnings by team and type</CardDescription>
	</CardHeader>
	<CardContent>
		{managerData && (managerData.byTeam.length > 0 || managerData.byType.length > 0) ? (
			<div className="grid gap-4 md:grid-cols-2">
				<BottleneckList title="Teams" rows={managerData.byTeam.slice(0, 5)} />
				<BottleneckList title="Types" rows={managerData.byType.slice(0, 5)} />
			</div>
		) : (
			<div className="py-8 text-center text-muted-foreground">No approval bottlenecks found</div>
		)}
	</CardContent>
</Card>
```

Add this local component below the page component in the same file:

```tsx
function BottleneckList({
	title,
	rows,
}: {
	title: string;
	rows: NonNullable<ManagerEffectivenessData["byTeam"]>;
}) {
	return (
		<div className="space-y-3">
			<h3 className="font-medium text-sm">{title}</h3>
			{rows.length > 0 ? (
				<div className="space-y-2">
					{rows.map((row) => (
						<div key={row.id} className="flex items-center justify-between rounded-lg border p-3">
							<div>
								<div className="font-medium text-sm">{row.label}</div>
								<div className="text-muted-foreground text-xs">
									{row.pendingCount} pending · {row.avgDecisionTimeHours.toFixed(1)}h avg decision
								</div>
							</div>
							<div className="text-right">
								<div className="font-semibold text-amber-600 text-sm">{row.pendingSlaWarnings}</div>
								<div className="text-muted-foreground text-xs">SLA warnings</div>
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="rounded-lg border p-3 text-muted-foreground text-sm">No bottlenecks</div>
			)}
		</div>
	);
}
```

- [ ] **Step 5: Run page test**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/analytics/page.test.tsx'`

Expected: PASS.

- [ ] **Step 6: Commit page integration**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/analytics/page.tsx' 'apps/webapp/src/app/[locale]/(app)/analytics/page.test.tsx'
git commit -m "feat: show approval performance analytics"
```

Expected: commit succeeds.

## Task 5: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run targeted analytics tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/analytics/__tests__/approval-performance.test.ts src/lib/analytics/__tests__/types.approval-performance.test.ts 'src/app/[locale]/(app)/analytics/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run full webapp tests**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

- [ ] **Step 3: Run build if environment permits**

Run: `pnpm --dir apps/webapp build`

Expected: PASS. If build fails because Phase-managed environment variables are unavailable to agents, record the exact skipped build reason and do not change environment configuration.

- [ ] **Step 4: Inspect git status**

Run: `git status --short`

Expected: no uncommitted files from this implementation. If test snapshots or generated files appear, inspect them and commit only files directly caused by this work.

- [ ] **Step 5: Final commit if verification fixes were needed**

If Task 5 required fixes, commit them:

```bash
git add <changed-files>
git commit -m "fix: stabilize approval analytics verification"
```

Expected: commit succeeds. If there were no fixes, skip this step.

## Self-Review Notes

- Spec coverage: Tasks cover the normalized row, approval rate, decision time, manager/team/type bottlenecks, SLA warnings, UI rendering, error/empty-state behavior, and tests.
- Placeholder scan: The plan contains concrete files, commands, and code snippets for each implementation step.
- Type consistency: `avgDecisionTimeHours`, `pendingSlaWarnings`, `byTeam`, and `byType` are introduced in Task 2 and used consistently in later tasks.
