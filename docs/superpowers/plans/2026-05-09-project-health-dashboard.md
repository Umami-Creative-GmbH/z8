# Project Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add budget/deadline alerts and budget utilization dashboard sections to the existing Project Reports page.

**Architecture:** Add a focused report-domain helper that derives budget, deadline, and forecast health from existing project report data. Extend the existing project report server action to return these fields and scope project-manager access, then render two compact client components above the existing portfolio table.

**Tech Stack:** Next.js server actions, React 19, TypeScript, Vitest, Testing Library, Drizzle, Tolgee, shadcn-style UI components, Luxon for date math.

---

## File Structure

- Create `apps/webapp/src/lib/reports/project-health.ts`: pure health derivation helpers for budget thresholds, deadline thresholds, selected-range burn-rate forecasting, alert sorting, and portfolio health totals.
- Create `apps/webapp/src/lib/reports/project-health.test.ts`: unit tests for health derivation and forecast behavior.
- Modify `apps/webapp/src/lib/reports/project-types.ts`: add health field types to `ProjectSummary` and budget health totals to `ProjectPortfolioData`.
- Modify `apps/webapp/src/app/[locale]/(app)/reports/projects/actions.ts`: scope portfolio access for assigned project managers and call the health helper while building project summaries.
- Create `apps/webapp/src/components/reports/projects/project-budget-utilization-summary.tsx`: dashboard cards for 70%, 90%, over-budget, and forecast-at-risk counts.
- Create `apps/webapp/src/components/reports/projects/project-health-alerts.tsx`: alert card with sorted alert rows and empty state.
- Create `apps/webapp/src/components/reports/projects/project-health-alerts.test.tsx`: component tests for empty state and alert rendering.
- Modify `apps/webapp/src/components/reports/projects/project-reports-container.tsx`: render the new sections above the portfolio table and reuse existing project detail navigation.
- Modify `apps/webapp/src/components/reports/projects/project-portfolio-table.tsx`: display a compact forecast-risk badge in the Budget column.
- Modify `apps/docs/content/docs/guide/admin-guide/project-reports.mdx`: document health alerts, utilization summary, forecast risk, and project manager visibility.

## Task 1: Health Derivation Helper

**Files:**
- Create: `apps/webapp/src/lib/reports/project-health.ts`
- Create: `apps/webapp/src/lib/reports/project-health.test.ts`
- Modify: `apps/webapp/src/lib/reports/project-types.ts`

- [ ] **Step 1: Add health types to report types**

In `apps/webapp/src/lib/reports/project-types.ts`, add these exports above `ProjectInfo`:

```ts
export type ProjectHealthSeverity = "none" | "warning" | "critical";

export type ProjectBudgetAlertType = "budget_70" | "budget_90" | "budget_100";

export type ProjectDeadlineAlertType =
	| "deadline_14d"
	| "deadline_7d"
	| "deadline_1d"
	| "deadline_today"
	| "deadline_overdue";

export interface ProjectHealthFields {
	budgetSeverity: ProjectHealthSeverity;
	budgetAlertType: ProjectBudgetAlertType | null;
	deadlineSeverity: ProjectHealthSeverity;
	deadlineAlertType: ProjectDeadlineAlertType | null;
	forecastSeverity: ProjectHealthSeverity;
	forecastBudgetExhaustionDate: Date | null;
	forecastMessage: string | null;
}

export interface ProjectBudgetHealthTotals {
	projectsAtOrAbove70Budget: number;
	projectsAtOrAbove90Budget: number;
	projectsOverBudget: number;
	projectsForecastAtRisk: number;
}
```

Change `ProjectSummary` to extend both `ProjectInfo` and `ProjectHealthFields`:

```ts
export interface ProjectSummary extends ProjectInfo, ProjectHealthFields {
	totalHours: number;
	totalMinutes: number;
	percentBudgetUsed: number | null;
	daysUntilDeadline: number | null;
	uniqueEmployees: number;
	workPeriodCount: number;
}
```

Change `ProjectPortfolioData.totals` to include the new nested total:

```ts
export interface ProjectPortfolioData {
	projects: ProjectSummary[];
	totals: {
		totalProjects: number;
		activeProjects: number;
		totalHours: number;
		projectsOverBudget: number;
		projectsOverdue: number;
		budgetHealth: ProjectBudgetHealthTotals;
	};
}
```

- [ ] **Step 2: Write failing unit tests for health derivation**

