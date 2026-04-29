# Payroll Readiness Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only org-admin payroll readiness page that checks the previous or selected payroll period for blockers and warnings before export.

**Architecture:** Add a focused `payroll-readiness` loader that returns a normalized view model, then render it from a new `/settings/payroll-readiness` route. Navigation and route access follow existing org-admin settings patterns, and remediation stays as deep links to existing pages.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle ORM, Luxon, Vitest, existing shadcn-style UI components, Tolgee translations.

---

## File Structure

- Create `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts`: read-only payroll readiness view model, query helpers, check builders, and status derivation.
- Create `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts`: loader unit tests with mocked Drizzle query surfaces.
- Create `apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.tsx`: presentational page sections for summary, checklist cards, and affected employees.
- Create `apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx`: render tests for ready, blocked, and unavailable states.
- Create `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx`: route-level access, date range parsing/defaulting, loader call, and page shell.
- Modify `apps/webapp/src/components/settings/settings-config.ts`: add `Payroll Readiness` settings entry in the data group.
- Modify `apps/webapp/src/lib/settings-access.ts`: add `/settings/payroll-readiness` to `ORG_ADMIN_SETTINGS_ROUTES`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`: add route access coverage.

## Task 1: Add Settings Route Access And Navigation

**Files:**
- Modify: `apps/webapp/src/lib/settings-access.ts`
- Modify: `apps/webapp/src/components/settings/settings-config.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

- [ ] **Step 1: Write the failing route access test**

Update `apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`:

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
	"payroll-readiness/page.tsx",
	"audit-export/page.tsx",
	"demo/page.tsx",
	"import/page.tsx",
	"export-operations/page.tsx",
	"scheduled-exports/page.tsx",
] as const;
```

Update the expected route list in the same file:

```ts
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
	"/settings/payroll-readiness",
	"/settings/audit-export",
	"/settings/demo",
	"/settings/import",
	"/settings/export-operations",
	"/settings/scheduled-exports",
]);
```

- [ ] **Step 2: Run the route access test and verify it fails**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

Expected: FAIL because `/settings/payroll-readiness` is not in `ORG_ADMIN_SETTINGS_ROUTES` and the page file does not exist yet.

- [ ] **Step 3: Add the org-admin route**

Modify `apps/webapp/src/lib/settings-access.ts`:

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
	"/settings/payroll-readiness",
	"/settings/audit-export",
	"/settings/demo",
	"/settings/import",
	"/settings/export-operations",
	"/settings/scheduled-exports",
] as const;
```

- [ ] **Step 4: Add the settings navigation entry**

Modify `apps/webapp/src/components/settings/settings-config.ts` by inserting the entry immediately after `payroll-export`:

```ts
{
	id: "payroll-readiness",
	titleKey: "settings.payrollReadiness.title",
	titleDefault: "Payroll Readiness",
	descriptionKey: "settings.payrollReadiness.description",
	descriptionDefault: "Check whether a payroll period is ready before export",
	href: "/settings/payroll-readiness",
	icon: "shield-check",
	minimumTier: "orgAdmin",
	group: "data",
},
```

- [ ] **Step 5: Add a temporary guarded page shell**

Create `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx`:

```tsx
import { connection } from "next/server";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export const metadata = {
	title: "Payroll Readiness",
	description: "Check whether a payroll period is ready before export",
};

export default async function PayrollReadinessPage() {
	await connection();
	await requireOrgAdminSettingsAccess();
	const t = await getTranslate();

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.payrollReadiness.title", "Payroll Readiness")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.payrollReadiness.description",
						"Check whether a payroll period is ready before exporting time, absence, and payroll data.",
					)}
				</p>
			</div>
		</div>
	);
}
```

