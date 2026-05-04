# Manager Today Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Manager Today dashboard body with a compact, data-backed summary from the existing Manager Daily Briefing counts.

**Architecture:** Add a small dashboard server action that resolves the current employee and returns a dashboard-shaped summary for managers/admins. Keep count aggregation in a pure helper colocated with the widget so it is easy to test. Update the client widget to render a two-by-two count grid, an all-clear message, and an inline error state while preserving role-based hiding.

**Tech Stack:** Next.js server actions, React client components, TanStack Query, Tolgee, Vitest, React Testing Library, Luxon through the existing briefing loader.

---

## File Structure

- Modify `apps/webapp/src/components/dashboard/manager-today-widget.tsx`: add the pure count mapper, fetch the new action with TanStack Query, and render the compact metric grid.
- Modify `apps/webapp/src/components/dashboard/actions.ts`: add `getManagerTodaySummary()` server action that uses the existing auth/session and `getManagerDailyBriefing` loader.
- Modify `apps/webapp/messages/dashboard/en.json`: add user-facing labels and fallback/error/all-clear copy for the new metric grid.
- Create `apps/webapp/src/components/dashboard/manager-today-widget.test.tsx`: test the pure mapper and widget rendering states with mocked server actions.

---

### Task 1: Add Manager Today Count Mapper Tests

**Files:**
- Create: `apps/webapp/src/components/dashboard/manager-today-widget.test.tsx`
- Modify later: `apps/webapp/src/components/dashboard/manager-today-widget.tsx`

- [ ] **Step 1: Write the failing mapper tests**

Create `apps/webapp/src/components/dashboard/manager-today-widget.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { mapManagerTodaySummary } from "./manager-today-widget";

describe("mapManagerTodaySummary", () => {
	it("maps briefing summary counts into dashboard metrics", () => {
		expect(
			mapManagerTodaySummary({
				criticalIssues: 2,
				openApprovals: 5,
				attendanceExceptions: 3,
				absencesToday: 4,
				coverageRisks: 7,
				overtimeWarnings: 11,
				payrollIssues: 13,
			}),
		).toEqual({
			critical: 2,
			approvals: 5,
			clockIns: 3,
			risks: 31,
		});
	});

	it("reports all clear when every displayed count is zero", () => {
		expect(
			mapManagerTodaySummary({
				criticalIssues: 0,
				openApprovals: 0,
				attendanceExceptions: 0,
				absencesToday: 4,
				coverageRisks: 0,
				overtimeWarnings: 0,
				payrollIssues: 0,
			}).allClear,
		).toBe(true);
	});
});
```

- [ ] **Step 2: Run mapper tests and verify failure**

Run: `pnpm --dir apps/webapp test src/components/dashboard/manager-today-widget.test.tsx`

Expected: FAIL because `mapManagerTodaySummary` is not exported from `manager-today-widget.tsx`.

- [ ] **Step 3: Add the minimal mapper implementation**

Modify `apps/webapp/src/components/dashboard/manager-today-widget.tsx` near the top, after `type EmployeeRole`:

```tsx
export type ManagerTodayBriefingSummary = {
	criticalIssues: number;
	openApprovals: number;
	attendanceExceptions: number;
	absencesToday: number;
	coverageRisks: number;
	overtimeWarnings: number;
	payrollIssues: number;
};

export type ManagerTodayMetricCounts = {
	critical: number;
	approvals: number;
	clockIns: number;
	risks: number;
	allClear: boolean;
};

export function mapManagerTodaySummary(
	summary: ManagerTodayBriefingSummary,
): ManagerTodayMetricCounts {
	const counts = {
		critical: summary.criticalIssues,
		approvals: summary.openApprovals,
		clockIns: summary.attendanceExceptions,
		risks: summary.coverageRisks + summary.overtimeWarnings + summary.payrollIssues,
	};

	return {
		...counts,
		allClear: Object.values(counts).every((count) => count === 0),
	};
}
```

- [ ] **Step 4: Run mapper tests and verify pass**

Run: `pnpm --dir apps/webapp test src/components/dashboard/manager-today-widget.test.tsx`

Expected: PASS for both mapper tests.