Create `apps/webapp/src/lib/reports/project-health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildProjectHealthFields,
	buildProjectHealthTotals,
	sortProjectHealthAlerts,
} from "./project-health";
import type { ProjectSummary } from "./project-types";

const now = new Date("2026-05-09T12:00:00.000Z");
const rangeStart = new Date("2026-05-01T00:00:00.000Z");
const rangeEnd = new Date("2026-05-10T00:00:00.000Z");

function makeProject(overrides: Partial<ProjectSummary>): ProjectSummary {
	return {
		id: "project-1",
		name: "Project Apollo",
		description: null,
		status: "active",
		color: null,
		budgetHours: 100,
		deadline: new Date("2026-05-25T00:00:00.000Z"),
		totalHours: 0,
		totalMinutes: 0,
		percentBudgetUsed: null,
		daysUntilDeadline: null,
		uniqueEmployees: 0,
		workPeriodCount: 0,
		budgetSeverity: "none",
		budgetAlertType: null,
		deadlineSeverity: "none",
		deadlineAlertType: null,
		forecastSeverity: "none",
		forecastBudgetExhaustionDate: null,
		forecastMessage: null,
		...overrides,
	};
}

describe("project health derivation", () => {
	it("marks budget thresholds at 70, 90, and 100 percent", () => {
		expect(
			buildProjectHealthFields({
				projectName: "Apollo",
				budgetHours: 100,
				totalHours: 70,
				deadline: null,
				now,
				rangeStart,
				rangeEnd,
			}).budgetAlertType,
		).toBe("budget_70");

		expect(
			buildProjectHealthFields({
				projectName: "Apollo",
				budgetHours: 100,
				totalHours: 90,
				deadline: null,
				now,
				rangeStart,
				rangeEnd,
			}).budgetAlertType,
		).toBe("budget_90");

		const overBudget = buildProjectHealthFields({
			projectName: "Apollo",
			budgetHours: 100,
			totalHours: 101,
			deadline: null,
			now,
			rangeStart,
			rangeEnd,
		});

		expect(overBudget.budgetAlertType).toBe("budget_100");
		expect(overBudget.budgetSeverity).toBe("critical");
	});

	it("marks deadline thresholds and overdue projects", () => {
		expect(
			buildProjectHealthFields({
				projectName: "Apollo",
				budgetHours: null,
				totalHours: 0,
				deadline: new Date("2026-05-23T12:00:00.000Z"),
				now,
				rangeStart,
				rangeEnd,
			}).deadlineAlertType,
		).toBe("deadline_14d");

		expect(
			buildProjectHealthFields({
				projectName: "Apollo",
				budgetHours: null,
				totalHours: 0,
				deadline: new Date("2026-05-09T18:00:00.000Z"),
				now,
				rangeStart,
				rangeEnd,
			}).deadlineAlertType,
		).toBe("deadline_today");

		const overdue = buildProjectHealthFields({
			projectName: "Apollo",
			budgetHours: null,
			totalHours: 0,
			deadline: new Date("2026-05-08T12:00:00.000Z"),
			now,
			rangeStart,
			rangeEnd,
		});

		expect(overdue.deadlineAlertType).toBe("deadline_overdue");
		expect(overdue.deadlineSeverity).toBe("critical");
	});

	it("forecasts budget exhaustion before deadline from selected-range burn rate", () => {
		const health = buildProjectHealthFields({
			projectName: "Apollo",
			budgetHours: 100,
			totalHours: 80,
			deadline: new Date("2026-05-25T00:00:00.000Z"),
			now,
			rangeStart,
			rangeEnd,
		});

		expect(health.forecastSeverity).toBe("warning");
		expect(health.forecastBudgetExhaustionDate?.toISOString()).toBe("2026-05-11T18:00:00.000Z");
		expect(health.forecastMessage).toContain("budget may be exhausted before its deadline");
	});

	it("does not forecast without average daily hours, budget, or deadline", () => {
		for (const params of [
			{ budgetHours: 100, totalHours: 0, deadline: new Date("2026-05-25T00:00:00.000Z") },
			{ budgetHours: null, totalHours: 80, deadline: new Date("2026-05-25T00:00:00.000Z") },
			{ budgetHours: 100, totalHours: 80, deadline: null },
		]) {
			expect(
				buildProjectHealthFields({
					projectName: "Apollo",
					...params,
					now,
					rangeStart,
					rangeEnd,
				}).forecastSeverity,
			).toBe("none");
		}
	});

	it("builds budget health totals", () => {
		const totals = buildProjectHealthTotals([
			makeProject({ id: "a", percentBudgetUsed: 71 }),
			makeProject({ id: "b", percentBudgetUsed: 95 }),
			makeProject({ id: "c", percentBudgetUsed: 120, budgetSeverity: "critical", budgetAlertType: "budget_100" }),
			makeProject({ id: "d", percentBudgetUsed: null, budgetHours: null }),
			makeProject({ id: "e", percentBudgetUsed: 40, forecastSeverity: "warning" }),
		]);

		expect(totals).toEqual({
			projectsAtOrAbove70Budget: 3,
			projectsAtOrAbove90Budget: 2,
			projectsOverBudget: 1,
			projectsForecastAtRisk: 1,
		});
	});

	it("sorts health alerts by severity and risk", () => {
		const sorted = sortProjectHealthAlerts([
			makeProject({ id: "warning", name: "Warning", budgetSeverity: "warning", percentBudgetUsed: 75 }),
			makeProject({ id: "critical", name: "Critical", budgetSeverity: "critical", percentBudgetUsed: 105 }),
			makeProject({ id: "none", name: "None", percentBudgetUsed: 20 }),
		]);

		expect(sorted.map((project) => project.id)).toEqual(["critical", "warning"]);
	});
});
```