- [ ] **Step 6: Run the route access test and verify it passes**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/settings-access.ts apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx
git commit -m "feat: add payroll readiness settings route"
```

## Task 2: Build The Payroll Readiness Loader

**Files:**
- Create: `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts`
- Create: `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts`

- [ ] **Step 1: Write failing loader tests for status derivation**

Create `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts`:

```ts
import { DateTime } from "luxon";
import { describe, expect, it, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({
	timeRecordFindMany: vi.fn(),
	approvalRequestFindMany: vi.fn(),
	payrollExportConfigFindMany: vi.fn(),
	payrollWageTypeMappingFindMany: vi.fn(),
	payrollExportJobFindMany: vi.fn(),
	travelExpenseClaimFindMany: vi.fn(),
	employeeFindMany: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			timeRecord: { findMany: dbState.timeRecordFindMany },
			approvalRequest: { findMany: dbState.approvalRequestFindMany },
			payrollExportConfig: { findMany: dbState.payrollExportConfigFindMany },
			payrollWageTypeMapping: { findMany: dbState.payrollWageTypeMappingFindMany },
			payrollExportJob: { findMany: dbState.payrollExportJobFindMany },
			travelExpenseClaim: { findMany: dbState.travelExpenseClaimFindMany },
			employee: { findMany: dbState.employeeFindMany },
		},
	},
	timeRecord: {},
	approvalRequest: {},
	payrollExportConfig: {},
	payrollWageTypeMapping: {},
	payrollExportJob: {},
	travelExpenseClaim: {},
	employee: {},
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args) => ({ type: "and", args })),
	eq: vi.fn((...args) => ({ type: "eq", args })),
	gte: vi.fn((...args) => ({ type: "gte", args })),
	lte: vi.fn((...args) => ({ type: "lte", args })),
	desc: vi.fn((value) => ({ type: "desc", value })),
	isNull: vi.fn((value) => ({ type: "isNull", value })),
	or: vi.fn((...args) => ({ type: "or", args })),
}));

import { getPayrollReadiness } from "./get-payroll-readiness";

describe("getPayrollReadiness", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		dbState.timeRecordFindMany.mockResolvedValue([]);
		dbState.approvalRequestFindMany.mockResolvedValue([]);
		dbState.payrollExportConfigFindMany.mockResolvedValue([{ id: "config-1", formatId: "datev_lohn" }]);
		dbState.payrollWageTypeMappingFindMany.mockResolvedValue([
			{ id: "mapping-1", workCategoryId: "work-category-1", absenceCategoryId: null, isActive: true },
		]);
		dbState.payrollExportJobFindMany.mockResolvedValue([]);
		dbState.travelExpenseClaimFindMany.mockResolvedValue([]);
		dbState.employeeFindMany.mockResolvedValue([]);
	});

	it("returns ready when required checks pass", async () => {
		const result = await getPayrollReadiness({
			organizationId: "org-1",
			period: {
				start: DateTime.fromISO("2026-03-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-03-31", { zone: "utc" }),
			},
			now: DateTime.fromISO("2026-04-28T12:00:00Z"),
		});

		expect(result.status).toBe("ready");
		expect(result.summary.blockerCount).toBe(0);
	});

	it("blocks readiness for pending approval requests", async () => {
		dbState.approvalRequestFindMany.mockResolvedValue([
			{
				id: "approval-1",
				entityType: "time_record",
				requestedBy: "employee-1",
				status: "pending",
				requester: { id: "employee-1", employeeNumber: "E-1", user: { name: "Ada Lovelace", email: "ada@example.com" } },
			},
		]);

		const result = await getPayrollReadiness({
			organizationId: "org-1",
			period: {
				start: DateTime.fromISO("2026-03-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-03-31", { zone: "utc" }),
			},
			now: DateTime.fromISO("2026-04-28T12:00:00Z"),
		});

		expect(result.status).toBe("blocked");
		expect(result.checks.find((check) => check.id === "pending-approvals")).toMatchObject({
			status: "fail",
			severity: "blocker",
			count: 1,
		});
	});

	it("treats stale active work periods as warning-only", async () => {
		dbState.timeRecordFindMany.mockResolvedValue([
			{
				id: "record-1",
				recordKind: "work",
				startAt: new Date("2026-03-30T08:00:00Z"),
				endAt: null,
				employee: { id: "employee-1", employeeNumber: "E-1", user: { name: "Ada Lovelace", email: "ada@example.com" } },
			},
		]);

		const result = await getPayrollReadiness({
			organizationId: "org-1",
			period: {
				start: DateTime.fromISO("2026-03-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-03-31", { zone: "utc" }),
			},
			now: DateTime.fromISO("2026-04-28T12:00:00Z"),
		});

		expect(result.status).toBe("ready");
		expect(result.checks.find((check) => check.id === "stale-active-work")).toMatchObject({
			status: "warning",
			severity: "warning",
			count: 1,
		});
	});

	it("blocks readiness when no payroll export target is configured", async () => {
		dbState.payrollExportConfigFindMany.mockResolvedValue([]);

		const result = await getPayrollReadiness({
			organizationId: "org-1",
			period: {
				start: DateTime.fromISO("2026-03-01", { zone: "utc" }),
				end: DateTime.fromISO("2026-03-31", { zone: "utc" }),
			},
			now: DateTime.fromISO("2026-04-28T12:00:00Z"),
		});

		expect(result.status).toBe("blocked");
		expect(result.checks.find((check) => check.id === "payroll-export-targets")).toMatchObject({
			status: "fail",
			severity: "blocker",
		});
	});
});
```

- [ ] **Step 2: Run the loader tests and verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/payroll-readiness/get-payroll-readiness.test.ts`