- [ ] **Step 5: Commit the mapper tests and helper**

Run:

```bash
git add apps/webapp/src/components/dashboard/manager-today-widget.tsx apps/webapp/src/components/dashboard/manager-today-widget.test.tsx
git commit -m "test: cover manager today count mapping"
```

Expected: commit succeeds. If the user has not requested commits in the active session, skip this step and mention it in the handoff.

---

### Task 2: Add Dashboard Server Action

**Files:**
- Modify: `apps/webapp/src/components/dashboard/actions.ts`
- Test later through widget mocks in `apps/webapp/src/components/dashboard/manager-today-widget.test.tsx`

- [ ] **Step 1: Add the briefing import and summary action**

Modify `apps/webapp/src/components/dashboard/actions.ts` imports:

```ts
import { getManagerDailyBriefing } from "@/lib/manager-daily-briefing/get-manager-daily-briefing";
```

Add this server action near the other dashboard actions, before `getManagedEmployees`:

```ts
export type ManagerTodaySummaryResult = {
	role: "admin" | "manager" | "employee" | null;
	summary: {
		criticalIssues: number;
		openApprovals: number;
		attendanceExceptions: number;
		absencesToday: number;
		coverageRisks: number;
		overtimeWarnings: number;
		payrollIssues: number;
	} | null;
};

export async function getManagerTodaySummary(): Promise<ManagerTodaySummaryResult> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const currentEmployee = yield* _(
			dbService.query("getManagerTodayCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
					columns: {
						id: true,
						role: true,
						organizationId: true,
					},
				});
			}),
		);

		if (!currentEmployee) {
			return { role: null, summary: null };
		}

		const role = currentEmployee.role as "admin" | "manager" | "employee";

		if (role !== "admin" && role !== "manager") {
			return { role, summary: null };
		}

		if (!currentEmployee.organizationId) {
			return { role, summary: null };
		}

		const briefing = yield* _(
			Effect.tryPromise({
				try: () =>
					getManagerDailyBriefing({
						currentEmployee: {
							id: currentEmployee.id,
							role,
							organizationId: currentEmployee.organizationId,
						},
					}),
				catch: (error) => error as AnyAppError,
			}),
		);

		return { role, summary: briefing.summary };
	}).pipe(Effect.provide(AppLayer));

	const result = await runServerActionSafe(effect);

	if (!result.success) {
		throw result.error;
	}

	return result.data;
}
```

- [ ] **Step 2: Run TypeScript/check command for immediate feedback**

Run: `pnpm --dir apps/webapp test src/components/dashboard/manager-today-widget.test.tsx`

Expected: PASS for existing mapper tests. If TypeScript reports that `AnyAppError` is not assignable from `unknown`, replace the catch block with `catch: () => new Error("Failed to load manager today summary") as AnyAppError` and rerun.

- [ ] **Step 3: Commit the server action**

Run:

```bash
git add apps/webapp/src/components/dashboard/actions.ts
git commit -m "feat: add manager today summary action"
```

Expected: commit succeeds. If the user has not requested commits in the active session, skip this step and mention it in the handoff.

---

### Task 3: Render Manager Today Metrics

**Files:**
- Modify: `apps/webapp/src/components/dashboard/manager-today-widget.tsx`
- Modify: `apps/webapp/messages/dashboard/en.json`
- Modify: `apps/webapp/src/components/dashboard/manager-today-widget.test.tsx`

- [ ] **Step 1: Replace the mapper-only test file with widget render tests**