- [ ] **Step 3: Run the helper test to verify it fails**

Run: `pnpm --dir apps/webapp vitest run src/lib/reports/project-health.test.ts`

Expected: FAIL with an import error because `./project-health` does not exist.

- [ ] **Step 4: Implement the health helper**

Create `apps/webapp/src/lib/reports/project-health.ts`:

```ts
import { DateTime } from "luxon";
import type {
	ProjectBudgetAlertType,
	ProjectBudgetHealthTotals,
	ProjectDeadlineAlertType,
	ProjectHealthFields,
	ProjectHealthSeverity,
	ProjectSummary,
} from "./project-types";

interface BuildProjectHealthFieldsParams {
	projectName: string;
	budgetHours: number | null;
	totalHours: number;
	deadline: Date | null;
	now: Date;
	rangeStart: Date;
	rangeEnd: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildProjectHealthFields(params: BuildProjectHealthFieldsParams): ProjectHealthFields {
	const percentBudgetUsed = params.budgetHours ? (params.totalHours / params.budgetHours) * 100 : null;
	const budgetAlertType = getBudgetAlertType(percentBudgetUsed);
	const deadlineAlertType = getDeadlineAlertType(params.deadline, params.now);
	const forecast = buildForecastHealth(params);

	return {
		budgetSeverity: getBudgetSeverity(budgetAlertType),
		budgetAlertType,
		deadlineSeverity: getDeadlineSeverity(deadlineAlertType),
		deadlineAlertType,
		forecastSeverity: forecast.forecastSeverity,
		forecastBudgetExhaustionDate: forecast.forecastBudgetExhaustionDate,
		forecastMessage: forecast.forecastMessage,
	};
}

export function buildProjectHealthTotals(projects: ProjectSummary[]): ProjectBudgetHealthTotals {
	return {
		projectsAtOrAbove70Budget: projects.filter(
			(project) => project.percentBudgetUsed !== null && project.percentBudgetUsed >= 70,
		).length,
		projectsAtOrAbove90Budget: projects.filter(
			(project) => project.percentBudgetUsed !== null && project.percentBudgetUsed >= 90,
		).length,
		projectsOverBudget: projects.filter(
			(project) => project.percentBudgetUsed !== null && project.percentBudgetUsed >= 100,
		).length,
		projectsForecastAtRisk: projects.filter((project) => project.forecastSeverity !== "none").length,
	};
}

export function sortProjectHealthAlerts(projects: ProjectSummary[]): ProjectSummary[] {
	return projects
		.filter(hasProjectHealthAlert)
		.toSorted((a, b) => {
			const severityDifference = getProjectSeverityRank(b) - getProjectSeverityRank(a);
			if (severityDifference !== 0) return severityDifference;

			const aDeadline = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
			const bDeadline = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
			if (aDeadline !== bDeadline) return aDeadline - bDeadline;

			return (b.percentBudgetUsed ?? 0) - (a.percentBudgetUsed ?? 0);
		});
}

export function hasProjectHealthAlert(project: ProjectSummary): boolean {
	return (
		project.budgetSeverity !== "none" ||
		project.deadlineSeverity !== "none" ||
		project.forecastSeverity !== "none"
	);
}

function getBudgetAlertType(percentBudgetUsed: number | null): ProjectBudgetAlertType | null {
	if (percentBudgetUsed === null) return null;
	if (percentBudgetUsed >= 100) return "budget_100";
	if (percentBudgetUsed >= 90) return "budget_90";
	if (percentBudgetUsed >= 70) return "budget_70";
	return null;
}

function getBudgetSeverity(alertType: ProjectBudgetAlertType | null): ProjectHealthSeverity {
	if (alertType === "budget_100") return "critical";
	if (alertType) return "warning";
	return "none";
}

function getDeadlineAlertType(deadline: Date | null, now: Date): ProjectDeadlineAlertType | null {
	if (!deadline) return null;

	const today = DateTime.fromJSDate(now).startOf("day");
	const deadlineDay = DateTime.fromJSDate(deadline).startOf("day");
	const daysUntilDeadline = Math.ceil(deadlineDay.diff(today, "days").days);

	if (daysUntilDeadline < 0) return "deadline_overdue";
	if (daysUntilDeadline === 0) return "deadline_today";
	if (daysUntilDeadline <= 1) return "deadline_1d";
	if (daysUntilDeadline <= 7) return "deadline_7d";
	if (daysUntilDeadline <= 14) return "deadline_14d";
	return null;
}

function getDeadlineSeverity(alertType: ProjectDeadlineAlertType | null): ProjectHealthSeverity {
	if (alertType === "deadline_overdue" || alertType === "deadline_today") return "critical";
	if (alertType) return "warning";
	return "none";
}

function buildForecastHealth(params: BuildProjectHealthFieldsParams): Pick<
	ProjectHealthFields,
	"forecastSeverity" | "forecastBudgetExhaustionDate" | "forecastMessage"
> {
	if (!params.budgetHours || !params.deadline || params.totalHours <= 0 || params.totalHours >= params.budgetHours) {
		return { forecastSeverity: "none", forecastBudgetExhaustionDate: null, forecastMessage: null };
	}

	const rangeDays = Math.max(1, (params.rangeEnd.getTime() - params.rangeStart.getTime()) / MS_PER_DAY);
	const averageDailyHours = params.totalHours / rangeDays;
	if (averageDailyHours <= 0) {
		return { forecastSeverity: "none", forecastBudgetExhaustionDate: null, forecastMessage: null };
	}

	const remainingBudgetHours = params.budgetHours - params.totalHours;
	const daysUntilBudgetExhaustion = remainingBudgetHours / averageDailyHours;
	const forecastBudgetExhaustionDate = DateTime.fromJSDate(params.now)
		.plus({ days: daysUntilBudgetExhaustion })
		.toJSDate();

	if (forecastBudgetExhaustionDate.getTime() >= params.deadline.getTime()) {
		return { forecastSeverity: "none", forecastBudgetExhaustionDate: null, forecastMessage: null };
	}

	const deadlineBufferDays = (params.deadline.getTime() - forecastBudgetExhaustionDate.getTime()) / MS_PER_DAY;
	const forecastSeverity: ProjectHealthSeverity = deadlineBufferDays <= 3 ? "critical" : "warning";

	return {
		forecastSeverity,
		forecastBudgetExhaustionDate,
		forecastMessage: `${params.projectName} budget may be exhausted before its deadline at the current burn rate.`,
	};
}

function getProjectSeverityRank(project: ProjectSummary): number {
	const severities = [project.budgetSeverity, project.deadlineSeverity, project.forecastSeverity];
	if (severities.includes("critical")) return 2;
	if (severities.includes("warning")) return 1;
	return 0;
}
```

