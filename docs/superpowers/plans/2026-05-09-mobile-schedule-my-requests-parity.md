# Mobile Schedule And My Requests Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add focused mobile employee self-service parity with new `Schedule` and `My Requests` mobile surfaces backed by organization-scoped mobile APIs.

**Architecture:** Add two mobile API endpoints in the webapp: `/api/mobile/schedule` and `/api/mobile/my-requests`. Add two Expo Router tab routes in the mobile app with feature-local hooks, pure formatting/grouping helpers, and React Native card screens. Reuse `getSelfServiceRequests` for request aggregation and keep absence mutations in the existing `Absences` flow.

**Tech Stack:** Next.js route handlers, Drizzle ORM, Vitest, Expo Router, React Native, TanStack Query, Luxon, pnpm workspaces.

---

## File Structure

- Create `apps/webapp/src/lib/mobile/effective-schedule.ts`: mobile-safe effective work policy schedule lookup using individual, team, then organization assignment precedence.
- Create `apps/webapp/src/lib/mobile/effective-schedule.test.ts`: unit tests for schedule precedence and null fallback.
- Create `apps/webapp/src/app/api/mobile/schedule/route.ts`: mobile schedule endpoint returning published assigned shifts plus effective schedule details.
- Create `apps/webapp/src/app/api/mobile/schedule/route.test.ts`: route tests for auth, scoping, published shift query, and response shape.
- Create `apps/webapp/src/app/api/mobile/my-requests/route.ts`: mobile request aggregation endpoint using `getSelfServiceRequests`.
- Create `apps/webapp/src/app/api/mobile/my-requests/route.test.ts`: route tests for employee scoping and normalized request passthrough.
- Create `apps/mobile/app/(app)/schedule.tsx`: Expo route for the `Schedule` tab.
- Create `apps/mobile/app/(app)/my-requests.tsx`: Expo route for the `My Requests` tab.
- Modify `apps/mobile/app/(app)/_layout.tsx`: add `Schedule` and `My Requests` tab entries.
- Create `apps/mobile/src/features/schedule/use-schedule-query.ts`: mobile schedule query types and hook.
- Create `apps/mobile/src/features/schedule/schedule-screen.tsx`: schedule presentation component.
- Create `apps/mobile/src/features/schedule/schedule-screen.test.tsx`: schedule screen rendering tests.
- Create `apps/mobile/src/features/my-requests/use-my-requests-query.ts`: mobile request query types and hook.
- Create `apps/mobile/src/features/my-requests/my-requests-screen.tsx`: request grouping, filters, cards, source warning, and empty states.
- Create `apps/mobile/src/features/my-requests/my-requests-screen.test.tsx`: grouped request and filter tests.

## Task 1: Effective Schedule Helper

**Files:**
- Create: `apps/webapp/src/lib/mobile/effective-schedule.ts`
- Create: `apps/webapp/src/lib/mobile/effective-schedule.test.ts`

- [ ] **Step 1: Write failing tests for assignment precedence**

Create `apps/webapp/src/lib/mobile/effective-schedule.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	employeeFindFirst: vi.fn(),
	assignmentFindFirst: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mockState.employeeFindFirst },
			workPolicyAssignment: { findFirst: mockState.assignmentFindFirst },
		},
	},
}));

const { getMobileEffectiveSchedule } = await import("./effective-schedule");

function assignment(name: string, assignedVia: string) {
	return {
		policy: {
			name,
			isActive: true,
			scheduleEnabled: true,
			schedule: {
				scheduleCycle: "weekly",
				scheduleType: "detailed",
				hoursPerCycle: "40.00",
				homeOfficeDaysPerCycle: 1,
				days: [
					{ dayOfWeek: "monday", hoursPerDay: "8.00", isWorkDay: true, cycleWeek: 1 },
				],
			},
		},
		team: assignedVia === "Team A" ? { name: "Team A" } : undefined,
	};
}

describe("getMobileEffectiveSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.employeeFindFirst.mockResolvedValue({ id: "emp-1", teamId: "team-1" });
	});

	it("returns an individual assignment before team or organization assignments", async () => {
		mockState.assignmentFindFirst.mockResolvedValueOnce(assignment("Individual Policy", "Individual"));

		await expect(getMobileEffectiveSchedule("emp-1", "org-1")).resolves.toEqual({
			policyName: "Individual Policy",
			assignedVia: "Individual",
			scheduleCycle: "weekly",
			scheduleType: "detailed",
			hoursPerCycle: "40.00",
			homeOfficeDaysPerCycle: 1,
			days: [{ dayOfWeek: "monday", hoursPerDay: "8.00", isWorkDay: true, cycleWeek: 1 }],
		});
		expect(mockState.assignmentFindFirst).toHaveBeenCalledTimes(1);
	});

	it("falls back from missing individual assignment to team assignment", async () => {
		mockState.assignmentFindFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(assignment("Team Policy", "Team A"));

		const result = await getMobileEffectiveSchedule("emp-1", "org-1");

		expect(result?.policyName).toBe("Team Policy");
		expect(result?.assignedVia).toBe("Team A");
		expect(mockState.assignmentFindFirst).toHaveBeenCalledTimes(2);
	});

	it("returns null when no active schedule assignment exists", async () => {
		mockState.assignmentFindFirst.mockResolvedValue(null);

		await expect(getMobileEffectiveSchedule("emp-1", "org-1")).resolves.toBeNull();
		expect(mockState.assignmentFindFirst).toHaveBeenCalledTimes(3);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter webapp test -- src/lib/mobile/effective-schedule.test.ts`

Expected: FAIL because `apps/webapp/src/lib/mobile/effective-schedule.ts` does not exist.

- [ ] **Step 3: Add the helper implementation**

Create `apps/webapp/src/lib/mobile/effective-schedule.ts`:

```ts
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { employee, workPolicyAssignment } from "@/db/schema";

export interface MobileEffectiveScheduleDay {
	dayOfWeek: string;
	hoursPerDay: string | null;
	isWorkDay: boolean;
	cycleWeek: number | null;
}

export interface MobileEffectiveSchedule {
	policyName: string;
	assignedVia: string;
	scheduleCycle?: string | null;
	scheduleType?: string | null;
	hoursPerCycle?: string;
	homeOfficeDaysPerCycle?: number;
	days?: MobileEffectiveScheduleDay[];
}

type Assignment = {
	policy?: {
		name: string;
		isActive: boolean;
		scheduleEnabled: boolean;
		schedule?: {
			scheduleCycle?: string | null;
			scheduleType?: string | null;
			hoursPerCycle?: string | null;
			homeOfficeDaysPerCycle?: number | null;
			days?: MobileEffectiveScheduleDay[];
		} | null;
	} | null;
	team?: { name: string } | null;
};

export async function getMobileEffectiveSchedule(
	employeeId: string,
	organizationId: string,
): Promise<MobileEffectiveSchedule | null> {
	const emp = await db.query.employee.findFirst({
		where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
		columns: { id: true, teamId: true },
	});

	if (!emp) {
		return null;
	}

	const individual = await findAssignment({ organizationId, employeeId, type: "employee" });
	const individualSchedule = normalizeAssignment(individual, "Individual");
	if (individualSchedule) {
		return individualSchedule;
	}

	if (emp.teamId) {
		const team = await findAssignment({ organizationId, teamId: emp.teamId, type: "team" });
		const teamSchedule = normalizeAssignment(team, team?.team?.name ?? "Team");
		if (teamSchedule) {
			return teamSchedule;
		}
	}

	const organization = await findAssignment({ organizationId, type: "organization" });
	return normalizeAssignment(organization, "Organization");
}

async function findAssignment(input: {
	organizationId: string;
	type: "employee" | "team" | "organization";
	employeeId?: string;
	teamId?: string;
}): Promise<Assignment | null> {
	const now = new Date();
	const target =
		input.type === "employee"
			? eq(workPolicyAssignment.employeeId, input.employeeId!)
			: input.type === "team"
				? eq(workPolicyAssignment.teamId, input.teamId!)
				: isNull(workPolicyAssignment.employeeId);

	return (await db.query.workPolicyAssignment.findFirst({
		where: and(
			eq(workPolicyAssignment.organizationId, input.organizationId),
			eq(workPolicyAssignment.assignmentType, input.type),
			eq(workPolicyAssignment.isActive, true),
			target,
			or(isNull(workPolicyAssignment.effectiveFrom), lte(workPolicyAssignment.effectiveFrom, now)),
			or(isNull(workPolicyAssignment.effectiveUntil), gte(workPolicyAssignment.effectiveUntil, now)),
		),
		orderBy: [sql`${workPolicyAssignment.effectiveFrom} DESC NULLS LAST`, desc(workPolicyAssignment.createdAt)],
		with: { policy: { with: { schedule: { with: { days: true } } } }, team: true },
	})) as Assignment | null;
}

function normalizeAssignment(
	assignment: Assignment | null,
	assignedVia: string,
): MobileEffectiveSchedule | null {
	if (!assignment?.policy?.isActive || !assignment.policy.scheduleEnabled) {
		return null;
	}

	const schedule = assignment.policy.schedule;
	return {
		policyName: assignment.policy.name,
		assignedVia,
		scheduleCycle: schedule?.scheduleCycle,
		scheduleType: schedule?.scheduleType,
		hoursPerCycle: schedule?.hoursPerCycle ?? undefined,
		homeOfficeDaysPerCycle: schedule?.homeOfficeDaysPerCycle ?? undefined,
		days: schedule?.days?.map((day) => ({
			dayOfWeek: day.dayOfWeek,
			hoursPerDay: day.hoursPerDay,
			isWorkDay: day.isWorkDay,
			cycleWeek: day.cycleWeek,
		})),
	};
}
```

- [ ] **Step 4: Run the helper test**

Run: `pnpm --filter webapp test -- src/lib/mobile/effective-schedule.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/lib/mobile/effective-schedule.ts apps/webapp/src/lib/mobile/effective-schedule.test.ts
git commit -m "feat: add mobile effective schedule helper"
```

## Task 2: Mobile Schedule API

**Files:**
- Create: `apps/webapp/src/app/api/mobile/schedule/route.ts`
- Create: `apps/webapp/src/app/api/mobile/schedule/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/webapp/src/app/api/mobile/schedule/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	MobileApiError: class MobileApiError extends Error {
		constructor(readonly status: number, message: string) {
			super(message);
		}
	},
	requireMobileSessionContext: vi.fn(),
	requireMobileEmployee: vi.fn(),
	getMobileEffectiveSchedule: vi.fn(),
	findShifts: vi.fn(),
}));

vi.mock("@/app/api/mobile/shared", () => ({
	MobileApiError: mockState.MobileApiError,
	requireMobileSessionContext: mockState.requireMobileSessionContext,
	requireMobileEmployee: mockState.requireMobileEmployee,
}));

vi.mock("@/lib/mobile/effective-schedule", () => ({
	getMobileEffectiveSchedule: mockState.getMobileEffectiveSchedule,
}));

vi.mock("@/db", () => ({
	db: { query: { shift: { findMany: mockState.findShifts } } },
}));

const { GET } = await import("./route");

describe("GET /api/mobile/schedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireMobileSessionContext.mockResolvedValue({
			session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
			activeOrganizationId: "org-1",
			memberships: [{ organizationId: "org-1" }],
		});
		mockState.requireMobileEmployee.mockResolvedValue({ id: "emp-1", organizationId: "org-1" });
		mockState.getMobileEffectiveSchedule.mockResolvedValue({
			policyName: "Full time",
			assignedVia: "Organization",
			hoursPerCycle: "40.00",
			days: [{ dayOfWeek: "monday", hoursPerDay: "8.00", isWorkDay: true, cycleWeek: 1 }],
		});
		mockState.findShifts.mockResolvedValue([
			{
				id: "shift-1",
				date: new Date("2026-05-11T00:00:00.000Z"),
				startTime: "09:00",
				endTime: "17:00",
				status: "published",
				notes: "Front desk",
				color: "#2563eb",
			},
		]);
	});

	it("returns published assigned shifts and the effective schedule", async () => {
		const response = await GET(new Request("https://app.example.com/api/mobile/schedule"));

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.getMobileEffectiveSchedule).toHaveBeenCalledWith("emp-1", "org-1");
		expect(await response.json()).toEqual({
			activeOrganizationId: "org-1",
			shifts: [
				{
					id: "shift-1",
					date: "2026-05-11",
					startTime: "09:00",
					endTime: "17:00",
					status: "published",
					notes: "Front desk",
					color: "#2563eb",
				},
			],
			effectiveSchedule: {
				policyName: "Full time",
				assignedVia: "Organization",
				hoursPerCycle: "40.00",
				days: [{ dayOfWeek: "monday", hoursPerDay: "8.00", isWorkDay: true, cycleWeek: 1 }],
			},
		});
	});

	it("requires an active organization", async () => {
		mockState.requireMobileSessionContext.mockResolvedValueOnce({
			session: { user: { id: "user-1" }, session: { activeOrganizationId: null } },
			activeOrganizationId: null,
			memberships: [],
		});

		const response = await GET(new Request("https://app.example.com/api/mobile/schedule"));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Active organization required" });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/api/mobile/schedule/route.test.ts`

