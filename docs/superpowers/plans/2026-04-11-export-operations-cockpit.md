# Export Operations Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org-admin export operations cockpit that gives one organization-scoped view of export failures, upcoming scheduled runs, and recent payroll/audit/scheduled activity while keeping detailed setup on the existing export pages.

**Architecture:** Add a new settings route at `/settings/export-operations`, back it with a dedicated read-only cockpit query module under `src/lib/export-operations`, and render the result through one display-only dashboard component. Keep all writes and detailed history in the existing `/settings/payroll-export`, `/settings/scheduled-exports`, and `/settings/audit-export` routes.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, Luxon, Vitest, Testing Library, Tolgee server translations, shadcn/ui components.

---

## File Structure

- Create: `apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx`
  Purpose: new org-admin settings route shell for the cockpit.
- Create: `apps/webapp/src/components/settings/export-operations/export-operations-dashboard.tsx`
  Purpose: display-only summary cards, alerts, upcoming runs, and recent activity.
- Create: `apps/webapp/src/components/settings/export-operations/export-operations-dashboard.test.tsx`
  Purpose: UI rendering coverage for deep links, empty states, and scoped errors.
- Create: `apps/webapp/src/lib/export-operations/get-export-operations-cockpit.ts`
  Purpose: org-scoped read model that aggregates payroll, scheduled export, and audit sources into one normalized cockpit payload.
- Create: `apps/webapp/src/lib/export-operations/__tests__/get-export-operations-cockpit.test.ts`
  Purpose: unit coverage for alert derivation, activity ordering, partial failure handling, and org scoping.
- Modify: `apps/webapp/src/lib/settings-access.ts`
  Purpose: register `/settings/export-operations` as an org-admin settings route.
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
  Purpose: add the new settings navigation entry in the `data` group.
- Modify: `apps/webapp/src/components/settings/settings-config.test.ts`
  Purpose: keep org-admin menu expectations aligned with the new cockpit entry.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
  Purpose: keep the approved org-admin route sweep aligned and verify the new page uses org-admin access.

### Task 1: Register The Route And Org-Admin Navigation

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx`
- Modify: `apps/webapp/src/lib/settings-access.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`
- Test: `apps/webapp/src/components/settings/settings-config.test.ts`

- [ ] **Step 1: Write the failing route and menu tests**

Update `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts` so the route sweep and source-level access checks include the new cockpit page:

```ts
const ORG_ADMIN_ROUTE_FILES = [
	"billing/page.tsx",
	"avv/page.tsx",
	"roles/page.tsx",
	"travel-expenses/page.tsx",
	"enterprise/domains/page.tsx",
	"enterprise/email/page.tsx",
	"enterprise/api-keys/page.tsx",
	"enterprise/audit-log/page.tsx",
	"telegram/page.tsx",
	"webhooks/page.tsx",
	"export/page.tsx",
	"payroll-export/page.tsx",
	"audit-export/page.tsx",
	"demo/page.tsx",
	"import/page.tsx",
	"scheduled-exports/page.tsx",
	"export-operations/page.tsx",
] as const;

expect(ORG_ADMIN_SETTINGS_ROUTES).toEqual([
	"/settings/billing",
	"/settings/avv",
	"/settings/roles",
	"/settings/travel-expenses",
	"/settings/enterprise/domains",
	"/settings/enterprise/email",
	"/settings/enterprise/api-keys",
	"/settings/enterprise/audit-log",
	"/settings/telegram",
	"/settings/webhooks",
	"/settings/export",
	"/settings/payroll-export",
	"/settings/audit-export",
	"/settings/demo",
	"/settings/import",
	"/settings/scheduled-exports",
	"/settings/export-operations",
]);