- [ ] **Step 5: Run the helper test to verify it passes**

Run: `pnpm --dir apps/webapp vitest run src/lib/reports/project-health.test.ts`

Expected: PASS for all `project health derivation` tests.

- [ ] **Step 6: Commit the helper**

```bash
git add apps/webapp/src/lib/reports/project-types.ts apps/webapp/src/lib/reports/project-health.ts apps/webapp/src/lib/reports/project-health.test.ts
git commit -m "feat: add project health derivation"
```

## Task 2: Portfolio Report Data And Project-Manager Scope

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/reports/projects/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/reports/projects/actions.scope.test.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/reports/projects/actions.scope.test.ts`

- [ ] **Step 1: Write a source-level scope regression test**

Create `apps/webapp/src/app/[locale]/(app)/reports/projects/actions.scope.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPORTS_PROJECTS_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("project report portfolio scope", () => {
	it("allows assigned project managers and scopes them to managed projects", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("getManagedProjectIdsForProjectReports");
		expect(source).toContain("currentEmployee.role === \"admin\" || currentEmployee.role === \"manager\"");
		expect(source).toContain("managedProjectIds.size > 0");
		expect(source).toContain("inArray(project.id, [...managedProjectIds])");
	});
});
```

- [ ] **Step 2: Run the scope test to verify it fails**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(app)/reports/projects/actions.scope.test.ts'`

Expected: FAIL because `getManagedProjectIdsForProjectReports`, `managedProjectIds.size > 0`, and managed project filtering are not in `actions.ts` yet.

- [ ] **Step 3: Add health helper imports**