Replace `apps/webapp/src/components/dashboard/manager-today-widget.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getManagerTodaySummary } from "./actions";
import { ManagerTodayWidget, mapManagerTodaySummary } from "./manager-today-widget";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));

vi.mock("@dnd-kit/utilities", () => ({
	CSS: { Translate: { toString: () => undefined } },
}));

vi.mock("./widget-visibility-context", () => ({
	useRegisterVisibleWidget: vi.fn(),
}));

vi.mock("./actions", () => ({
	getManagerTodaySummary: vi.fn(),
}));

const mockedGetManagerTodaySummary = vi.mocked(getManagerTodaySummary);

function renderWidget() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});

	return render(
		<QueryClientProvider client={queryClient}>
			<ManagerTodayWidget />
		</QueryClientProvider>,
	);
}

describe("mapManagerTodaySummary", () => {
	it("maps briefing summary counts into dashboard metrics", () => {
		expect(
			mapManagerTodaySummary({
				criticalIssues: 2,
				openApprovals: 5,
				attendanceExceptions: 3,
				absencesToday: 4,
				coverageRisks: 7,
				overtimeWarnings: 11,
				payrollIssues: 13,
			}),
		).toEqual({
			critical: 2,
			approvals: 5,
			clockIns: 3,
			risks: 31,
			allClear: false,
		});
	});

	it("reports all clear when every displayed count is zero", () => {
		expect(
			mapManagerTodaySummary({
				criticalIssues: 0,
				openApprovals: 0,
				attendanceExceptions: 0,
				absencesToday: 4,
				coverageRisks: 0,
				overtimeWarnings: 0,
				payrollIssues: 0,
			}).allClear,
		).toBe(true);
	});
});

describe("ManagerTodayWidget", () => {
	beforeEach(() => {
		mockedGetManagerTodaySummary.mockReset();
	});

	it("renders briefing counts for managers", async () => {
		mockedGetManagerTodaySummary.mockResolvedValue({
			role: "manager",
			summary: {
				criticalIssues: 1,
				openApprovals: 2,
				attendanceExceptions: 3,
				absencesToday: 0,
				coverageRisks: 4,
				overtimeWarnings: 5,
				payrollIssues: 6,
			},
		});

		renderWidget();

		await waitFor(() => expect(screen.getByText("Critical")).toBeInTheDocument());
		expect(screen.getByText("1")).toBeInTheDocument();
		expect(screen.getByText("Approvals")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
		expect(screen.getByText("Clock-ins")).toBeInTheDocument();
		expect(screen.getByText("3")).toBeInTheDocument();
		expect(screen.getByText("Risks")).toBeInTheDocument();
		expect(screen.getByText("15")).toBeInTheDocument();
	});

	it("shows all-clear copy when displayed counts are zero", async () => {
		mockedGetManagerTodaySummary.mockResolvedValue({
			role: "admin",
			summary: {
				criticalIssues: 0,
				openApprovals: 0,
				attendanceExceptions: 0,
				absencesToday: 2,
				coverageRisks: 0,
				overtimeWarnings: 0,
				payrollIssues: 0,
			},
		});

		renderWidget();

		expect(
			await screen.findByText("No manager action is flagged right now."),
		).toBeInTheDocument();
	});

	it("does not render for employees", async () => {
		mockedGetManagerTodaySummary.mockResolvedValue({ role: "employee", summary: null });

		const { container } = renderWidget();

		await waitFor(() => expect(mockedGetManagerTodaySummary).toHaveBeenCalled());
		expect(container).toBeEmptyDOMElement();
	});

	it("shows an inline error for authorized users when the summary fails", async () => {
		mockedGetManagerTodaySummary.mockRejectedValue(new Error("Failed"));

		renderWidget();

		expect(
			await screen.findByText("Manager Today counts could not be loaded."),
		).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run widget tests and verify failure**

Run: `pnpm --dir apps/webapp test src/components/dashboard/manager-today-widget.test.tsx`

Expected: FAIL because `ManagerTodayWidget` still imports `getCurrentEmployee`, does not call `getManagerTodaySummary`, and does not render the new labels.

- [ ] **Step 3: Replace the widget query and render body**

Modify `apps/webapp/src/components/dashboard/manager-today-widget.tsx` to this complete file:

```tsx
"use client";

import {
	IconAlertTriangle,
	IconArrowRight,
	IconCalendarCheck,
	IconChecklist,
	IconClockExclamation,
	IconShieldCheck,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getManagerTodaySummary } from "@/components/dashboard/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

type EmployeeRole = "admin" | "manager" | "employee";

export type ManagerTodayBriefingSummary = {
	criticalIssues: number;
	openApprovals: number;
	attendanceExceptions: number;
	absencesToday: number;
	coverageRisks: number;
	overtimeWarnings: number;
	payrollIssues: number;
};