Expected: FAIL because `route.ts` does not exist.

- [ ] **Step 3: Add the schedule route**

Create `apps/webapp/src/app/api/mobile/schedule/route.ts`:

```ts
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { db } from "@/db";
import { shift } from "@/db/schema";
import { getMobileEffectiveSchedule } from "@/lib/mobile/effective-schedule";

function formatShiftDate(value: Date | string) {
	if (typeof value === "string") {
		return DateTime.fromISO(value, { zone: "utc" }).toISODate() ?? value.slice(0, 10);
	}

	return DateTime.fromJSDate(value, { zone: "utc" }).toISODate() ?? value.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);
		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);
		const today = DateTime.now().startOf("day");
		const rangeEnd = today.plus({ days: 28 }).endOf("day");

		const [shifts, effectiveSchedule] = await Promise.all([
			db.query.shift.findMany({
				where: and(
					eq(shift.organizationId, activeOrganizationId),
					eq(shift.employeeId, employeeRecord.id),
					eq(shift.status, "published"),
					gte(shift.date, today.toJSDate()),
					lte(shift.date, rangeEnd.toJSDate()),
				),
				orderBy: [asc(shift.date), asc(shift.startTime)],
			}),
			getMobileEffectiveSchedule(employeeRecord.id, activeOrganizationId),
		]);

		return NextResponse.json({
			activeOrganizationId,
			shifts: shifts.map((item) => ({
				id: item.id,
				date: formatShiftDate(item.date),
				startTime: item.startTime,
				endTime: item.endTime,
				status: item.status,
				notes: item.notes,
				color: item.color,
			})),
			effectiveSchedule,
		});
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
```

- [ ] **Step 4: Run the schedule route test**

Run: `pnpm --filter webapp test -- src/app/api/mobile/schedule/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/app/api/mobile/schedule/route.ts apps/webapp/src/app/api/mobile/schedule/route.test.ts
git commit -m "feat: add mobile schedule endpoint"
```

## Task 3: Mobile My Requests API

**Files:**
- Create: `apps/webapp/src/app/api/mobile/my-requests/route.ts`
- Create: `apps/webapp/src/app/api/mobile/my-requests/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/webapp/src/app/api/mobile/my-requests/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	MobileApiError: class MobileApiError extends Error {
		constructor(readonly status: number, message: string) {
			super(message);
		}
	},
	requireMobileSessionContext: vi.fn(),
	requireMobileEmployee: vi.fn(),
	getSelfServiceRequests: vi.fn(),
}));

vi.mock("@/app/api/mobile/shared", () => ({
	MobileApiError: mockState.MobileApiError,
	requireMobileSessionContext: mockState.requireMobileSessionContext,
	requireMobileEmployee: mockState.requireMobileEmployee,
}));

vi.mock("@/lib/self-service-requests/get-self-service-requests", () => ({
	getSelfServiceRequests: mockState.getSelfServiceRequests,
}));

const { GET } = await import("./route");

describe("GET /api/mobile/my-requests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireMobileSessionContext.mockResolvedValue({
			session: { user: { id: "user-1" }, session: { activeOrganizationId: "org-1" } },
			activeOrganizationId: "org-1",
			memberships: [{ organizationId: "org-1" }],
		});
		mockState.requireMobileEmployee.mockResolvedValue({ id: "emp-1", organizationId: "org-1" });
		mockState.getSelfServiceRequests.mockResolvedValue({
			items: [
				{
					id: "absence:absence-1",
					sourceType: "absence",
					sourceId: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-1",
					status: "pending",
					submittedAt: new Date("2026-05-01T08:00:00.000Z"),
					resolvedAt: null,
					title: "Vacation",
					subtitle: "2026-05-15 to 2026-05-15",
					decisionReason: null,
					availableActions: ["cancel", "view"],
					sourceHref: "/absences",
				},
			],
			counts: { pending: 1, requiredFixes: 0, recentDecisions: 0, total: 1 },
			sourceErrors: [],
		});
	});

	it("returns normalized self-service requests for the current employee", async () => {
		const response = await GET(new Request("https://app.example.com/api/mobile/my-requests"));

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.getSelfServiceRequests).toHaveBeenCalledWith({ employeeId: "emp-1", organizationId: "org-1" });
		expect(await response.json()).toEqual({
			items: [
				{
					id: "absence:absence-1",
					sourceType: "absence",
					sourceId: "absence-1",
					organizationId: "org-1",
					employeeId: "emp-1",
					status: "pending",
					submittedAt: "2026-05-01T08:00:00.000Z",
					resolvedAt: null,
					title: "Vacation",
					subtitle: "2026-05-15 to 2026-05-15",
					decisionReason: null,
					availableActions: ["cancel", "view"],
					sourceHref: "/absences",
				},
			],
			counts: { pending: 1, requiredFixes: 0, recentDecisions: 0, total: 1 },
			sourceErrors: [],
		});
	});

	it("requires an active organization", async () => {
		mockState.requireMobileSessionContext.mockResolvedValueOnce({
			session: { user: { id: "user-1" }, session: { activeOrganizationId: null } },
			activeOrganizationId: null,
			memberships: [],
		});

		const response = await GET(new Request("https://app.example.com/api/mobile/my-requests"));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Active organization required" });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/api/mobile/my-requests/route.test.ts`