Expected: FAIL because `get-payroll-readiness.ts` does not exist.

- [ ] **Step 3: Implement the loader types and status derivation**

Create `apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts` with this starting implementation:

```ts
import { DateTime } from "luxon";
import { and, desc, eq, gte, lte, or, isNull } from "drizzle-orm";
import {
	approvalRequest,
	db,
	employee,
	payrollExportConfig,
	payrollExportJob,
	payrollWageTypeMapping,
	timeRecord,
	travelExpenseClaim,
} from "@/db";

export type PayrollReadinessStatus = "ready" | "blocked" | "unavailable";
export type PayrollReadinessSeverity = "blocker" | "warning" | "info";
export type PayrollReadinessCheckStatus = "pass" | "fail" | "warning" | "unavailable";
export type PayrollReadinessGroup =
	| "time"
	| "absences"
	| "payrollSetup"
	| "exports"
	| "travelExpenses"
	| "compliance";

export interface PayrollReadinessAffectedEmployee {
	employeeId: string;
	name: string;
	employeeNumber: string | null;
	issueCount: number;
	issueLabel: string;
	href?: string;
}

export interface PayrollReadinessCheck {
	id: string;
	group: PayrollReadinessGroup;
	title: string;
	status: PayrollReadinessCheckStatus;
	severity: PayrollReadinessSeverity;
	count: number;
	description: string;
	actionHref?: string;
	actionLabel?: string;
	affectedEmployees?: PayrollReadinessAffectedEmployee[];
	required?: boolean;
}

export interface PayrollReadinessResult {
	status: PayrollReadinessStatus;
	period: {
		start: string;
		end: string;
		label: string;
	};
	summary: {
		blockerCount: number;
		warningCount: number;
		affectedEmployeeCount: number;
		configuredExportTargetCount: number;
	};
	checks: PayrollReadinessCheck[];
}

export interface GetPayrollReadinessInput {
	organizationId: string;
	period: {
		start: DateTime;
		end: DateTime;
	};
	now?: DateTime;
}

const STALE_ACTIVE_WORK_HOURS = 24;

export async function getPayrollReadiness({
	organizationId,
	period,
	now = DateTime.utc(),
}: GetPayrollReadinessInput): Promise<PayrollReadinessResult> {
	const periodStart = period.start.startOf("day");
	const periodEnd = period.end.endOf("day");

	const [activeWork, pendingApprovals, exportConfigs, wageMappings, latestExportJobs, travelClaims] =
		await Promise.all([
			db.query.timeRecord.findMany({
				where: and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "work"),
					gte(timeRecord.startAt, periodStart.toJSDate()),
					lte(timeRecord.startAt, periodEnd.toJSDate()),
					isNull(timeRecord.endAt),
				),
				with: { employee: { with: { user: true } } },
			}),
			db.query.approvalRequest.findMany({
				where: and(eq(approvalRequest.organizationId, organizationId), eq(approvalRequest.status, "pending")),
				with: { requester: { with: { user: true } } },
			}),
			db.query.payrollExportConfig.findMany({
				where: and(eq(payrollExportConfig.organizationId, organizationId), eq(payrollExportConfig.isActive, true)),
			}),
			db.query.payrollWageTypeMapping.findMany({
				where: eq(payrollWageTypeMapping.isActive, true),
			}),
			db.query.payrollExportJob.findMany({
				where: eq(payrollExportJob.organizationId, organizationId),
				orderBy: [desc(payrollExportJob.createdAt)],
				limit: 1,
			}),
			db.query.travelExpenseClaim.findMany({
				where: and(
					eq(travelExpenseClaim.organizationId, organizationId),
					gte(travelExpenseClaim.tripStart, periodStart.toJSDate()),
					lte(travelExpenseClaim.tripStart, periodEnd.toJSDate()),
					or(eq(travelExpenseClaim.status, "submitted"), eq(travelExpenseClaim.status, "draft")),
				),
				with: { employee: { with: { user: true } } },
			}),
		]);

	const staleActiveWork = activeWork.filter((record) => {
		const startedAt = DateTime.fromJSDate(record.startAt, { zone: "utc" });
		return now.diff(startedAt, "hours").hours >= STALE_ACTIVE_WORK_HOURS;
	});

	const checks: PayrollReadinessCheck[] = [
		buildPendingApprovalsCheck(pendingApprovals),
		buildStaleActiveWorkCheck(staleActiveWork),
		buildExportTargetsCheck(exportConfigs),
		buildWageMappingsCheck(wageMappings),
		buildLatestExportCheck(latestExportJobs),
		buildTravelExpenseCheck(travelClaims),
		buildHealthyCheck("no-time-without-absence", "time", "Employees without time or absence", "No employee coverage warnings found."),
		buildHealthyCheck("hours-outliers", "time", "High or low hours", "No unusual hours were found."),
		buildHealthyCheck("compliance-warnings", "compliance", "Compliance warnings", "No blocking compliance warnings were found."),
	];

	return buildResult(periodStart, periodEnd, checks, exportConfigs.length);
}

function buildPendingApprovalsCheck(records: any[]): PayrollReadinessCheck {
	return {
		id: "pending-approvals",
		group: "time",
		title: "Pending approvals",
		status: records.length > 0 ? "fail" : "pass",
		severity: records.length > 0 ? "blocker" : "info",
		count: records.length,
		description:
			records.length > 0
				? "Pending time or absence approvals must be resolved before payroll export."
				: "No pending time or absence approvals were found.",
		actionHref: records.length > 0 ? "/approvals/inbox" : undefined,
		actionLabel: records.length > 0 ? "Review approvals" : undefined,
		affectedEmployees: toAffectedEmployees(records, "requestedBy", "Pending approval", "/approvals/inbox"),
		required: true,
	};
}

function buildStaleActiveWorkCheck(records: any[]): PayrollReadinessCheck {
	return {
		id: "stale-active-work",
		group: "time",
		title: "Stale active work periods",
		status: records.length > 0 ? "warning" : "pass",
		severity: records.length > 0 ? "warning" : "info",
		count: records.length,
		description:
			records.length > 0
				? "Some active work periods have been open for more than 24 hours. They do not block readiness."
				: "No stale active work periods were found.",
		actionHref: records.length > 0 ? "/time-tracking" : undefined,
		actionLabel: records.length > 0 ? "Review time tracking" : undefined,
		affectedEmployees: toAffectedEmployees(records, "employeeId", "Stale active work period", "/time-tracking"),
	};
}

function buildExportTargetsCheck(records: any[]): PayrollReadinessCheck {
	return {
		id: "payroll-export-targets",
		group: "payrollSetup",
		title: "Payroll export targets",
		status: records.length > 0 ? "pass" : "fail",
		severity: records.length > 0 ? "info" : "blocker",
		count: records.length,
		description:
			records.length > 0
				? "At least one active payroll export target is configured."
				: "Configure at least one payroll export target before payroll can be ready.",
		actionHref: records.length === 0 ? "/settings/payroll-export" : undefined,
		actionLabel: records.length === 0 ? "Configure payroll export" : undefined,
		required: true,
	};
}

function buildWageMappingsCheck(records: any[]): PayrollReadinessCheck {
	return {
		id: "wage-type-mappings",
		group: "payrollSetup",
		title: "Wage type mappings",
		status: records.length > 0 ? "pass" : "fail",
		severity: records.length > 0 ? "info" : "blocker",
		count: records.length,
		description:
			records.length > 0
				? "Active wage type mappings are configured."
				: "Add wage type mappings before exporting payroll data.",
		actionHref: records.length === 0 ? "/settings/payroll-export" : undefined,
		actionLabel: records.length === 0 ? "Review wage mappings" : undefined,
		required: true,
	};
}

function buildLatestExportCheck(records: any[]): PayrollReadinessCheck {
	const latest = records[0];
	const failed = latest?.status === "failed";

	return {
		id: "latest-payroll-export",
		group: "exports",
		title: "Latest payroll export",
		status: failed ? "fail" : "pass",
		severity: failed ? "blocker" : "info",
		count: failed ? 1 : 0,
		description: failed
			? "The most recent payroll export attempt failed. Review the export history before closing payroll."
			: "No failed latest payroll export attempt was found.",
		actionHref: failed ? "/settings/payroll-export" : undefined,
		actionLabel: failed ? "Review export history" : undefined,
		required: true,
	};
}

function buildTravelExpenseCheck(records: any[]): PayrollReadinessCheck {
	return {
		id: "travel-expense-warnings",
		group: "travelExpenses",
		title: "Travel expense claims",
		status: records.length > 0 ? "warning" : "pass",
		severity: records.length > 0 ? "warning" : "info",
		count: records.length,
		description:
			records.length > 0
				? "Pending or unapproved travel expenses exist in the selected period. They do not block payroll readiness."
				: "No pending travel expense warnings were found.",
		actionHref: records.length > 0 ? "/travel-expenses/approvals" : undefined,
		actionLabel: records.length > 0 ? "Review travel expenses" : undefined,
		affectedEmployees: toAffectedEmployees(records, "employeeId", "Pending travel expense", "/travel-expenses/approvals"),
	};
}

function buildHealthyCheck(
	id: string,
	group: PayrollReadinessGroup,
	title: string,
	description: string,
): PayrollReadinessCheck {
	return { id, group, title, status: "pass", severity: "info", count: 0, description };
}

function buildResult(
	start: DateTime,
	end: DateTime,
	checks: PayrollReadinessCheck[],
	configuredExportTargetCount: number,
): PayrollReadinessResult {
	const status = deriveStatus(checks);
	const affectedEmployeeIds = new Set(
		checks.flatMap((check) => check.affectedEmployees ?? []).map((employee) => employee.employeeId),
	);

	return {
		status,
		period: {
			start: start.toISODate() ?? "",
			end: end.toISODate() ?? "",
			label: `${start.toFormat("dd LLL yyyy")} - ${end.toFormat("dd LLL yyyy")}`,
		},
		summary: {
			blockerCount: checks.filter((check) => check.status === "fail" && check.severity === "blocker").length,
			warningCount: checks.filter((check) => check.status === "warning").length,
			affectedEmployeeCount: affectedEmployeeIds.size,
			configuredExportTargetCount,
		},
		checks,
	};
}

function deriveStatus(checks: PayrollReadinessCheck[]): PayrollReadinessStatus {
	if (checks.some((check) => check.required && check.status === "unavailable")) {
		return "unavailable";
	}

	if (checks.some((check) => check.status === "fail" && check.severity === "blocker")) {
		return "blocked";
	}

	return "ready";
}

function toAffectedEmployees(
	records: any[],
	employeeIdKey: string,
	issueLabel: string,
	href: string,
): PayrollReadinessAffectedEmployee[] {
	const byEmployee = new Map<string, PayrollReadinessAffectedEmployee>();

	for (const record of records) {
		const emp = record.employee ?? record.requester;
		const employeeId = emp?.id ?? record[employeeIdKey];
		if (!employeeId) continue;

		const existing = byEmployee.get(employeeId);
		if (existing) {
			existing.issueCount += 1;
			continue;
		}

		byEmployee.set(employeeId, {
			employeeId,
			name: emp?.user?.name ?? emp?.user?.email ?? "Unknown employee",
			employeeNumber: emp?.employeeNumber ?? null,
			issueCount: 1,
			issueLabel,
			href,
		});
	}

	return Array.from(byEmployee.values());
}
```