it("keeps the export operations page on org-admin access helpers", () => {
	const source = stripComments(
		readFileSync(join(SETTINGS_ROOT, "export-operations/page.tsx"), "utf8"),
	);

	expect(source.includes("requireOrgAdminSettingsAccess(")).toBe(true);
	expect(source.includes("getCurrentSettingsRouteContext(")).toBe(false);
});
```

Update `apps/webapp/src/components/settings/settings-config.test.ts` so org admins are expected to see the new entry:

```ts
it("shows export operations for org admins", () => {
	const entries = getVisibleSettings("orgAdmin", false);

	expect(entries.some((entry) => entry.id === "export-operations")).toBe(true);
	expect(entries.some((entry) => entry.href === "/settings/export-operations")).toBe(true);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
pnpm --filter webapp test -- --run "src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts" "src/components/settings/settings-config.test.ts"
```

Expected: FAIL because `/settings/export-operations` is missing from `ORG_ADMIN_SETTINGS_ROUTES`, the settings menu does not include `export-operations`, and `settings/export-operations/page.tsx` does not exist yet.

- [ ] **Step 3: Implement the route registration and minimal page shell**

Update `apps/webapp/src/lib/settings-access.ts`:

```ts
export const ORG_ADMIN_SETTINGS_ROUTES = [
	"/settings/billing",
	"/settings/avv",
	"/settings/roles",
	"/settings/travel-expenses",
	"/settings/enterprise/domains",
	"/settings/enterprise/email",
	"/settings/enterprise/api-keys",
	"/settings/enterprise/audit-log",
	"/settings/telegram",
	"/settings/webhooks",
	"/settings/export",
	"/settings/payroll-export",
	"/settings/audit-export",
	"/settings/demo",
	"/settings/import",
	"/settings/scheduled-exports",
	"/settings/export-operations",
] as const;
```

Update `apps/webapp/src/components/settings/settings-config.ts` near the existing export-related entries:

```ts
{
	id: "export-operations",
	titleKey: "settings.exportOperations.title",
	titleDefault: "Export Operations",
	descriptionKey: "settings.exportOperations.description",
	descriptionDefault: "Monitor payroll, audit, and scheduled export activity",
	href: "/settings/export-operations",
	icon: "history",
	minimumTier: "orgAdmin",
	group: "data",
},
```

Create `apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx` with a minimal org-admin page shell:

```tsx
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function ExportOperationsPage() {
	const [t] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.exportOperations.title", "Export Operations")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.exportOperations.description",
						"Monitor payroll, audit, and scheduled export activity for your organization.",
					)}
				</p>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run:

```bash
pnpm --filter webapp test -- --run "src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts" "src/components/settings/settings-config.test.ts"
```

Expected: PASS for both test files.

- [ ] **Step 5: Commit the route registration**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx apps/webapp/src/lib/settings-access.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "feat: add export operations settings entry"
```

### Task 2: Build The Export Operations Read Model

**Files:**
- Create: `apps/webapp/src/lib/export-operations/get-export-operations-cockpit.ts`
- Test: `apps/webapp/src/lib/export-operations/__tests__/get-export-operations-cockpit.test.ts`

- [ ] **Step 1: Write the failing read-model tests**

Create `apps/webapp/src/lib/export-operations/__tests__/get-export-operations-cockpit.test.ts`:

```ts
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getExportJobHistory: vi.fn(),
	scheduledExportFindMany: vi.fn(),
	scheduledExecutionFindMany: vi.fn(),
	auditConfigFindFirst: vi.fn(),
	auditPackageFindMany: vi.fn(),
	auditPackListRequests: vi.fn(),
}));

vi.mock("@/lib/payroll-export", () => ({
	getExportJobHistory: mockState.getExportJobHistory,
}));

vi.mock("@/lib/audit-pack/application/request-repository", () => ({
	auditPackRequestRepository: {
		listRequests: mockState.auditPackListRequests,
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			scheduledExport: {
				findMany: mockState.scheduledExportFindMany,
			},
			scheduledExportExecution: {
				findMany: mockState.scheduledExecutionFindMany,
			},
			auditExportConfig: {
				findFirst: mockState.auditConfigFindFirst,
			},
			auditExportPackage: {
				findMany: mockState.auditPackageFindMany,
			},
		},
	},
}));

const { getExportOperationsCockpit } = await import("../get-export-operations-cockpit");