Expected: FAIL because `route.ts` does not exist.

- [ ] **Step 3: Add the route implementation**

Create `apps/webapp/src/app/api/mobile/my-requests/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { getSelfServiceRequests } from "@/lib/self-service-requests/get-self-service-requests";

export async function GET(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);
		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		const employeeRecord = await requireMobileEmployee(session.user.id, activeOrganizationId);
		const result = await getSelfServiceRequests({
			employeeId: employeeRecord.id,
			organizationId: activeOrganizationId,
		});

		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
```

- [ ] **Step 4: Run the route test**

Run: `pnpm --filter webapp test -- src/app/api/mobile/my-requests/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/app/api/mobile/my-requests/route.ts apps/webapp/src/app/api/mobile/my-requests/route.test.ts
git commit -m "feat: add mobile my requests endpoint"
```

## Task 4: Mobile Schedule Hook And Screen

**Files:**
- Create: `apps/mobile/src/features/schedule/use-schedule-query.ts`
- Create: `apps/mobile/src/features/schedule/schedule-screen.tsx`
- Create: `apps/mobile/src/features/schedule/schedule-screen.test.tsx`

- [ ] **Step 1: Write failing screen tests**

Create `apps/mobile/src/features/schedule/schedule-screen.test.tsx`:

```tsx
import React from "react";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleScreen } from "./schedule-screen";
import type { MobileScheduleData } from "./use-schedule-query";

vi.mock("react-native", () => ({
	Pressable: ({ accessibilityLabel, accessibilityState, children, ...props }: any) =>
		React.createElement("button", {
			...props,
			...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
			...(accessibilityState?.selected !== undefined ? { "data-selected": accessibilityState.selected } : {}),
		}, children),
	ScrollView: ({ children, ...props }: any) => React.createElement("main", props, children),
	StyleSheet: { create: <T,>(styles: T) => styles },
	Text: ({ children, ...props }: any) => React.createElement("span", props, children),
	View: ({ children, ...props }: any) => React.createElement("div", props, children),
}));

const data: MobileScheduleData = {
	activeOrganizationId: "org-1",
	shifts: [
		{ id: "shift-1", date: "2026-05-11", startTime: "09:00", endTime: "17:00", status: "published", notes: "Front desk", color: "#2563eb" },
	],
	effectiveSchedule: {
		policyName: "Full time",
		assignedVia: "Organization",
		hoursPerCycle: "40.00",
		homeOfficeDaysPerCycle: 1,
		days: [{ dayOfWeek: "monday", hoursPerDay: "8.00", isWorkDay: true, cycleWeek: 1 }],
	},
};

describe("ScheduleScreen", () => {
	it("renders upcoming shifts and usual schedule context", () => {
		const html = renderToStaticMarkup(
			<ScheduleScreen data={data} onRequestAbsence={vi.fn()} onViewRequests={vi.fn()} />,
		);

		expect(html).toContain("Schedule");
		expect(html).toContain("Next shift");
		expect(html).toContain("09:00 - 17:00");
		expect(html).toContain("Front desk");
		expect(html).toContain("Full time");
		expect(html).toContain("Organization");
	});

	it("renders separate empty states for no shifts and no usual schedule", () => {
		const html = renderToStaticMarkup(
			<ScheduleScreen data={{ activeOrganizationId: "org-1", shifts: [], effectiveSchedule: null }} onRequestAbsence={vi.fn()} onViewRequests={vi.fn()} />,
		);

		expect(html).toContain("No upcoming shifts");
		expect(html).toContain("No usual schedule configured");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter mobile test -- src/features/schedule/schedule-screen.test.tsx`

Expected: FAIL because the schedule feature files do not exist.

- [ ] **Step 3: Add the query hook and types**

Create `apps/mobile/src/features/schedule/use-schedule-query.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { useMobileSession, type MobileSession } from "@/src/features/session/use-mobile-session";
import { createMobileApiClient } from "@/src/lib/api/client";

export interface MobileScheduleShift {
	id: string;
	date: string;
	startTime: string;
	endTime: string;
	status: "published";
	notes: string | null;
	color: string | null;
}

export interface MobileEffectiveScheduleDay {
	dayOfWeek: string;
	hoursPerDay: string | null;
	isWorkDay: boolean;
	cycleWeek: number | null;
}

export interface MobileScheduleData {
	activeOrganizationId: string;
	shifts: MobileScheduleShift[];
	effectiveSchedule: {
		policyName: string;
		assignedVia: string;
		scheduleCycle?: string | null;
		scheduleType?: string | null;
		hoursPerCycle?: string;
		homeOfficeDaysPerCycle?: number;
		days?: MobileEffectiveScheduleDay[];
	} | null;
}

export const MOBILE_SCHEDULE_QUERY_KEY = "mobile-schedule";

export function getMobileScheduleQueryKey(activeOrganizationId: string | null | undefined) {
	return [MOBILE_SCHEDULE_QUERY_KEY, activeOrganizationId] as const;
}

export function useScheduleQuery(sessionOverride?: MobileSession | null) {
	const sessionQuery = useMobileSession();
	const session = sessionOverride === undefined ? sessionQuery.data : sessionOverride;
	const activeOrganizationId = session?.activeOrganizationId;
	const token = session?.token;

	return useQuery({
		queryKey: getMobileScheduleQueryKey(activeOrganizationId),
		enabled: !!token && !!activeOrganizationId,
		queryFn: async () => {
			if (!token) {
				throw new Error("No mobile session token");
			}

			return createMobileApiClient(token).get<MobileScheduleData>("/api/mobile/schedule");
		},
	});
}
```

- [ ] **Step 4: Add the schedule screen**

Create `apps/mobile/src/features/schedule/schedule-screen.tsx` with the same style patterns used in `apps/mobile/src/features/absences/absences-screen.tsx`:

```tsx
import { DateTime } from "luxon";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MobileScheduleData, MobileScheduleShift } from "./use-schedule-query";

interface ScheduleScreenProps {
	data: MobileScheduleData;
	onRequestAbsence: () => void;
	onViewRequests: () => void;
}

export function ScheduleScreen({ data, onRequestAbsence, onViewRequests }: ScheduleScreenProps) {
	const nextShift = data.shifts[0] ?? null;
	const workDays = data.effectiveSchedule?.days?.filter((day) => day.isWorkDay) ?? [];

	return (
		<ScrollView contentContainerStyle={styles.content} style={styles.container}>
			<View style={styles.headerSurface}>
				<Text style={styles.eyebrow}>Schedule</Text>
				<Text style={styles.title}>{nextShift ? "Next shift" : "No upcoming shifts"}</Text>
				<Text style={styles.description}>
					{nextShift ? `${formatDate(nextShift.date)} · ${formatShiftTime(nextShift)}` : "Your published assigned shifts will appear here."}
				</Text>
				<View style={styles.actionRow}>
					<Pressable accessibilityLabel="Request absence" accessibilityRole="button" onPress={onRequestAbsence} style={styles.primaryAction}>
						<Text style={styles.primaryActionLabel}>Request absence</Text>
					</Pressable>
					<Pressable accessibilityLabel="View my requests" accessibilityRole="button" onPress={onViewRequests} style={styles.secondaryAction}>
						<Text style={styles.secondaryActionLabel}>View requests</Text>
					</Pressable>
				</View>
			</View>

			<View style={styles.surface}>
				<Text style={styles.sectionTitle}>Upcoming shifts</Text>
				{data.shifts.length === 0 ? <Text style={styles.emptyState}>No upcoming shifts</Text> : data.shifts.map((shift) => <ShiftCard key={shift.id} shift={shift} />)}
			</View>

			<View style={styles.surface}>
				<Text style={styles.sectionTitle}>Usual schedule</Text>
				{data.effectiveSchedule ? (
					<View style={styles.scheduleBlock}>
						<Text style={styles.rowTitle}>{data.effectiveSchedule.policyName}</Text>
						<Text style={styles.rowMeta}>Assigned via {data.effectiveSchedule.assignedVia}</Text>
						{data.effectiveSchedule.hoursPerCycle ? <Text style={styles.rowMeta}>{data.effectiveSchedule.hoursPerCycle}h per cycle</Text> : null}
						{data.effectiveSchedule.homeOfficeDaysPerCycle ? <Text style={styles.rowMeta}>{data.effectiveSchedule.homeOfficeDaysPerCycle} home-office day(s)</Text> : null}
						{workDays.map((day) => <Text key={`${day.dayOfWeek}-${day.cycleWeek ?? 0}`} style={styles.dayRow}>{formatDay(day.dayOfWeek)} · {day.hoursPerDay ?? "0"}h</Text>)}
					</View>
				) : <Text style={styles.emptyState}>No usual schedule configured</Text>}
			</View>
		</ScrollView>
	);
}

function ShiftCard({ shift }: { shift: MobileScheduleShift }) {
	return (
		<View style={styles.card}>
			<View style={styles.cardHeader}>
				<Text style={styles.rowTitle}>{formatDate(shift.date)}</Text>
				<Text style={styles.statusLabel}>Published</Text>
			</View>
			<Text style={styles.rowMeta}>{formatShiftTime(shift)}</Text>
			{shift.notes ? <Text style={styles.notes}>{shift.notes}</Text> : null}
		</View>
	);
}

function formatDate(value: string) {
	return DateTime.fromISO(value).toLocaleString(DateTime.DATE_MED);
}

function formatShiftTime(shift: MobileScheduleShift) {
	return `${shift.startTime} - ${shift.endTime}`;
}

function formatDay(value: string) {
	return value.slice(0, 1).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#f8fafc" },
	content: { padding: 20, gap: 16 },
	headerSurface: { padding: 18, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "#dbeafe", backgroundColor: "#ffffff" },
	eyebrow: { fontSize: 13, fontWeight: "600", letterSpacing: 0.3, color: "#2563eb", textTransform: "uppercase" },
	title: { fontSize: 28, lineHeight: 32, fontWeight: "700", color: "#0f172a" },
	description: { fontSize: 15, lineHeight: 22, color: "#475569" },
	actionRow: { gap: 10 },
	primaryAction: { alignItems: "center", borderRadius: 12, paddingVertical: 14, backgroundColor: "#2563eb" },
	primaryActionLabel: { fontSize: 16, fontWeight: "700", color: "#ffffff" },
	secondaryAction: { alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#bfdbfe", paddingVertical: 14, backgroundColor: "#eff6ff" },
	secondaryActionLabel: { fontSize: 16, fontWeight: "700", color: "#1d4ed8" },
	surface: { padding: 18, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff" },
	sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
	emptyState: { fontSize: 14, lineHeight: 20, color: "#64748b" },
	card: { gap: 8, borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", padding: 14, backgroundColor: "#f8fafc" },
	cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
	rowTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
	rowMeta: { fontSize: 13, lineHeight: 18, color: "#475569" },
	statusLabel: { fontSize: 12, fontWeight: "700", color: "#166534" },
	notes: { fontSize: 13, lineHeight: 18, color: "#334155" },
	scheduleBlock: { gap: 8 },
	dayRow: { fontSize: 13, lineHeight: 18, color: "#334155" },
});
```

- [ ] **Step 5: Run the screen test**

Run: `pnpm --filter mobile test -- src/features/schedule/schedule-screen.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/mobile/src/features/schedule/use-schedule-query.ts apps/mobile/src/features/schedule/schedule-screen.tsx apps/mobile/src/features/schedule/schedule-screen.test.tsx
git commit -m "feat: add mobile schedule screen"
```

## Task 5: Mobile My Requests Hook And Screen

**Files:**
- Create: `apps/mobile/src/features/my-requests/use-my-requests-query.ts`
- Create: `apps/mobile/src/features/my-requests/my-requests-screen.tsx`
- Create: `apps/mobile/src/features/my-requests/my-requests-screen.test.tsx`

- [ ] **Step 1: Write failing screen tests**

Create `apps/mobile/src/features/my-requests/my-requests-screen.test.tsx`:

```tsx
import React from "react";
// @ts-expect-error react-dom server types are not installed in the mobile package.
import { renderToStaticMarkup } from "react-dom/server";
import { MyRequestsScreen } from "./my-requests-screen";
import type { MobileMyRequestsData } from "./use-my-requests-query";

vi.mock("react-native", () => ({
	Pressable: ({ accessibilityLabel, accessibilityState, children, ...props }: any) =>
		React.createElement("button", {
			...props,
			...(accessibilityLabel ? { "aria-label": accessibilityLabel } : {}),
			...(accessibilityState?.selected !== undefined ? { "data-selected": accessibilityState.selected } : {}),
		}, children),
	ScrollView: ({ children, ...props }: any) => React.createElement("main", props, children),
	StyleSheet: { create: <T,>(styles: T) => styles },
	Text: ({ children, ...props }: any) => React.createElement("span", props, children),
	View: ({ children, ...props }: any) => React.createElement("div", props, children),
}));

const data: MobileMyRequestsData = {
	items: [
		{ id: "absence:1", sourceType: "absence", sourceId: "1", organizationId: "org-1", employeeId: "emp-1", status: "rejected", submittedAt: "2026-05-01T08:00:00.000Z", resolvedAt: "2026-05-02T08:00:00.000Z", title: "Vacation", subtitle: "2026-05-15 to 2026-05-15", decisionReason: "Missing coverage", availableActions: ["fix", "view"], sourceHref: "/absences" },
		{ id: "time_correction:1", sourceType: "time_correction", sourceId: "1", organizationId: "org-1", employeeId: "emp-1", status: "pending", submittedAt: "2026-05-03T08:00:00.000Z", resolvedAt: null, title: "time_correction", subtitle: "time_entry_correction", decisionReason: null, availableActions: ["view"], sourceHref: "/time-tracking" },
	],
	counts: { pending: 1, requiredFixes: 1, recentDecisions: 1, total: 2 },
	sourceErrors: [{ sourceType: "travel_expense", message: "Travel expense requests could not be loaded." }],
};

describe("MyRequestsScreen", () => {
	it("renders summary counts, source warnings, and grouped request sections", () => {
		const html = renderToStaticMarkup(<MyRequestsScreen data={data} />);

		expect(html).toContain("My Requests");
		expect(html).toContain("Pending");
		expect(html).toContain("Required fixes");
		expect(html).toContain("Some requests could not be loaded");
		expect(html).toContain("Needs attention");
		expect(html).toContain("In review");
		expect(html).toContain("Recently decided");
		expect(html).toContain("All requests");
		expect(html).toContain("Missing coverage");
	});

	it("renders the no requests empty state", () => {
		const html = renderToStaticMarkup(<MyRequestsScreen data={{ items: [], counts: { pending: 0, requiredFixes: 0, recentDecisions: 0, total: 0 }, sourceErrors: [] }} />);

		expect(html).toContain("No requests yet");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter mobile test -- src/features/my-requests/my-requests-screen.test.tsx`

Expected: FAIL because the my-requests feature files do not exist.

- [ ] **Step 3: Add the query hook and types**

Create `apps/mobile/src/features/my-requests/use-my-requests-query.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { useMobileSession, type MobileSession } from "@/src/features/session/use-mobile-session";
import { createMobileApiClient } from "@/src/lib/api/client";

export type MobileRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type MobileRequestSourceType = "absence" | "time_correction" | "travel_expense";
export type MobileRequestAction = "view" | "fix" | "cancel";

export interface MobileRequestItem {
	id: string;
	sourceType: MobileRequestSourceType;
	sourceId: string;
	organizationId: string;
	employeeId: string;
	status: MobileRequestStatus;
	submittedAt: string;
	resolvedAt: string | null;
	title: string;
	subtitle: string;
	decisionReason: string | null;
	availableActions: MobileRequestAction[];
	sourceHref: string;
}

export interface MobileMyRequestsData {
	items: MobileRequestItem[];
	counts: { pending: number; requiredFixes: number; recentDecisions: number; total: number };
	sourceErrors: Array<{ sourceType: MobileRequestSourceType; message: string }>;
}

export const MOBILE_MY_REQUESTS_QUERY_KEY = "mobile-my-requests";

export function getMobileMyRequestsQueryKey(activeOrganizationId: string | null | undefined) {
	return [MOBILE_MY_REQUESTS_QUERY_KEY, activeOrganizationId] as const;
}

export function useMyRequestsQuery(sessionOverride?: MobileSession | null) {
	const sessionQuery = useMobileSession();
	const session = sessionOverride === undefined ? sessionQuery.data : sessionOverride;
	const activeOrganizationId = session?.activeOrganizationId;
	const token = session?.token;

	return useQuery({
		queryKey: getMobileMyRequestsQueryKey(activeOrganizationId),
		enabled: !!token && !!activeOrganizationId,
		queryFn: async () => {
			if (!token) {
				throw new Error("No mobile session token");
			}

			return createMobileApiClient(token).get<MobileMyRequestsData>("/api/mobile/my-requests");
		},
	});
}
```

- [ ] **Step 4: Add the screen implementation**

Create `apps/mobile/src/features/my-requests/my-requests-screen.tsx`:

```tsx
import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { MobileMyRequestsData, MobileRequestItem, MobileRequestSourceType, MobileRequestStatus } from "./use-my-requests-query";

type StatusFilter = MobileRequestStatus | "all";
const RECENT_DECISION_DAYS = 30;
const STATUS_FILTERS: StatusFilter[] = ["all", "pending", "approved", "rejected", "cancelled"];
const SOURCE_FILTERS: Array<MobileRequestSourceType | "all"> = ["all", "absence", "time_correction", "travel_expense"];

export function MyRequestsScreen({ data }: { data: MobileMyRequestsData }) {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sourceFilter, setSourceFilter] = useState<MobileRequestSourceType | "all">("all");
	const filteredItems = useMemo(() => data.items.filter((item) => (statusFilter === "all" || item.status === statusFilter) && (sourceFilter === "all" || item.sourceType === sourceFilter)), [data.items, sourceFilter, statusFilter]);
	const groups = groupItems(filteredItems);

	return (
		<ScrollView contentContainerStyle={styles.content} style={styles.container}>
			<View style={styles.headerSurface}>
				<Text style={styles.eyebrow}>My Requests</Text>
				<Text style={styles.title}>Track request status</Text>
				<Text style={styles.description}>Review pending requests, required fixes, and recent decisions.</Text>
			</View>

			<View style={styles.summaryGrid}>
				<Summary label="Pending" value={data.counts.pending} />
				<Summary label="Required fixes" value={data.counts.requiredFixes} />
				<Summary label="Recent decisions" value={data.counts.recentDecisions} />
				<Summary label="Total" value={data.counts.total} />
			</View>

			{data.sourceErrors.length > 0 ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.warning}>Some requests could not be loaded</Text> : null}

			<FilterRow values={STATUS_FILTERS} active={statusFilter} onChange={setStatusFilter} />
			<FilterRow values={SOURCE_FILTERS} active={sourceFilter} onChange={setSourceFilter} />

			{data.items.length === 0 ? <Text style={styles.emptyState}>No requests yet</Text> : filteredItems.length === 0 ? <Text style={styles.emptyState}>No requests match these filters</Text> : null}
			<RequestSection title="Needs attention" items={groups.needsAttention} />
			<RequestSection title="In review" items={groups.inReview} />
			<RequestSection title="Recently decided" items={groups.recentlyDecided} />
			<RequestSection title="All requests" items={filteredItems} alwaysShow={filteredItems.length > 0} />
		</ScrollView>
	);
}

function groupItems(items: MobileRequestItem[]) {
	return {
		needsAttention: items.filter((item) => item.status === "rejected"),
		inReview: items.filter((item) => item.status === "pending"),
		recentlyDecided: items.filter((item) => isRecentlyDecided(item)),
	};
}

function isRecentlyDecided(item: MobileRequestItem) {
	if ((item.status !== "approved" && item.status !== "rejected") || !item.resolvedAt) {
		return false;
	}

	return DateTime.fromISO(item.resolvedAt) >= DateTime.now().minus({ days: RECENT_DECISION_DAYS });
}

function Summary({ label, value }: { label: string; value: number }) {
	return <View style={styles.summaryCard}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function FilterRow<T extends string>({ values, active, onChange }: { values: T[]; active: T; onChange: (value: T) => void }) {
	return <View style={styles.filterRow}>{values.map((value) => <Pressable accessibilityRole="button" accessibilityState={{ selected: active === value }} key={value} onPress={() => onChange(value)} style={[styles.filterChip, active === value && styles.filterChipActive]}><Text style={[styles.filterLabel, active === value && styles.filterLabelActive]}>{formatFilter(value)}</Text></Pressable>)}</View>;
}

function RequestSection({ title, items, alwaysShow = false }: { title: string; items: MobileRequestItem[]; alwaysShow?: boolean }) {
	if (!alwaysShow && items.length === 0) {
		return null;
	}

	return <View style={styles.surface}><Text style={styles.sectionTitle}>{title}</Text>{items.map((item) => <RequestCard key={`${title}-${item.id}`} item={item} />)}</View>;
}

function RequestCard({ item }: { item: MobileRequestItem }) {
	return <View style={styles.card}><View style={styles.cardHeader}><Text style={styles.rowTitle}>{formatTitle(item)}</Text><Text style={styles.statusLabel}>{formatFilter(item.status)}</Text></View><Text style={styles.rowMeta}>{formatFilter(item.sourceType)} · {formatSubtitle(item)}</Text><Text style={styles.rowMeta}>Submitted {formatDate(item.submittedAt)}</Text>{item.resolvedAt ? <Text style={styles.rowMeta}>Resolved {formatDate(item.resolvedAt)}</Text> : null}{item.decisionReason ? <Text style={styles.reason}>{item.decisionReason}</Text> : null}</View>;
}

function formatTitle(item: MobileRequestItem) {
	if (item.title === "time_correction") return "Time correction request";
	if (item.title === "travel_expense") return "Travel expense claim";
	return item.title === "absence" ? "Absence request" : item.title;
}

function formatSubtitle(item: MobileRequestItem) {
	return item.subtitle === "time_entry_correction" ? "Correction for a time entry" : item.subtitle;
}

function formatDate(value: string) {
	return DateTime.fromISO(value).toLocaleString(DateTime.DATE_MED);
}

function formatFilter(value: string) {
	return value.split("_").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#f8fafc" },
	content: { padding: 20, gap: 16 },
	headerSurface: { padding: 18, gap: 10, borderRadius: 16, borderWidth: 1, borderColor: "#dbeafe", backgroundColor: "#ffffff" },
	eyebrow: { fontSize: 13, fontWeight: "600", letterSpacing: 0.3, color: "#2563eb", textTransform: "uppercase" },
	title: { fontSize: 28, lineHeight: 32, fontWeight: "700", color: "#0f172a" },
	description: { fontSize: 15, lineHeight: 22, color: "#475569" },
	summaryGrid: { gap: 10 },
	summaryCard: { borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", padding: 14, backgroundColor: "#ffffff" },
	summaryValue: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
	summaryLabel: { fontSize: 13, color: "#475569" },
	warning: { borderRadius: 12, padding: 12, backgroundColor: "#fef2f2", color: "#991b1b", fontSize: 13, lineHeight: 18 },
	filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	filterChip: { borderRadius: 999, borderWidth: 1, borderColor: "#dbe2f0", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#ffffff" },
	filterChipActive: { borderColor: "#bfdbfe", backgroundColor: "#eff6ff" },
	filterLabel: { fontSize: 13, fontWeight: "600", color: "#475569" },
	filterLabelActive: { color: "#1d4ed8" },
	emptyState: { fontSize: 14, lineHeight: 20, color: "#64748b" },
	surface: { padding: 18, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#ffffff" },
	sectionTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
	card: { gap: 7, borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", padding: 14, backgroundColor: "#f8fafc" },
	cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
	rowTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
	rowMeta: { fontSize: 13, lineHeight: 18, color: "#475569" },
	statusLabel: { fontSize: 12, fontWeight: "700", color: "#1d4ed8" },
	reason: { fontSize: 13, lineHeight: 18, color: "#991b1b" },
});
```