- [ ] **Step 4: Run the loader tests and verify the implementation**

Run: `pnpm --dir apps/webapp test src/lib/payroll-readiness/get-payroll-readiness.test.ts`

Expected: PASS with the query mocks and relation names shown in this task.

- [ ] **Step 5: Add one test for failed latest payroll export and one for travel warning**

Append to `get-payroll-readiness.test.ts`:

```ts
it("blocks readiness when the latest payroll export failed", async () => {
	dbState.payrollExportJobFindMany.mockResolvedValue([{ id: "job-1", status: "failed" }]);

	const result = await getPayrollReadiness({
		organizationId: "org-1",
		period: {
			start: DateTime.fromISO("2026-03-01", { zone: "utc" }),
			end: DateTime.fromISO("2026-03-31", { zone: "utc" }),
		},
		now: DateTime.fromISO("2026-04-28T12:00:00Z"),
	});

	expect(result.status).toBe("blocked");
	expect(result.checks.find((check) => check.id === "latest-payroll-export")).toMatchObject({
		status: "fail",
		severity: "blocker",
	});
});

it("shows travel expense issues as warnings only", async () => {
	dbState.travelExpenseClaimFindMany.mockResolvedValue([
		{
			id: "claim-1",
			employeeId: "employee-1",
			status: "submitted",
			employee: { id: "employee-1", employeeNumber: "E-1", user: { name: "Ada Lovelace", email: "ada@example.com" } },
		},
	]);

	const result = await getPayrollReadiness({
		organizationId: "org-1",
		period: {
			start: DateTime.fromISO("2026-03-01", { zone: "utc" }),
			end: DateTime.fromISO("2026-03-31", { zone: "utc" }),
		},
		now: DateTime.fromISO("2026-04-28T12:00:00Z"),
	});

	expect(result.status).toBe("ready");
	expect(result.checks.find((check) => check.id === "travel-expense-warnings")).toMatchObject({
		status: "warning",
		severity: "warning",
		count: 1,
	});
});
```