describe("getExportOperationsCockpit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds alerts, upcoming runs, and recent activity from payroll, scheduled, and audit sources", async () => {
		mockState.getExportJobHistory.mockResolvedValue([
			{
				id: "pay-1",
				status: "failed",
				fileName: null,
				fileSizeBytes: null,
				workPeriodCount: null,
				employeeCount: null,
				createdAt: new Date("2026-04-10T08:00:00.000Z"),
				completedAt: new Date("2026-04-10T08:03:00.000Z"),
				errorMessage: "DATEV credentials expired",
				filters: {
					dateRange: {
						start: "2026-04-01T00:00:00.000Z",
						end: "2026-04-30T23:59:59.999Z",
					},
				},
			},
		]);

		mockState.scheduledExportFindMany.mockResolvedValue([
			{
				id: "sched-1",
				organizationId: "org-1",
				name: "Monthly Payroll",
				reportType: "payroll_export",
				payrollConfigId: null,
				isActive: true,
				createdAt: new Date("2026-03-30T00:00:00.000Z"),
				updatedAt: new Date("2026-04-10T09:00:00.000Z"),
				nextExecutionAt: new Date("2026-04-12T00:00:00.000Z"),
				lastExecutionAt: new Date("2026-04-01T00:05:00.000Z"),
			},
		]);

		mockState.scheduledExecutionFindMany.mockResolvedValue([
			{
				id: "exec-1",
				scheduledExportId: "sched-1",
				status: "failed",
				triggeredAt: new Date("2026-04-10T09:05:00.000Z"),
				completedAt: new Date("2026-04-10T09:06:00.000Z"),
				errorMessage: "No payroll config attached",
			},
		]);

		mockState.auditConfigFindFirst.mockResolvedValue({
			organizationId: "org-1",
			isEnabled: true,
		});

		mockState.auditPackageFindMany.mockResolvedValue([
			{
				id: "pkg-1",
				exportType: "audit_pack",
				status: "completed",
				createdAt: new Date("2026-04-10T10:00:00.000Z"),
				completedAt: new Date("2026-04-10T10:01:00.000Z"),
				fileSizeBytes: 4096,
			},
		]);

		mockState.auditPackListRequests.mockResolvedValue([
			{
				id: "req-1",
				organizationId: "org-1",
				status: "failed",
				startDate: new Date("2026-04-01T00:00:00.000Z"),
				endDate: new Date("2026-04-07T23:59:59.999Z"),
				errorCode: "hardening_failed",
				errorMessage: "Timestamp authority unavailable",
				createdAt: new Date("2026-04-10T11:00:00.000Z"),
				completedAt: new Date("2026-04-10T11:02:00.000Z"),
				artifact: null,
			},
		]);

		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(result.coverageSummary.activeSchedules).toBe(1);
		expect(result.coverageSummary.failedRunsLast7Days).toBe(3);
		expect(result.alerts.map((alert) => alert.title)).toEqual([
			"Payroll export failed",
			"Scheduled export is blocked",
			"Audit pack failed",
		]);
		expect(result.upcomingRuns).toEqual([
			expect.objectContaining({
				id: "sched-1",
				name: "Monthly Payroll",
				lastExecutionStatus: "failed",
				href: "/settings/scheduled-exports",
			}),
		]);
		expect(result.recentActivity[0]).toEqual(
			expect.objectContaining({
				id: "req-1",
				kind: "audit",
				status: "failed",
				href: "/settings/audit-export",
			}),
		);
		expect(result.errors.upcomingRuns).toBeNull();
	});

	it("keeps payroll data visible when scheduled export queries fail", async () => {
		mockState.getExportJobHistory.mockResolvedValue([
			{
				id: "pay-2",
				status: "completed",
				fileName: "datev-april.csv",
				fileSizeBytes: 2048,
				workPeriodCount: 20,
				employeeCount: 4,
				createdAt: new Date("2026-04-09T08:00:00.000Z"),
				completedAt: new Date("2026-04-09T08:02:00.000Z"),
				errorMessage: null,
				filters: {
					dateRange: {
						start: "2026-04-01T00:00:00.000Z",
						end: "2026-04-30T23:59:59.999Z",
					},
				},
			},
		]);

		mockState.scheduledExportFindMany.mockRejectedValue(new Error("scheduled export db unavailable"));
		mockState.scheduledExecutionFindMany.mockRejectedValue(new Error("scheduled execution db unavailable"));
		mockState.auditConfigFindFirst.mockResolvedValue(null);
		mockState.auditPackageFindMany.mockResolvedValue([]);
		mockState.auditPackListRequests.mockResolvedValue([]);

		const result = await getExportOperationsCockpit(
			"org-1",
			DateTime.fromISO("2026-04-11T12:00:00.000Z"),
		);

		expect(result.recentActivity).toEqual([
			expect.objectContaining({
				id: "pay-2",
				kind: "payroll",
				status: "completed",
			}),
		]);
		expect(result.upcomingRuns).toEqual([]);
		expect(result.errors.upcomingRuns).toBe("Scheduled export data is temporarily unavailable.");
		expect(result.errors.recentActivity).toBe("Some activity data is temporarily unavailable.");
	});
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run:

```bash
pnpm --filter webapp test -- --run "src/lib/export-operations/__tests__/get-export-operations-cockpit.test.ts"
```

Expected: FAIL because `src/lib/export-operations/get-export-operations-cockpit.ts` does not exist yet.