In `apps/webapp/src/app/[locale]/(app)/reports/projects/actions.ts`, add:

```ts
import { buildProjectHealthFields, buildProjectHealthTotals } from "@/lib/reports/project-health";
```

- [ ] **Step 4: Allow assigned project managers into portfolio reports**

Replace the current role check in `getProjectsOverview`:

```ts
if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
	return yield* _(
		Effect.fail(
			new AuthorizationError({
				message: "You don't have permission to view project reports",
			}),
		),
	);
}
```

with:

```ts
const managedProjectRows = yield* _(
	dbService.query("getManagedProjectIdsForProjectReports", async () => {
		return await dbService.db.query.projectManager.findMany({
			where: eq(projectManager.employeeId, currentEmployee.id),
			columns: { projectId: true },
		});
	}),
);
const managedProjectIds = new Set(managedProjectRows.map((row) => row.projectId));
const canViewPortfolio =
	currentEmployee.role === "admin" || currentEmployee.role === "manager" || managedProjectIds.size > 0;

if (!canViewPortfolio) {
	return yield* _(
		Effect.fail(
			new AuthorizationError({
				message: "You don't have permission to view project reports",
			}),
		),
	);
}
```

- [ ] **Step 5: Scope queried projects for assigned project managers**

Inside the `getProjects` query block, after status filtering, add project ID filtering for project-manager-only users:

```ts
const isOrgWideReportViewer = currentEmployee.role === "admin" || currentEmployee.role === "manager";

if (!isOrgWideReportViewer) {
	whereConditions.push(inArray(project.id, [...managedProjectIds]));
}
```

Keep the existing organization condition:

```ts
const whereConditions = [eq(project.organizationId, organizationId)];
```

- [ ] **Step 6: Compute health fields for each summary**

Before the project summary loop, add:

```ts
const now = new Date();
```

Inside the loop, replace the current inline `new Date()` for deadline math with `now`:

```ts
const diffMs = p.deadline.getTime() - now.getTime();
```

Immediately before `summaries.push`, add:

```ts
const healthFields = buildProjectHealthFields({
	projectName: p.name,
	budgetHours,
	totalHours,
	deadline: p.deadline,
	now,
	rangeStart: startDate,
	rangeEnd: endDate,
});
```

Add the fields to the pushed object:

```ts
...healthFields,
```

The `summaries.push` object should include all existing fields plus `...healthFields`.

- [ ] **Step 7: Add budget health totals to the response**

Replace the totals object with:

```ts
const budgetHealth = buildProjectHealthTotals(projectSummaries);
const totals = {
	totalProjects: projectSummaries.length,
	activeProjects: projectSummaries.filter((p) => p.status === "active").length,
	totalHours: projectSummaries.reduce((sum, p) => sum + p.totalHours, 0),
	projectsOverBudget: projectSummaries.filter(
		(p) => p.percentBudgetUsed !== null && p.percentBudgetUsed > 100,
	).length,
	projectsOverdue: projectSummaries.filter(
		(p) => p.daysUntilDeadline !== null && p.daysUntilDeadline < 0,
	).length,
	budgetHealth,
};
```

- [ ] **Step 8: Run focused tests and type check via build**

Run: `pnpm --dir apps/webapp vitest run src/lib/reports/project-health.test.ts`

Expected: PASS.

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(app)/reports/projects/actions.scope.test.ts'`

Expected: PASS.

Run: `CI=true pnpm build`

Expected: PASS. If build cannot run because environment variables are unavailable to agents, record the skipped build and continue with tests only.

- [ ] **Step 9: Commit report data changes**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/reports/projects/actions.ts' 'apps/webapp/src/app/[locale]/(app)/reports/projects/actions.scope.test.ts'
git commit -m "feat: add project health data to reports"
```

## Task 3: Project Health UI Components

**Files:**
- Create: `apps/webapp/src/components/reports/projects/project-budget-utilization-summary.tsx`
- Create: `apps/webapp/src/components/reports/projects/project-health-alerts.tsx`
- Create: `apps/webapp/src/components/reports/projects/project-health-alerts.test.tsx`

- [ ] **Step 1: Write component tests**

Create `apps/webapp/src/components/reports/projects/project-health-alerts.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@/lib/reports/project-types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, defaultValue?: string, values?: Record<string, string | number>) => {
		if (!defaultValue) return _key;
		return Object.entries(values ?? {}).reduce(
			(text, [key, value]) => text.replace(`{${key}}`, String(value)),
			defaultValue,
		);
	} }),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
		<button type="button" onClick={onClick}>{children}</button>
	),
}));