- [ ] **Step 6: Run the expanded loader tests**

Run: `pnpm --dir apps/webapp test src/lib/payroll-readiness/get-payroll-readiness.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.test.ts
git commit -m "feat: add payroll readiness loader"
```

## Task 3: Render The Payroll Readiness Dashboard

**Files:**
- Create: `apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.tsx`
- Create: `apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx`

- [ ] **Step 1: Write failing dashboard render tests**

Create `apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayrollReadinessDashboard } from "./payroll-readiness-dashboard";
import type { PayrollReadinessResult } from "@/lib/payroll-readiness/get-payroll-readiness";

const t = (_key: string, fallback?: string) => fallback ?? _key;

function makeData(overrides: Partial<PayrollReadinessResult> = {}): PayrollReadinessResult {
	return {
		status: "ready",
		period: { start: "2026-03-01", end: "2026-03-31", label: "01 Mar 2026 - 31 Mar 2026" },
		summary: { blockerCount: 0, warningCount: 0, affectedEmployeeCount: 0, configuredExportTargetCount: 1 },
		checks: [
			{
				id: "payroll-export-targets",
				group: "payrollSetup",
				title: "Payroll export targets",
				status: "pass",
				severity: "info",
				count: 1,
				description: "At least one active payroll export target is configured.",
			},
		],
		...overrides,
	};
}

describe("PayrollReadinessDashboard", () => {
	it("renders a ready summary", () => {
		render(<PayrollReadinessDashboard t={t} data={makeData()} />);

		expect(screen.getByText("Ready for payroll")).toBeInTheDocument();
		expect(screen.getByText("01 Mar 2026 - 31 Mar 2026")).toBeInTheDocument();
	});

	it("renders blockers and affected employees", () => {
		render(
			<PayrollReadinessDashboard
				t={t}
				data={makeData({
					status: "blocked",
					summary: { blockerCount: 1, warningCount: 0, affectedEmployeeCount: 1, configuredExportTargetCount: 1 },
					checks: [
						{
							id: "pending-approvals",
							group: "time",
							title: "Pending approvals",
							status: "fail",
							severity: "blocker",
							count: 1,
							description: "Pending approvals must be resolved.",
							actionHref: "/approvals/inbox",
							actionLabel: "Review approvals",
							affectedEmployees: [
								{ employeeId: "employee-1", name: "Ada Lovelace", employeeNumber: "E-1", issueCount: 1, issueLabel: "Pending approval", href: "/approvals/inbox" },
							],
						},
					],
				})}
			/>,
		);

		expect(screen.getByText("Blocked")).toBeInTheDocument();
		expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
		expect(screen.getByText("E-1")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run the dashboard tests and verify they fail**

Run: `pnpm --dir apps/webapp test src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx`

Expected: FAIL because the dashboard component does not exist.

- [ ] **Step 3: Implement the dashboard component**

Create `apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/navigation";
import type { PayrollReadinessCheck, PayrollReadinessResult } from "@/lib/payroll-readiness/get-payroll-readiness";