- [ ] **Step 3: Implement the read-only cockpit query module**

Create `apps/webapp/src/lib/export-operations/get-export-operations-cockpit.ts`:

```ts
import { DateTime } from "luxon";
import { asc, desc, eq } from "drizzle-orm";
import { db, auditExportPackage, scheduledExport, scheduledExportExecution } from "@/db";
import { auditPackRequestRepository } from "@/lib/audit-pack/application/request-repository";
import { getExportJobHistory } from "@/lib/payroll-export";

export interface ExportOperationsCoverageSummary {
	activeSchedules: number;
	failedRunsLast7Days: number;
	lastPayrollExportAt: Date | null;
	lastAuditPackageAt: Date | null;
}

export interface ExportOperationsAlert {
	id: string;
	title: string;
	description: string;
	severity: "critical" | "warning";
	href: string;
	occurredAt: Date | null;
}

export interface ExportOperationsUpcomingRun {
	id: string;
	name: string;
	reportType: "payroll_export" | "data_export" | "audit_report";
	nextExecutionAt: Date;
	lastExecutionStatus: "completed" | "failed" | "pending" | "never";
	href: string;
}

export interface ExportOperationsActivityItem {
	id: string;
	kind: "payroll" | "scheduled" | "audit";
	status: string;
	title: string;
	detail: string;
	occurredAt: Date;
	href: string;
}

export interface ExportOperationsCockpitData {
	coverageSummary: ExportOperationsCoverageSummary;
	alerts: ExportOperationsAlert[];
	upcomingRuns: ExportOperationsUpcomingRun[];
	recentActivity: ExportOperationsActivityItem[];
	errors: {
		summary: string | null;
		alerts: string | null;
		upcomingRuns: string | null;
		recentActivity: string | null;
	};
}

async function getScheduledSource(organizationId: string) {
	const [schedules, executions] = await Promise.all([
		db.query.scheduledExport.findMany({
			where: eq(scheduledExport.organizationId, organizationId),
			orderBy: [asc(scheduledExport.nextExecutionAt)],
		}),
		db.query.scheduledExportExecution.findMany({
			where: eq(scheduledExportExecution.organizationId, organizationId),
			orderBy: [desc(scheduledExportExecution.triggeredAt)],
			limit: 25,
		}),
	]);

	return { schedules, executions };
}

async function getAuditSource(organizationId: string) {
	const [packages, requests] = await Promise.all([
		db.query.auditExportPackage.findMany({
			where: eq(auditExportPackage.organizationId, organizationId),
			orderBy: [desc(auditExportPackage.createdAt)],
			limit: 10,
		}),
		auditPackRequestRepository.listRequests({ organizationId, limit: 10 }),
	]);

	return { packages, requests };
}

export async function getExportOperationsCockpit(
	organizationId: string,
	now: DateTime = DateTime.utc(),
): Promise<ExportOperationsCockpitData> {
	const [payrollResult, scheduledResult, auditResult] = await Promise.allSettled([
		getExportJobHistory(organizationId, 10),
		getScheduledSource(organizationId),
		getAuditSource(organizationId),
	]);

	const payrollJobs = payrollResult.status === "fulfilled" ? payrollResult.value : [];
	const scheduledSource = scheduledResult.status === "fulfilled"
		? scheduledResult.value
		: { schedules: [], executions: [] };
	const auditSource = auditResult.status === "fulfilled"
		? auditResult.value
		: { packages: [], requests: [] };

	const executionByScheduleId = new Map(
		scheduledSource.executions.map((execution) => [execution.scheduledExportId, execution]),
	);

	const alerts: ExportOperationsAlert[] = [];

	const latestFailedPayroll = payrollJobs.find((job) => job.status === "failed");
	if (latestFailedPayroll) {
		alerts.push({
			id: `payroll-${latestFailedPayroll.id}`,
			title: "Payroll export failed",
			description: latestFailedPayroll.errorMessage ?? "Review the failed payroll export job.",
			severity: "critical",
			href: "/settings/payroll-export",
			occurredAt: latestFailedPayroll.completedAt ?? latestFailedPayroll.createdAt,
		});
	}

	for (const schedule of scheduledSource.schedules) {
		if (schedule.reportType === "payroll_export" && schedule.isActive && !schedule.payrollConfigId) {
			alerts.push({
				id: `blocked-${schedule.id}`,
				title: "Scheduled export is blocked",
				description: `${schedule.name} no longer has a payroll export configuration attached.`,
				severity: "warning",
				href: "/settings/scheduled-exports",
				occurredAt: schedule.updatedAt ?? schedule.createdAt,
			});
		}
	}

	const latestFailedAuditRequest = auditSource.requests.find((request) => request.status === "failed");
	if (latestFailedAuditRequest) {
		alerts.push({
			id: `audit-${latestFailedAuditRequest.id}`,
			title: "Audit pack failed",
			description: latestFailedAuditRequest.errorMessage ?? "Review the failed audit pack request.",
			severity: "critical",
			href: "/settings/audit-export",
			occurredAt: latestFailedAuditRequest.completedAt ?? latestFailedAuditRequest.createdAt,
		});
	}

	const upcomingRuns = scheduledSource.schedules
		.filter((schedule) => schedule.isActive && schedule.nextExecutionAt)
		.slice(0, 5)
		.map((schedule) => ({
			id: schedule.id,
			name: schedule.name,
			reportType: schedule.reportType,
			nextExecutionAt: schedule.nextExecutionAt!,
			lastExecutionStatus: executionByScheduleId.get(schedule.id)?.status ?? "never",
			href: "/settings/scheduled-exports",
		}));

	const recentActivity = [
		...payrollJobs.map((job) => ({
			id: job.id,
			kind: "payroll" as const,
			status: job.status,
			title: "Payroll export",
			detail: job.errorMessage ?? (job.fileName ? `Generated ${job.fileName}` : "Processed payroll export job"),
			occurredAt: job.completedAt ?? job.createdAt,
			href: "/settings/payroll-export",
		})),
		...scheduledSource.executions.map((execution) => ({
			id: execution.id,
			kind: "scheduled" as const,
			status: execution.status,
			title: "Scheduled export run",
			detail: execution.errorMessage ?? `Execution ${execution.status}`,
			occurredAt: execution.completedAt ?? execution.triggeredAt,
			href: "/settings/scheduled-exports",
		})),
		...auditSource.requests.map((request) => ({
			id: request.id,
			kind: "audit" as const,
			status: request.status,
			title: "Audit pack",
			detail: request.errorMessage ?? `Coverage ${request.startDate.toISOString().slice(0, 10)} to ${request.endDate.toISOString().slice(0, 10)}`,
			occurredAt: request.completedAt ?? request.createdAt,
			href: "/settings/audit-export",
		})),
	]
		.sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
		.slice(0, 10);

	const sevenDaysAgo = now.minus({ days: 7 }).toJSDate();
	const failedRunsLast7Days = [
		...payrollJobs.filter((job) => job.status === "failed" && (job.completedAt ?? job.createdAt) >= sevenDaysAgo),
		...scheduledSource.executions.filter(
			(execution) => execution.status === "failed" && (execution.completedAt ?? execution.triggeredAt) >= sevenDaysAgo,
		),
		...auditSource.requests.filter((request) => request.status === "failed" && (request.completedAt ?? request.createdAt) >= sevenDaysAgo),
	].length;

	return {
		coverageSummary: {
			activeSchedules: scheduledSource.schedules.filter((schedule) => schedule.isActive).length,
			failedRunsLast7Days,
			lastPayrollExportAt: payrollJobs[0]?.completedAt ?? payrollJobs[0]?.createdAt ?? null,
			lastAuditPackageAt: auditSource.packages[0]?.completedAt ?? auditSource.packages[0]?.createdAt ?? null,
		},
		alerts,
		upcomingRuns,
		recentActivity,
		errors: {
			summary:
				payrollResult.status === "rejected" || scheduledResult.status === "rejected" || auditResult.status === "rejected"
					? "Counts are based on the export data that could be loaded."
					: null,
			alerts:
				payrollResult.status === "rejected" || scheduledResult.status === "rejected" || auditResult.status === "rejected"
					? "Some alerts may be incomplete while export data is unavailable."
					: null,
			upcomingRuns:
				scheduledResult.status === "rejected"
					? "Scheduled export data is temporarily unavailable."
					: null,
			recentActivity:
				payrollResult.status === "rejected" || scheduledResult.status === "rejected" || auditResult.status === "rejected"
					? "Some activity data is temporarily unavailable."
					: null,
		},
	};
}
```