export type ManagerTodayMetricCounts = {
	critical: number;
	approvals: number;
	clockIns: number;
	risks: number;
	allClear: boolean;
};

export function mapManagerTodaySummary(
	summary: ManagerTodayBriefingSummary,
): ManagerTodayMetricCounts {
	const counts = {
		critical: summary.criticalIssues,
		approvals: summary.openApprovals,
		clockIns: summary.attendanceExceptions,
		risks: summary.coverageRisks + summary.overtimeWarnings + summary.payrollIssues,
	};

	return {
		...counts,
		allClear: Object.values(counts).every((count) => count === 0),
	};
}

type MetricItem = {
	key: keyof Omit<ManagerTodayMetricCounts, "allClear">;
	labelKey: string;
	fallback: string;
	icon: typeof IconAlertTriangle;
	tone: "critical" | "default" | "warning";
};

const metricItems: MetricItem[] = [
	{
		key: "critical",
		labelKey: "dashboard.manager-today.metric-critical",
		fallback: "Critical",
		icon: IconAlertTriangle,
		tone: "critical",
	},
	{
		key: "approvals",
		labelKey: "dashboard.manager-today.metric-approvals",
		fallback: "Approvals",
		icon: IconChecklist,
		tone: "default",
	},
	{
		key: "clockIns",
		labelKey: "dashboard.manager-today.metric-clock-ins",
		fallback: "Clock-ins",
		icon: IconClockExclamation,
		tone: "warning",
	},
	{
		key: "risks",
		labelKey: "dashboard.manager-today.metric-risks",
		fallback: "Risks",
		icon: IconShieldCheck,
		tone: "warning",
	},
];