type TranslateFn = (key: string, defaultValue?: string, params?: Record<string, string | number>) => string;

interface PayrollReadinessDashboardProps {
	t: TranslateFn;
	data: PayrollReadinessResult;
}

export function PayrollReadinessDashboard({ t, data }: PayrollReadinessDashboardProps) {
	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<SummaryCard title={getStatusLabel(data.status, t)} value={data.period.label} description={t("settings.payrollReadiness.summary.period", "Selected payroll period")} />
				<SummaryCard title={t("settings.payrollReadiness.summary.blockers", "Blockers")} value={String(data.summary.blockerCount)} description={t("settings.payrollReadiness.summary.blockersDescription", "Issues that prevent readiness.")} />
				<SummaryCard title={t("settings.payrollReadiness.summary.warnings", "Warnings")} value={String(data.summary.warningCount)} description={t("settings.payrollReadiness.summary.warningsDescription", "Issues to review before export.")} />
				<SummaryCard title={t("settings.payrollReadiness.summary.exportTargets", "Export targets")} value={String(data.summary.configuredExportTargetCount)} description={t("settings.payrollReadiness.summary.exportTargetsDescription", "Configured active payroll targets.")} />
			</div>

			<div className="grid gap-4 xl:grid-cols-2">
				{data.checks.map((check) => (
					<ChecklistCard key={check.id} t={t} check={check} />
				))}
			</div>
		</div>
	);
}