Notes for the engineer while implementing this step:

- Keep the module read-only. Do not import page server actions into it.
- Pass `organizationId` into every query and never merge records across orgs.
- If `scheduledExport.updatedAt` is not available on the inferred type, use `lastExecutionAt ?? createdAt` for the blocked-schedule alert timestamp instead of widening schema access.

- [ ] **Step 4: Run the unit test to verify it passes**

Run:

```bash
pnpm --filter webapp test -- --run "src/lib/export-operations/__tests__/get-export-operations-cockpit.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit the cockpit query layer**

```bash
git add apps/webapp/src/lib/export-operations/get-export-operations-cockpit.ts apps/webapp/src/lib/export-operations/__tests__/get-export-operations-cockpit.test.ts
git commit -m "feat: add export operations cockpit data model"
```

### Task 3: Render The Dashboard And Wire The Page To Real Data

**Files:**
- Create: `apps/webapp/src/components/settings/export-operations/export-operations-dashboard.tsx`
- Create: `apps/webapp/src/components/settings/export-operations/export-operations-dashboard.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx`

- [ ] **Step 1: Write the failing dashboard UI test**

Create `apps/webapp/src/components/settings/export-operations/export-operations-dashboard.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
	default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
	CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
	CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
	CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/alert", () => ({
	Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertTitle: ({ children }: { children: React.ReactNode }) => <strong>{children}</strong>,
	AlertDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/table", () => ({
	Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
	TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
	TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
	TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
	TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
	TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}));