function makeProject(overrides: Partial<ProjectSummary>): ProjectSummary {
	return {
		id: "project-1",
		name: "Project Apollo",
		description: null,
		status: "active",
		color: null,
		budgetHours: 100,
		deadline: new Date("2026-05-25T00:00:00.000Z"),
		totalHours: 92,
		totalMinutes: 5520,
		percentBudgetUsed: 92,
		daysUntilDeadline: 16,
		uniqueEmployees: 3,
		workPeriodCount: 12,
		budgetSeverity: "warning",
		budgetAlertType: "budget_90",
		deadlineSeverity: "none",
		deadlineAlertType: null,
		forecastSeverity: "none",
		forecastBudgetExhaustionDate: null,
		forecastMessage: null,
		...overrides,
	};
}

describe("ProjectHealthAlerts", () => {
	it("renders an empty state when no projects have alerts", async () => {
		const { ProjectHealthAlerts } = await import("./project-health-alerts");

		render(<ProjectHealthAlerts projects={[makeProject({ budgetSeverity: "none", budgetAlertType: null, percentBudgetUsed: 20 })]} onProjectSelect={() => undefined} />);

		expect(screen.getByText("No budget or deadline risks in this report period.")).toBeTruthy();
	});

	it("renders budget and forecast alert details", async () => {
		const { ProjectHealthAlerts } = await import("./project-health-alerts");
		const project = makeProject({
			forecastSeverity: "warning",
			forecastBudgetExhaustionDate: new Date("2026-05-20T00:00:00.000Z"),
			forecastMessage: "Project Apollo budget may be exhausted before its deadline at the current burn rate.",
		});

		render(<ProjectHealthAlerts projects={[project]} onProjectSelect={() => undefined} />);

		expect(screen.getByText("Project Apollo")).toBeTruthy();
		expect(screen.getByText("92% budget used")).toBeTruthy();
		expect(screen.getByText(/budget may be exhausted before its deadline/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "View details" })).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run: `pnpm --dir apps/webapp vitest run src/components/reports/projects/project-health-alerts.test.tsx`

Expected: FAIL with an import error because `./project-health-alerts` does not exist.

- [ ] **Step 3: Implement utilization summary component**

Create `apps/webapp/src/components/reports/projects/project-budget-utilization-summary.tsx`:

```tsx
"use client";

import { IconAlertTriangle, IconChartBar, IconTrendingUp } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectBudgetHealthTotals } from "@/lib/reports/project-types";

interface ProjectBudgetUtilizationSummaryProps {
	totals: ProjectBudgetHealthTotals;
}

export function ProjectBudgetUtilizationSummary({ totals }: ProjectBudgetUtilizationSummaryProps) {
	const { t } = useTranslate();

	const cards = [
		{
			label: t("reports.projects.health.atOrAbove70", "At or above 70%"),
			value: totals.projectsAtOrAbove70Budget,
			description: t("reports.projects.health.atOrAbove70Description", "Budget usage needs monitoring"),
			icon: IconChartBar,
			valueClassName: "text-amber-600",
		},
		{
			label: t("reports.projects.health.atOrAbove90", "At or above 90%"),
			value: totals.projectsAtOrAbove90Budget,
			description: t("reports.projects.health.atOrAbove90Description", "Close to budget limit"),
			icon: IconTrendingUp,
			valueClassName: "text-amber-700 dark:text-amber-400",
		},
		{
			label: t("reports.projects.health.overBudget", "Over budget"),
			value: totals.projectsOverBudget,
			description: t("reports.projects.health.overBudgetDescription", "Exceeded budget hours"),
			icon: IconAlertTriangle,
			valueClassName: "text-red-600",
		},
		{
			label: t("reports.projects.health.forecastAtRisk", "Forecast at risk"),
			value: totals.projectsForecastAtRisk,
			description: t("reports.projects.health.forecastAtRiskDescription", "Projected to exhaust budget"),
			icon: IconAlertTriangle,
			valueClassName: "text-red-600",
		},
	];

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{cards.map((card) => {
				const Icon = card.icon;
				return (
					<Card key={card.label}>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">{card.label}</CardTitle>
							<Icon className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className={`text-2xl font-bold tabular-nums ${card.valueClassName}`}>{card.value}</div>
							<p className="text-xs text-muted-foreground">{card.description}</p>
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 4: Implement health alerts component**

Create `apps/webapp/src/components/reports/projects/project-health-alerts.tsx`:

```tsx
"use client";

import { IconAlertTriangle, IconCalendarDue, IconChartBar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sortProjectHealthAlerts } from "@/lib/reports/project-health";
import type { ProjectSummary } from "@/lib/reports/project-types";
import { cn } from "@/lib/utils";

interface ProjectHealthAlertsProps {
	projects: ProjectSummary[];
	onProjectSelect: (projectId: string) => void;
}

export function ProjectHealthAlerts({ projects, onProjectSelect }: ProjectHealthAlertsProps) {
	const { t } = useTranslate();
	const alertProjects = sortProjectHealthAlerts(projects);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconAlertTriangle className="h-5 w-5 text-amber-500" />
					{t("reports.projects.health.alertsTitle", "Project Health Alerts")}
				</CardTitle>
				<CardDescription>
					{t("reports.projects.health.alertsDescription", "Budget, deadline, and forecast risks in this report period")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{alertProjects.length === 0 ? (
					<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
						{t("reports.projects.health.noAlerts", "No budget or deadline risks in this report period.")}
					</p>
				) : (
					<div className="space-y-3">
						{alertProjects.map((project) => (
							<div key={project.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
								<div className="min-w-0 space-y-2">
									<div className="flex flex-wrap items-center gap-2">
										<p className="font-medium">{project.name}</p>
										<SeverityBadge project={project} />
									</div>
									<div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
										{project.percentBudgetUsed !== null && (
											<span className="inline-flex items-center gap-1">
												<IconChartBar className="h-4 w-4" />
												{t("reports.projects.health.budgetUsed", "{percent}% budget used", { percent: project.percentBudgetUsed.toFixed(0) })}
											</span>
										)}
										{project.daysUntilDeadline !== null && (
											<span className="inline-flex items-center gap-1">
												<IconCalendarDue className="h-4 w-4" />
												{formatDeadline(project.daysUntilDeadline)}
											</span>
										)}
									</div>
									<p className="text-sm">{getAlertReason(project)}</p>
								</div>
								<Button variant="outline" size="sm" onClick={() => onProjectSelect(project.id)}>
									{t("reports.projects.health.viewDetails", "View details")}
								</Button>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);

	function formatDeadline(daysUntilDeadline: number) {
		if (daysUntilDeadline < 0) return t("reports.projects.health.daysOverdue", "{days}d overdue", { days: Math.abs(daysUntilDeadline) });
		if (daysUntilDeadline === 0) return t("reports.projects.health.dueToday", "Due today");
		return t("reports.projects.health.daysLeft", "{days}d left", { days: daysUntilDeadline });
	}

	function getAlertReason(project: ProjectSummary) {
		if (project.budgetAlertType === "budget_100") return t("reports.projects.health.reasonOverBudget", "Project has exceeded its budget.");
		if (project.deadlineAlertType === "deadline_overdue") return t("reports.projects.health.reasonOverdue", "Project is past its deadline.");
		if (project.deadlineAlertType === "deadline_today") return t("reports.projects.health.reasonDueToday", "Project deadline is today.");
		if (project.forecastMessage) return project.forecastMessage;
		if (project.budgetAlertType) return t("reports.projects.health.reasonBudgetWarning", "Project is approaching its budget limit.");
		if (project.deadlineAlertType) return t("reports.projects.health.reasonDeadlineWarning", "Project deadline is approaching.");
		return t("reports.projects.health.reasonRisk", "Project needs review.");
	}
}

function SeverityBadge({ project }: { project: ProjectSummary }) {
	const severity = [project.budgetSeverity, project.deadlineSeverity, project.forecastSeverity].includes("critical")
		? "critical"
		: "warning";
	return (
		<Badge variant="secondary" className={cn(severity === "critical" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300")}>
			{severity === "critical" ? "Critical" : "Warning"}
		</Badge>
	);
}
```

- [ ] **Step 5: Run component tests to verify they pass**

Run: `pnpm --dir apps/webapp vitest run src/components/reports/projects/project-health-alerts.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit UI components**

```bash
git add apps/webapp/src/components/reports/projects/project-budget-utilization-summary.tsx apps/webapp/src/components/reports/projects/project-health-alerts.tsx apps/webapp/src/components/reports/projects/project-health-alerts.test.tsx
git commit -m "feat: add project health report components"
```

## Task 4: Wire Components Into Project Reports

**Files:**
- Modify: `apps/webapp/src/components/reports/projects/project-reports-container.tsx`
- Modify: `apps/webapp/src/components/reports/projects/project-portfolio-table.tsx`

- [ ] **Step 1: Import new components**

In `apps/webapp/src/components/reports/projects/project-reports-container.tsx`, add:

```ts
import { ProjectBudgetUtilizationSummary } from "./project-budget-utilization-summary";
import { ProjectHealthAlerts } from "./project-health-alerts";
```

- [ ] **Step 2: Render health sections above the portfolio table**

In the portfolio tab, replace:

```tsx
{/* Portfolio Table */}
<ProjectPortfolioTable
	projects={portfolioData.projects}
	onProjectSelect={handleSelectProject}
/>
```

with:

```tsx
<ProjectHealthAlerts projects={portfolioData.projects} onProjectSelect={handleSelectProject} />

<ProjectBudgetUtilizationSummary totals={portfolioData.totals.budgetHealth} />

{/* Portfolio Table */}
<ProjectPortfolioTable
	projects={portfolioData.projects}
	onProjectSelect={handleSelectProject}
/>
```

- [ ] **Step 3: Add a compact forecast badge to the budget column**

In `apps/webapp/src/components/reports/projects/project-portfolio-table.tsx`, inside the Budget column cell after `<Progress ... />`, add:

```tsx
{project.forecastSeverity !== "none" && (
	<Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
		{t("reports.projects.table.forecastRisk", "Forecast risk")}
	</Badge>
)}
```

Keep the existing `project.budgetHours === null` branch unchanged so projects without budgets still display an em dash.

- [ ] **Step 4: Run focused component and helper tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/reports/project-health.test.ts src/components/reports/projects/project-health-alerts.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run build or record skipped environment dependency**

Run: `CI=true pnpm build`

Expected: PASS. If unavailable system environment variables block the build, record the exact missing variable reason in the final implementation notes.

- [ ] **Step 6: Commit report UI wiring**

```bash
git add apps/webapp/src/components/reports/projects/project-reports-container.tsx apps/webapp/src/components/reports/projects/project-portfolio-table.tsx
git commit -m "feat: surface project health on reports"
```

## Task 5: Documentation And Final Verification

**Files:**
- Modify: `apps/docs/content/docs/guide/admin-guide/project-reports.mdx`

- [ ] **Step 1: Update Project Reports documentation**

In `apps/docs/content/docs/guide/admin-guide/project-reports.mdx`, update the overview paragraph from:

```mdx
Project Reports provide comprehensive analytics for tracking project health, budget utilization, and team performance. Two report views are available:
```

to:

```mdx
Project Reports provide comprehensive analytics for tracking project health, budget utilization, deadline risk, and team performance. After a report is generated, Z8 highlights budget and deadline alerts using the selected report period.
```

After the Summary Cards table, add:

```mdx
### Project Health Alerts

The health alert panel highlights projects that need review:

- **Budget threshold alerts** when a project reaches 70%, 90%, or 100% of its budgeted hours
- **Deadline alerts** when a project is due within 14 days, 7 days, 1 day, due today, or overdue
- **Forecast risks** when the selected period's average daily hours indicate the budget may be exhausted before the project deadline

Forecast risk uses a simple burn-rate calculation based on the generated report range. Projects without both a budget and a deadline are excluded from forecast risk, but they can still show budget or deadline threshold alerts when applicable.

### Budget Utilization Summary

The budget utilization summary shows how many projects are:

- At or above 70% budget used
- At or above 90% budget used
- Over budget
- Forecast at risk

Admins and managers can review all projects in their organization. Assigned project managers can review health data for projects they manage.
```

- [ ] **Step 2: Run final focused tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/reports/project-health.test.ts src/components/reports/projects/project-health-alerts.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run full webapp tests**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

- [ ] **Step 4: Run production build or record skipped environment dependency**

Run: `CI=true pnpm build`

Expected: PASS. If unavailable system environment variables block the build, record the exact skipped command and reason.

- [ ] **Step 5: Review git diff for scope**

Run: `git diff --stat HEAD`

Expected: only project health report files and project reports documentation changed since the last task commit.

- [ ] **Step 6: Commit docs and verification updates**

```bash
git add apps/docs/content/docs/guide/admin-guide/project-reports.mdx
git commit -m "docs: document project health reports"
```

## Self-Review

Spec coverage:

- Project health alerts: Task 3 creates `ProjectHealthAlerts`; Task 4 renders it.
- Budget utilization summary: Task 3 creates `ProjectBudgetUtilizationSummary`; Task 4 renders it.
- Simple forecast risk: Task 1 implements selected-range burn-rate forecasting.
- Admins/managers/project managers access: Task 2 scopes portfolio reports.
- Existing thresholds: Task 1 implements 70/90/100 budget and 14/7/1/today/overdue deadline thresholds.
- No database migration or notification delivery: no task creates schema changes or notification changes.
- Documentation: Task 5 updates the admin guide.

Placeholder scan: no placeholder steps are intentionally left. If implementation reveals a command blocked by missing Phase-managed environment variables, record the skipped command and exact reason rather than inventing a workaround.

Type consistency: health field names match the design spec and are used consistently across helper, action, and components.