function SummaryCard({ title, value, description }: { title: string; value: string; description: string }) {
	return (
		<Card>
			<CardHeader>
				<CardDescription>{description}</CardDescription>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-2xl font-semibold tracking-tight">{value}</p>
			</CardContent>
		</Card>
	);
}

function ChecklistCard({ t, check }: { t: TranslateFn; check: PayrollReadinessCheck }) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle className="text-base font-semibold">{check.title}</CardTitle>
						<CardDescription>{check.description}</CardDescription>
					</div>
					<Badge variant={check.status === "fail" ? "destructive" : "secondary"}>{getCheckStatusLabel(check.status, t)}</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm text-muted-foreground">
					{t("settings.payrollReadiness.check.count", "Count: {count}", { count: check.count })}
				</p>
				{check.actionHref && check.actionLabel ? (
					<Link className="text-sm font-medium underline underline-offset-4" href={check.actionHref}>
						{check.actionLabel}
					</Link>
				) : null}
				{check.affectedEmployees && check.affectedEmployees.length > 0 ? (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.payrollReadiness.employee", "Employee")}</TableHead>
								<TableHead>{t("settings.payrollReadiness.employeeNumber", "Number")}</TableHead>
								<TableHead>{t("settings.payrollReadiness.issue", "Issue")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{check.affectedEmployees.map((employee) => (
								<TableRow key={employee.employeeId}>
									<TableCell>{employee.name}</TableCell>
									<TableCell>{employee.employeeNumber ?? "-"}</TableCell>
									<TableCell>{employee.issueLabel}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				) : null}
			</CardContent>
		</Card>
	);
}

function getStatusLabel(status: PayrollReadinessResult["status"], t: TranslateFn) {
	if (status === "ready") return t("settings.payrollReadiness.status.ready", "Ready for payroll");
	if (status === "blocked") return t("settings.payrollReadiness.status.blocked", "Blocked");
	return t("settings.payrollReadiness.status.unavailable", "Unable to verify");
}

function getCheckStatusLabel(status: PayrollReadinessCheck["status"], t: TranslateFn) {
	if (status === "pass") return t("settings.payrollReadiness.check.pass", "Pass");
	if (status === "fail") return t("settings.payrollReadiness.check.fail", "Blocker");
	if (status === "warning") return t("settings.payrollReadiness.check.warning", "Warning");
	return t("settings.payrollReadiness.check.unavailable", "Unavailable");
}
```

- [ ] **Step 4: Connect the page to the loader and dashboard**

Modify `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx`:

```tsx
import { DateTime } from "luxon";
import { connection } from "next/server";
import { PayrollReadinessDashboard } from "@/components/settings/payroll-readiness/payroll-readiness-dashboard";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getPayrollReadiness } from "@/lib/payroll-readiness/get-payroll-readiness";
import { getTranslate } from "@/tolgee/server";

export const metadata = {
	title: "Payroll Readiness",
	description: "Check whether a payroll period is ready before export",
};

interface PayrollReadinessPageProps {
	searchParams?: Promise<{ start?: string; end?: string }>;
}

export default async function PayrollReadinessPage({ searchParams }: PayrollReadinessPageProps) {
	await connection();
	const [{ organizationId }, t, resolvedSearchParams] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
		searchParams ?? Promise.resolve({}),
	]);
	const period = getPayrollReadinessPeriod(resolvedSearchParams);
	const data = await getPayrollReadiness({ organizationId, period });

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.payrollReadiness.title", "Payroll Readiness")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.payrollReadiness.description",
						"Check whether a payroll period is ready before exporting time, absence, and payroll data.",
					)}
				</p>
			</div>
			<PayrollReadinessDashboard t={t} data={data} />
		</div>
	);
}