import { ExportOperationsDashboard } from "./export-operations-dashboard";

const t = (_key: string, defaultValue: string) => defaultValue;

describe("ExportOperationsDashboard", () => {
	it("renders summary, alerts, upcoming runs, and recent activity deep links", () => {
		render(
			<ExportOperationsDashboard
				t={t}
				data={{
					coverageSummary: {
						activeSchedules: 3,
						failedRunsLast7Days: 2,
						lastPayrollExportAt: new Date("2026-04-10T08:00:00.000Z"),
						lastAuditPackageAt: new Date("2026-04-10T11:00:00.000Z"),
					},
					alerts: [
						{
							id: "alert-1",
							title: "Payroll export failed",
							description: "DATEV credentials expired",
							severity: "critical",
							href: "/settings/payroll-export",
							occurredAt: new Date("2026-04-10T08:03:00.000Z"),
						},
					],
					upcomingRuns: [
						{
							id: "run-1",
							name: "Monthly Payroll",
							reportType: "payroll_export",
							nextExecutionAt: new Date("2026-04-12T00:00:00.000Z"),
							lastExecutionStatus: "failed",
							href: "/settings/scheduled-exports",
						},
					],
					recentActivity: [
						{
							id: "activity-1",
							kind: "audit",
							status: "failed",
							title: "Audit pack",
							detail: "Timestamp authority unavailable",
							occurredAt: new Date("2026-04-10T11:02:00.000Z"),
							href: "/settings/audit-export",
						},
					],
					errors: {
						summary: null,
						alerts: null,
						upcomingRuns: null,
						recentActivity: null,
					},
				}}
			/>,
		);

		expect(screen.getByText("Active schedules")).toBeTruthy();
		expect(screen.getByText("Payroll export failed")).toBeTruthy();
		expect(screen.getByText("Monthly Payroll")).toBeTruthy();
		expect(screen.getByText("Audit pack")).toBeTruthy();
		expect(screen.getByLabelText("Open Payroll export failed")).toHaveAttribute(
			"href",
			"/settings/payroll-export",
		);
	});

	it("renders scoped section errors without hiding the rest of the cockpit", () => {
		render(
			<ExportOperationsDashboard
				t={t}
				data={{
					coverageSummary: {
						activeSchedules: 0,
						failedRunsLast7Days: 0,
						lastPayrollExportAt: null,
						lastAuditPackageAt: null,
					},
					alerts: [],
					upcomingRuns: [],
					recentActivity: [],
					errors: {
						summary: "Counts are based on the export data that could be loaded.",
						alerts: null,
						upcomingRuns: "Scheduled export data is temporarily unavailable.",
						recentActivity: "Some activity data is temporarily unavailable.",
					},
				}}
			/>,
		);

		expect(screen.getByText("Counts are based on the export data that could be loaded.")).toBeTruthy();
		expect(screen.getByText("Scheduled export data is temporarily unavailable.")).toBeTruthy();
		expect(screen.getByText("Some activity data is temporarily unavailable.")).toBeTruthy();
		expect(screen.getByText("No alerts right now")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run:

```bash
pnpm --filter webapp test -- --run "src/components/settings/export-operations/export-operations-dashboard.test.tsx"
```

Expected: FAIL because `export-operations-dashboard.tsx` does not exist yet.

- [ ] **Step 3: Implement the dashboard component and wire the page to real data**

Create `apps/webapp/src/components/settings/export-operations/export-operations-dashboard.tsx`:

```tsx
import Link from "next/link";
import { DateTime } from "luxon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { ExportOperationsCockpitData } from "@/lib/export-operations/get-export-operations-cockpit";

interface ExportOperationsDashboardProps {
	t: (key: string, defaultValue: string) => string;
	data: ExportOperationsCockpitData;
}

function formatDate(value: Date | null): string {
	if (!value) return "Never";
	return DateTime.fromJSDate(value).toLocaleString(DateTime.DATETIME_SHORT);
}

function formatReportType(value: string): string {
	switch (value) {
		case "payroll_export":
			return "Payroll";
		case "audit_report":
			return "Audit";
		default:
			return "Data";
	}
}

export function ExportOperationsDashboard({ data, t }: ExportOperationsDashboardProps) {
	return (
		<div className="space-y-6">
			{data.errors.summary && (
				<Alert>
					<AlertTitle>{t("settings.exportOperations.partialData", "Partial data")}</AlertTitle>
					<AlertDescription>{data.errors.summary}</AlertDescription>
				</Alert>
			)}

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.exportOperations.cards.activeSchedules", "Active schedules")}</CardTitle>
					</CardHeader>
					<CardContent>{data.coverageSummary.activeSchedules}</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.exportOperations.cards.failedRuns", "Failed runs (7 days)")}</CardTitle>
					</CardHeader>
					<CardContent>{data.coverageSummary.failedRunsLast7Days}</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.exportOperations.cards.lastPayroll", "Last payroll export")}</CardTitle>
					</CardHeader>
					<CardContent>{formatDate(data.coverageSummary.lastPayrollExportAt)}</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.exportOperations.cards.lastAudit", "Last audit pack")}</CardTitle>
					</CardHeader>
					<CardContent>{formatDate(data.coverageSummary.lastAuditPackageAt)}</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.exportOperations.alerts.title", "Alerts")}</CardTitle>
					<CardDescription>
						{t("settings.exportOperations.alerts.description", "Issues that need org-admin attention.")}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{data.errors.alerts && <p className="text-sm text-muted-foreground">{data.errors.alerts}</p>}
					{data.alerts.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("settings.exportOperations.alerts.empty", "No alerts right now")}
						</p>
					) : (
						data.alerts.map((alert) => (
							<div key={alert.id} className="rounded-lg border p-4">
								<div className="flex items-start justify-between gap-4">
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											<Badge>{alert.severity === "critical" ? "Critical" : "Warning"}</Badge>
											<span className="font-medium">{alert.title}</span>
										</div>
										<p className="text-sm text-muted-foreground">{alert.description}</p>
										<p className="text-xs text-muted-foreground">{formatDate(alert.occurredAt)}</p>
									</div>
									<Link aria-label={`Open ${alert.title}`} href={alert.href} className="text-sm font-medium underline">
										{t("settings.exportOperations.open", "Open")}
									</Link>
								</div>
							</div>
						))
					)}
				</CardContent>
			</Card>

			<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.exportOperations.upcoming.title", "Upcoming runs")}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{data.errors.upcomingRuns && (
							<p className="text-sm text-muted-foreground">{data.errors.upcomingRuns}</p>
						)}
						{data.upcomingRuns.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{t("settings.exportOperations.upcoming.empty", "No upcoming runs")}
							</p>
						) : (
							data.upcomingRuns.map((run) => (
								<div key={run.id} className="rounded-lg border p-4">
									<div className="flex items-center justify-between gap-4">
										<div>
											<p className="font-medium">{run.name}</p>
											<p className="text-sm text-muted-foreground">
												{formatReportType(run.reportType)} · {formatDate(run.nextExecutionAt)}
											</p>
											<p className="text-xs text-muted-foreground">
												Last result: {run.lastExecutionStatus}
											</p>
										</div>
										<Link aria-label={`Open ${run.name}`} href={run.href} className="text-sm font-medium underline">
											{t("settings.exportOperations.open", "Open")}
										</Link>
									</div>
								</div>
							))
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{t("settings.exportOperations.activity.title", "Recent activity")}</CardTitle>
					</CardHeader>
					<CardContent>
						{data.errors.recentActivity && (
							<p className="mb-4 text-sm text-muted-foreground">{data.errors.recentActivity}</p>
						)}
						{data.recentActivity.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{t("settings.exportOperations.activity.empty", "No recent export activity")}
							</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t("settings.exportOperations.activity.kind", "Type")}</TableHead>
										<TableHead>{t("settings.exportOperations.activity.status", "Status")}</TableHead>
										<TableHead>{t("settings.exportOperations.activity.detail", "Detail")}</TableHead>
										<TableHead>{t("settings.exportOperations.activity.when", "When")}</TableHead>
										<TableHead>{t("settings.exportOperations.activity.link", "Open")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.recentActivity.map((item) => (
										<TableRow key={item.id}>
											<TableCell>{item.title}</TableCell>
											<TableCell>{item.status}</TableCell>
											<TableCell>{item.detail}</TableCell>
											<TableCell>{formatDate(item.occurredAt)}</TableCell>
											<TableCell>
												<Link aria-label={`Open ${item.title} activity`} href={item.href} className="underline">
													{t("settings.exportOperations.open", "Open")}
												</Link>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
```

Update `apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx` so it loads the real data:

```tsx
import { connection } from "next/server";
import { Suspense } from "react";
import { ExportOperationsDashboard } from "@/components/settings/export-operations/export-operations-dashboard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getExportOperationsCockpit } from "@/lib/export-operations/get-export-operations-cockpit";
import { getTranslate } from "@/tolgee/server";

async function ExportOperationsContent() {
	await connection();

	const [t, { organizationId }] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);

	const data = await getExportOperationsCockpit(organizationId);

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.exportOperations.title", "Export Operations")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.exportOperations.description",
						"Monitor payroll, audit, and scheduled export activity for your organization.",
					)}
				</p>
			</div>

			<ExportOperationsDashboard t={t} data={data} />
		</div>
	);
}

function ExportOperationsLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-2">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-4 w-[28rem]" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export default function ExportOperationsPage() {
	return (
		<Suspense fallback={<ExportOperationsLoading />}>
			<ExportOperationsContent />
		</Suspense>
	);
}
```

- [ ] **Step 4: Run the dashboard UI test to verify it passes**

Run:

```bash
pnpm --filter webapp test -- --run "src/components/settings/export-operations/export-operations-dashboard.test.tsx"
```

Expected: PASS.

- [ ] **Step 5: Commit the dashboard wiring**

```bash
git add apps/webapp/src/components/settings/export-operations/export-operations-dashboard.tsx apps/webapp/src/components/settings/export-operations/export-operations-dashboard.test.tsx apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx
git commit -m "feat: add export operations dashboard"
```

### Task 4: Final Verification

**Files:**
- Verify only. No new files.

- [ ] **Step 1: Run the full focused cockpit test set**

Run:

```bash
pnpm --filter webapp test -- --run "src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts" "src/components/settings/settings-config.test.ts" "src/lib/export-operations/__tests__/get-export-operations-cockpit.test.ts" "src/components/settings/export-operations/export-operations-dashboard.test.tsx"
```

Expected: PASS for all four test files.

- [ ] **Step 2: Run the broader webapp test command if the focused suite passed cleanly**

Run:

```bash
pnpm --filter webapp test
```

Expected: PASS for the webapp Vitest suite. If unrelated legacy tests fail, stop, capture the failures, and do not modify unrelated areas without approval.

- [ ] **Step 3: Commit the verified feature branch state**

```bash
git add apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx apps/webapp/src/components/settings/export-operations/export-operations-dashboard.tsx apps/webapp/src/components/settings/export-operations/export-operations-dashboard.test.tsx apps/webapp/src/lib/export-operations/get-export-operations-cockpit.ts apps/webapp/src/lib/export-operations/__tests__/get-export-operations-cockpit.test.ts apps/webapp/src/lib/settings-access.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/components/settings/settings-config.test.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "feat: add export operations cockpit"
```

## Self-Review

- Spec coverage check:
  - New org-admin overview route: covered by Task 1 and Task 3.
  - Unified alerts/upcoming runs/recent activity: covered by Task 2 and Task 3.
  - Deep links to existing pages: covered by Task 3 tests and implementation.
  - Org-only scope and no worker diagnostics: enforced in Task 2 query design and Task 1 route access.
  - No inline actions or setup forms: preserved by the display-only dashboard in Task 3.
- Placeholder scan: no `TBD`, `TODO`, or “similar to” references remain in this plan.
- Type consistency check:
  - The shared cockpit file exports `ExportOperationsCockpitData`, which Task 3 imports directly.
  - The dashboard expects `errors.summary`, `errors.alerts`, `errors.upcomingRuns`, and `errors.recentActivity`, which Task 2 defines.
  - The route path, menu id, and href all use `export-operations` consistently.