export function ManagerTodayWidget() {
	const { t } = useTranslate();
	const managerTodayQuery = useQuery({
		queryKey: ["dashboard", "manager-today", "summary"],
		queryFn: getManagerTodaySummary,
	});

	const role = (managerTodayQuery.data?.role ?? null) as EmployeeRole | null;
	const summary = managerTodayQuery.data?.summary ?? null;
	const loading = managerTodayQuery.isLoading;
	const refreshing = managerTodayQuery.isFetching && !managerTodayQuery.isLoading;
	const counts = summary ? mapManagerTodaySummary(summary) : null;

	if (!loading && role !== "admin" && role !== "manager" && !managerTodayQuery.isError) {
		return null;
	}

	return (
		<DashboardWidget id="manager-today">
			<WidgetCard
				title={t("dashboard.manager-today.title", "Manager Today")}
				description={t(
					"dashboard.manager-today.description",
					"Review today before small issues affect payroll or coverage.",
				)}
				icon={<IconCalendarCheck className="size-4 text-blue-500" aria-hidden="true" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={() => managerTodayQuery.refetch()}
				action={
					<Button variant="default" size="sm" asChild>
						<Link href="/today">
							{t("dashboard.manager-today.open", "Open Brief")}
							<IconArrowRight className="ml-1 size-3" aria-hidden="true" />
						</Link>
					</Button>
				}
			>
				{managerTodayQuery.isError || !counts ? (
					<p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-destructive text-sm">
						{t(
							"dashboard.manager-today.error",
							"Manager Today counts could not be loaded.",
						)}
					</p>
				) : (
					<div className="space-y-3">
						<div className="grid grid-cols-2 gap-2">
							{metricItems.map((item) => (
								<MetricCell
									key={item.key}
									label={t(item.labelKey, item.fallback)}
									value={counts[item.key]}
									icon={item.icon}
									tone={item.tone}
								/>
							))}
						</div>

						{counts.allClear ? (
							<p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-700 text-sm dark:text-emerald-300">
								{t(
									"dashboard.manager-today.all-clear",
									"No manager action is flagged right now.",
								)}
							</p>
						) : null}
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}

function MetricCell({
	label,
	value,
	icon: Icon,
	tone,
}: {
	label: string;
	value: number;
	icon: typeof IconAlertTriangle;
	tone: MetricItem["tone"];
}) {
	const active = value > 0;

	return (
		<div
			className={cn(
				"rounded-lg border bg-muted/30 px-3 py-2",
				active && tone === "critical" && "border-destructive/30 bg-destructive/5",
				active && tone === "warning" && "border-amber-500/30 bg-amber-500/5",
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<Icon
					className={cn(
						"size-4 text-muted-foreground",
						active && tone === "critical" && "text-destructive",
						active && tone === "warning" && "text-amber-600 dark:text-amber-400",
					)}
					aria-hidden="true"
				/>
				<span className="font-semibold text-xl tabular-nums">{value}</span>
			</div>
			<p className="mt-1 text-muted-foreground text-xs">{label}</p>
		</div>
	);
}
```

- [ ] **Step 4: Add English translations**

Modify `apps/webapp/messages/dashboard/en.json`, replacing the `manager-today` object with:

```json
"manager-today": {
  "all-clear": "No manager action is flagged right now.",
  "description": "Review today before small issues affect payroll or coverage.",
  "error": "Manager Today counts could not be loaded.",
  "metric-approvals": "Approvals",
  "metric-clock-ins": "Clock-ins",
  "metric-critical": "Critical",
  "metric-risks": "Risks",
  "open": "Open Brief",
  "title": "Manager Today"
}
```

- [ ] **Step 5: Run widget tests and verify pass**

Run: `pnpm --dir apps/webapp test src/components/dashboard/manager-today-widget.test.tsx`

Expected: PASS for mapper tests and widget render tests.

- [ ] **Step 6: Commit widget rendering changes**

Run:

```bash
git add apps/webapp/src/components/dashboard/manager-today-widget.tsx apps/webapp/src/components/dashboard/manager-today-widget.test.tsx apps/webapp/messages/dashboard/en.json
git commit -m "feat: show manager today dashboard counts"
```

Expected: commit succeeds. If the user has not requested commits in the active session, skip this step and mention it in the handoff.

---

### Task 4: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/dashboard/manager-today-widget.tsx`
- Verify: `apps/webapp/src/components/dashboard/actions.ts`
- Verify: `apps/webapp/src/components/dashboard/manager-today-widget.test.tsx`
- Verify: `apps/webapp/messages/dashboard/en.json`

- [ ] **Step 1: Run the targeted dashboard widget tests**

Run: `pnpm --dir apps/webapp test src/components/dashboard/manager-today-widget.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run broader dashboard tests**

Run: `pnpm --dir apps/webapp test src/components/dashboard/widget-registry.test.ts src/components/dashboard/manager-today-widget.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run a production build check if local environment allows it**

Run: `pnpm --dir apps/webapp build`

Expected: PASS. If the build requires unavailable Phase CLI environment variables, skip it and record that it was skipped because agents do not have access to Phase-managed system secrets.

- [ ] **Step 4: Review git diff**

Run: `git diff -- apps/webapp/src/components/dashboard/manager-today-widget.tsx apps/webapp/src/components/dashboard/actions.ts apps/webapp/src/components/dashboard/manager-today-widget.test.tsx apps/webapp/messages/dashboard/en.json docs/superpowers/specs/2026-05-04-manager-today-counts-design.md docs/superpowers/plans/2026-05-04-manager-today-counts.md`

Expected: diff only contains the Manager Today counts implementation, tests, translations, spec, and plan.

- [ ] **Step 5: Final commit**

Run:

```bash
git add apps/webapp/src/components/dashboard/manager-today-widget.tsx apps/webapp/src/components/dashboard/actions.ts apps/webapp/src/components/dashboard/manager-today-widget.test.tsx apps/webapp/messages/dashboard/en.json docs/superpowers/specs/2026-05-04-manager-today-counts-design.md docs/superpowers/plans/2026-05-04-manager-today-counts.md
git commit -m "feat: add manager today dashboard summary"
```

Expected: commit succeeds if previous task commits were skipped. If previous task commits were already created, skip this step.

---

## Self-Review

- Spec coverage: The plan reuses the existing briefing loader, keeps manager/admin visibility, renders the four requested counts, combines risks, includes all-clear and error states, and adds focused tests.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `ManagerTodayBriefingSummary`, `ManagerTodayMetricCounts`, `mapManagerTodaySummary`, and `getManagerTodaySummary` are named consistently across tasks.