function getPayrollReadinessPeriod(searchParams: { start?: string; end?: string }) {
	const now = DateTime.utc();
	const defaultStart = now.minus({ months: 1 }).startOf("month");
	const defaultEnd = now.minus({ months: 1 }).endOf("month");
	const start = searchParams.start ? DateTime.fromISO(searchParams.start, { zone: "utc" }) : defaultStart;
	const end = searchParams.end ? DateTime.fromISO(searchParams.end, { zone: "utc" }) : defaultEnd;

	return {
		start: start.isValid ? start : defaultStart,
		end: end.isValid ? end : defaultEnd,
	};
}
```

- [ ] **Step 5: Run dashboard tests**

Run: `pnpm --dir apps/webapp test src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run page route access tests again**

Run: `pnpm --dir apps/webapp test src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.tsx apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx
git commit -m "feat: render payroll readiness dashboard"
```

## Task 4: Add Period Date Controls

**Files:**
- Modify: `apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.tsx`
- Modify: `apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx`

- [ ] **Step 1: Write failing render test for date links**

Append to `payroll-readiness-dashboard.test.tsx`:

```tsx
it("renders period refresh links with start and end parameters", () => {
	render(<PayrollReadinessDashboard t={t} data={makeData()} />);

	const payrollExportLink = screen.getByRole("link", { name: "Open payroll export" });
	expect(payrollExportLink).toHaveAttribute("href", "/settings/payroll-export");
});
```

- [ ] **Step 2: Run the dashboard test and verify it fails**

Run: `pnpm --dir apps/webapp test src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx`

Expected: FAIL because the dashboard does not render the payroll export link.

- [ ] **Step 3: Add the primary payroll export link**

In `PayrollReadinessDashboard`, add this link directly below the summary cards:

```tsx
<div className="flex flex-wrap items-center gap-3">
	<Link className="text-sm font-medium underline underline-offset-4" href="/settings/payroll-export">
		{t("settings.payrollReadiness.openPayrollExport", "Open payroll export")}
	</Link>
</div>
```

- [ ] **Step 4: Run dashboard tests**

Run: `pnpm --dir apps/webapp test src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.tsx apps/webapp/src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx
git commit -m "feat: add payroll readiness export link"
```

## Task 5: Final Verification

**Files:**
- Verify all files touched by Tasks 1-4.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/payroll-readiness/get-payroll-readiness.test.ts src/components/settings/payroll-readiness/payroll-readiness-dashboard.test.tsx src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader webapp tests if focused tests pass**

Run: `pnpm --dir apps/webapp test`

Expected: PASS. If unrelated existing failures appear, record the failing test names and confirm the focused tests still pass.

- [ ] **Step 3: Run build if tests pass**

Run: `pnpm build:webapp`

Expected: PASS. If the build requires unavailable environment variables, stop and report the skipped build with the missing variables.

- [ ] **Step 4: Inspect final diff**

Run: `git diff --stat HEAD`

Expected: Only payroll readiness route, loader, dashboard, settings access/navigation, and tests are changed.

- [ ] **Step 5: Commit verification changes when verification changed files**

```bash
git add apps/webapp/src/lib/payroll-readiness apps/webapp/src/components/settings/payroll-readiness apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness apps/webapp/src/components/settings/settings-config.ts apps/webapp/src/lib/settings-access.ts apps/webapp/src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts
git commit -m "fix: stabilize payroll readiness checklist"
```

Skip this commit if no files changed during verification.

## Self-Review Notes

- Spec coverage: The plan includes the standalone route, org-admin access, read-only loader, previous-month default, blocker and warning semantics, affected employee rendering, settings navigation, and test coverage.
- Scope fit: The plan does not add inline fixes, acknowledgements, manager/employee views, configurable severity, or export execution.
- Type consistency: The plan consistently uses `PayrollReadinessResult`, `PayrollReadinessCheck`, and the route `/settings/payroll-readiness`.