- [ ] **Step 5: Run the screen test**

Run: `pnpm --filter mobile test -- src/features/my-requests/my-requests-screen.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/mobile/src/features/my-requests/use-my-requests-query.ts apps/mobile/src/features/my-requests/my-requests-screen.tsx apps/mobile/src/features/my-requests/my-requests-screen.test.tsx
git commit -m "feat: add mobile my requests screen"
```

## Task 6: Mobile Routes And Tabs

**Files:**
- Create: `apps/mobile/app/(app)/schedule.tsx`
- Create: `apps/mobile/app/(app)/my-requests.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`

- [ ] **Step 1: Add the schedule route**

Create `apps/mobile/app/(app)/schedule.tsx`:

```tsx
import { Redirect, useRouter } from "expo-router";
import { ScheduleScreen } from "@/src/features/schedule/schedule-screen";
import { useScheduleQuery } from "@/src/features/schedule/use-schedule-query";
import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export default function ScheduleRoute() {
	const router = useRouter();
	const sessionQuery = useMobileSession();
	const session = sessionQuery.data;
	const routeState = getMobileSessionRouteState({ session, isError: sessionQuery.isError, isLoading: sessionQuery.isLoading });
	const scheduleQuery = useScheduleQuery(session);

	if (routeState === "loading") return null;
	if (routeState === "error") return <MobileSessionErrorState onRetry={() => void sessionQuery.refetch()} />;
	if (routeState === "signed-out") return <Redirect href="/sign-in" />;
	if (!session) return null;
	if (!session.activeOrganizationId) return <Redirect href="/(app)/profile" />;
	if (scheduleQuery.isLoading) return null;
	if (scheduleQuery.isError || !scheduleQuery.data) return <MobileSessionErrorState onRetry={() => void scheduleQuery.refetch()} />;

	return <ScheduleScreen data={scheduleQuery.data} onRequestAbsence={() => router.push("/(app)/absences/request")} onViewRequests={() => router.push("/(app)/my-requests")} />;
}
```

- [ ] **Step 2: Add the my-requests route**

Create `apps/mobile/app/(app)/my-requests.tsx`:

```tsx
import { Redirect } from "expo-router";
import { MyRequestsScreen } from "@/src/features/my-requests/my-requests-screen";
import { useMyRequestsQuery } from "@/src/features/my-requests/use-my-requests-query";
import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import { useMobileSession } from "@/src/features/session/use-mobile-session";

export default function MyRequestsRoute() {
	const sessionQuery = useMobileSession();
	const session = sessionQuery.data;
	const routeState = getMobileSessionRouteState({ session, isError: sessionQuery.isError, isLoading: sessionQuery.isLoading });
	const myRequestsQuery = useMyRequestsQuery(session);

	if (routeState === "loading") return null;
	if (routeState === "error") return <MobileSessionErrorState onRetry={() => void sessionQuery.refetch()} />;
	if (routeState === "signed-out") return <Redirect href="/sign-in" />;
	if (!session) return null;
	if (!session.activeOrganizationId) return <Redirect href="/(app)/profile" />;
	if (myRequestsQuery.isLoading) return null;
	if (myRequestsQuery.isError || !myRequestsQuery.data) return <MobileSessionErrorState onRetry={() => void myRequestsQuery.refetch()} />;

	return <MyRequestsScreen data={myRequestsQuery.data} />;
}
```

- [ ] **Step 3: Update tab layout**

Modify `apps/mobile/app/(app)/_layout.tsx`:

```tsx
import { Tabs } from "expo-router";

export default function AppLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="schedule" options={{ title: "Schedule" }} />
      <Tabs.Screen name="my-requests" options={{ title: "My Requests" }} />
      <Tabs.Screen name="absences/index" options={{ title: "Absences" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
```

- [ ] **Step 4: Run mobile tests**

Run: `pnpm --filter mobile test -- src/features/schedule/schedule-screen.test.tsx src/features/my-requests/my-requests-screen.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/mobile/app/\(app\)/schedule.tsx apps/mobile/app/\(app\)/my-requests.tsx apps/mobile/app/\(app\)/_layout.tsx
git commit -m "feat: add mobile schedule requests tabs"
```

## Task 7: Verification And Polish

**Files:**
- Modify only files changed by earlier tasks if verification reveals a concrete issue.

- [ ] **Step 1: Run focused webapp tests**

Run:

```bash
pnpm --filter webapp test -- src/lib/mobile/effective-schedule.test.ts src/app/api/mobile/schedule/route.test.ts src/app/api/mobile/my-requests/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused mobile tests**

Run:

```bash
pnpm --filter mobile test -- src/features/schedule/schedule-screen.test.tsx src/features/my-requests/my-requests-screen.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run package test suites for touched packages**

Run:

```bash
pnpm --filter webapp test
pnpm --filter mobile test
```

Expected: PASS.

- [ ] **Step 4: Build touched packages**

Run:

```bash
CI=true pnpm --filter webapp build
pnpm --filter mobile build
```

Expected: PASS. If the webapp build cannot run because required system-level environment variables are unavailable to agents, record that as skipped with the missing environment reason.

- [ ] **Step 5: Inspect final diff**

Run: `git diff --stat HEAD~7..HEAD`

Expected: Shows only mobile parity implementation files and tests.

- [ ] **Step 6: Commit verification fixes if any were needed**

Run this only if Step 1 through Step 4 required code changes:

```bash
git add apps/webapp/src/lib/mobile apps/webapp/src/app/api/mobile apps/mobile/app/\(app\) apps/mobile/src/features/schedule apps/mobile/src/features/my-requests
git commit -m "fix: polish mobile schedule requests parity"
```

Expected: A commit is created only when verification produced real fixes.

## Self-Review

- Spec coverage: schedule API, effective schedule, published assigned shifts, mobile schedule screen, request API, grouped mobile request screen, direct tabs, error states, and tests are each covered by a task.
- Placeholder scan: the plan contains no incomplete sections or deferred requirements.
- Type consistency: mobile response types match the API response shapes used in tests and screens.
