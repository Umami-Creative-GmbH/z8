# Calendar On-Behalf Clock-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authorized stop button to running employee calendar timeframes so owners/admins can clock out any employee and managers can clock out assigned employees.

**Architecture:** Add a dedicated `POST /api/time-entries/clock-out-on-behalf` route that closes a target running `workPeriod` at current server time. The calendar event data exposes target `employeeId`, Schedule-X renders a delegated stop button inside authorized running events, and `CalendarView` owns confirmation, mutation state, toasts, and refetching.

**Tech Stack:** Next.js route handlers, Drizzle ORM, CASL authorization, Luxon/timezone capture helpers, React, Schedule-X, Vitest, Testing Library, `sonner`, `@tabler/icons-react`, pnpm.

---

## File Structure

- Create `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.ts`: authenticated route for closing another employee's active work period.
- Create `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.test.ts`: route tests for authorization, tenancy, timezone capture, and race conflicts.
- Modify `apps/webapp/src/lib/authorization/ability.ts`: grant managers `manage TimeEntry` for direct reports while preserving outside-org guardrails.
- Modify `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`: assert managers can manage direct-report time entries and cannot manage unmanaged time entries.
- Modify `apps/webapp/src/lib/calendar/types.ts`: add `employeeId` to `WorkPeriodEvent.metadata`.
- Modify `apps/webapp/src/lib/calendar/work-period-service.ts`: include `employeeId` in work period event metadata, including running periods.
- Modify `apps/webapp/src/lib/calendar/work-period-service.test.ts`: assert running events include target `employeeId`.
- Modify `apps/webapp/src/lib/calendar/schedule-x-adapter.ts`: add optional running clock-out action rendering in `_customContent.timeGrid`.
- Modify `apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts`: assert authorized running events render a stop button and unauthorized ones do not.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: pass authorization callback into adapter and delegate stop-button clicks from the Schedule-X container.
- Modify `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`: forward new running clock-out props through the dynamic wrapper.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`: test delegated stop-button click handling and prop-driven action rendering.
- Modify `apps/webapp/src/components/calendar/calendar-view.tsx`: own confirmation dialog, call the new API route, show toasts, and refresh data.
- Modify `apps/webapp/src/components/calendar/calendar-view.test.tsx`: test confirmation, API call, refetch success, and error handling.

## Task 1: Authorization Rules

**Files:**
- Modify: `apps/webapp/src/lib/authorization/ability.ts`
- Modify: `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`

- [ ] **Step 1: Write failing authorization tests**

Add tests near the existing manager time-entry assertions in `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`:

```ts
it("allows managers to manage direct-report time entries", () => {
	const ability = defineAbilityFor({
		...basePrincipal,
		employee: { ...managerEmployee, role: "manager" },
		managedEmployeeIds: [EMPLOYEE_2],
	});

	expect(
		ability.can(
			"manage",
			subject("TimeEntry", {
				employeeId: EMPLOYEE_2,
				organizationId: ORG_ID,
			}),
		),
	).toBe(true);
});

it("prevents managers from managing unassigned employee time entries", () => {
	const ability = defineAbilityFor({
		...basePrincipal,
		employee: { ...managerEmployee, role: "manager" },
		managedEmployeeIds: [EMPLOYEE_2],
	});

	expect(
		ability.can(
			"manage",
			subject("TimeEntry", {
				employeeId: "employee-unassigned",
				organizationId: ORG_ID,
			}),
		),
	).toBe(false);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter webapp test src/lib/authorization/__tests__/ability.test.ts`

Expected: the direct-report `manage TimeEntry` test fails because managers currently only receive `read` on direct-report time entries.

- [ ] **Step 3: Implement the minimal authorization change**

In `apps/webapp/src/lib/authorization/ability.ts`, update the manager direct-report time-entry grant:

```ts
can("read", "TimeEntry", selfCondition);
can("manage", "TimeEntry", directReportCondition);
```

Keep the existing `cannot(timeEntryActions, "TimeEntry", outsideOrgCondition)` and `$nin` guardrails unchanged.

- [ ] **Step 4: Run tests and verify pass**

Run: `pnpm --filter webapp test src/lib/authorization/__tests__/ability.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/authorization/ability.ts apps/webapp/src/lib/authorization/__tests__/ability.test.ts
git commit -m "feat: allow managers to manage direct-report time entries"
```

## Task 2: On-Behalf Clock-Out API Route

**Files:**
- Create: `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.ts`
- Create: `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.test.ts` with tests covering: success, unauthorized, cross-org/not found, already stopped, timezone capture, and race conflict. Use this structure and keep mock names aligned with the route imports:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const limit = vi.fn();
	const where = vi.fn(() => ({ limit }));
	const innerJoinEmployee = vi.fn(() => ({ where }));
	const fromWorkPeriod = vi.fn(() => ({ innerJoin: innerJoinEmployee }));
	const fromEmployee = vi.fn(() => ({ where }));
	const select = vi.fn((shape?: unknown) => ({ from: shape ? fromWorkPeriod : fromEmployee }));
	const txLimit = vi.fn();
	const txWhere = vi.fn(() => ({ limit: txLimit }));
	const txFrom = vi.fn(() => ({ where: txWhere }));
	const txSelect = vi.fn(() => ({ from: txFrom }));
	const updateReturning = vi.fn(async () => [{ id: "period-1" }]);
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const txExecute = vi.fn(async () => undefined);
	const txClient = { execute: txExecute, select: txSelect, update };
	const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(txClient));

	return {
		asAppSubject: vi.fn((subject, data) => ({ ...data, __caslSubjectType__: subject })),
		connection: vi.fn(),
		createBillingForbiddenResponse: vi.fn(() => Response.json({ error: "Billing restricted" }, { status: 403 })),
		createTimeEntry: vi.fn(async () => ({ id: "clock-out-1" })),
		getAbility: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		isBillingMutationAllowed: vi.fn(),
		limit,
		requireBillingForMutation: vi.fn(),
		select,
		transaction,
		txClient,
		txExecute,
		txLimit,
		updateReturning,
		updateSet,
		updateWhere,
	};
});

vi.mock("next/headers", () => ({ headers: mockState.headers }));
vi.mock("next/server", async () => ({ ...(await vi.importActual("next/server")), connection: mockState.connection }));
vi.mock("@/db", () => ({
	db: {
		query: { userSettings: { findFirst: vi.fn(async () => ({ timezone: "Europe/Berlin" })) } },
		select: mockState.select,
		transaction: mockState.transaction,
	},
}));
vi.mock("@/db/schema", () => ({
	employee: { id: "employee.id", isActive: "employee.isActive", organizationId: "employee.organizationId", userId: "employee.userId" },
	workPeriod: { clockOutId: "workPeriod.clockOutId", deletedAt: "workPeriod.deletedAt", employeeId: "workPeriod.employeeId", endTime: "workPeriod.endTime", id: "workPeriod.id", isActive: "workPeriod.isActive", organizationId: "workPeriod.organizationId" },
	userSettings: { userId: "userSettings.userId" },
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mockState.getSession } } }));
vi.mock("@/lib/auth-helpers", () => ({ getAbility: mockState.getAbility }));
vi.mock("@/lib/authorization", () => ({ asAppSubject: mockState.asAppSubject, ForbiddenError: class ForbiddenError extends Error {}, toHttpError: () => ({ body: { error: "Forbidden" }, status: 403 }) }));
vi.mock("@/lib/billing/guard", () => ({ createBillingForbiddenResponse: mockState.createBillingForbiddenResponse, isBillingMutationAllowed: mockState.isBillingMutationAllowed, requireBillingForMutation: mockState.requireBillingForMutation }));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/entry-helpers", () => ({ createTimeEntry: mockState.createTimeEntry }));
vi.mock("drizzle-orm", () => ({ and: (...conditions: unknown[]) => ({ conditions, type: "and" }), eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }), isNull: (column: unknown) => ({ column, type: "isNull" }), sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, type: "sql", values }) }));

const { POST } = await import("./route");

function createRequest(body: unknown) {
	return new Request("https://z8.test/api/time-entries/clock-out-on-behalf", {
		body: JSON.stringify(body),
		method: "POST",
	}) as never;
}

describe("POST /api/time-entries/clock-out-on-behalf", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({ session: { activeOrganizationId: "org-1" }, user: { id: "actor-user-1" } });
		mockState.getAbility.mockResolvedValue({ can: vi.fn(() => true) });
		mockState.requireBillingForMutation.mockResolvedValue({ status: "active" });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.limit.mockReset();
		mockState.limit
			.mockResolvedValueOnce([{ id: "actor-employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([{ period: { id: "period-1", employeeId: "target-employee-1", organizationId: "org-1", startTime: new Date("2026-06-09T08:00:00.000Z"), endTime: null, isActive: true }, targetEmployee: { id: "target-employee-1", organizationId: "org-1", userId: "target-user-1" } }]);
		mockState.txLimit.mockReset();
		mockState.txLimit.mockResolvedValueOnce([{ id: "period-1", employeeId: "target-employee-1", organizationId: "org-1", startTime: new Date("2026-06-09T08:00:00.000Z"), endTime: null, isActive: true }]);
		mockState.updateReturning.mockResolvedValue([{ id: "period-1" }]);
	});

	it("closes a running work period for an authorized actor", async () => {
		vi.setSystemTime(new Date("2026-06-09T10:30:00.000Z"));
		const response = await POST(createRequest({ workPeriodId: "period-1" }));
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ entry: { id: "clock-out-1" } });
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "target-employee-1", organizationId: "org-1", type: "clock_out", createdBy: "actor-user-1", timezone: "Europe/Berlin", timezoneSource: "manager_target_user_setting" }), mockState.txClient);
		expect(mockState.updateSet).toHaveBeenCalledWith(expect.objectContaining({ clockOutId: "clock-out-1", endTime: new Date("2026-06-09T10:30:00.000Z"), durationMinutes: 150, isActive: false }));
	});

	it("rejects unauthorized actors", async () => {
		mockState.getAbility.mockResolvedValue({ can: vi.fn(() => false) });
		const response = await POST(createRequest({ workPeriodId: "period-1" }));
		expect(response.status).toBe(403);
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("rejects missing or cross-organization periods", async () => {
		mockState.limit.mockReset();
		mockState.limit.mockResolvedValueOnce([{ id: "actor-employee-1", organizationId: "org-1" }]).mockResolvedValueOnce([]);
		const response = await POST(createRequest({ workPeriodId: "foreign-period" }));
		expect(response.status).toBe(404);
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("rejects periods that are already stopped", async () => {
		mockState.limit.mockReset();
		mockState.limit.mockResolvedValueOnce([{ id: "actor-employee-1", organizationId: "org-1" }]).mockResolvedValueOnce([{ period: { id: "period-1", employeeId: "target-employee-1", organizationId: "org-1", endTime: new Date("2026-06-09T10:00:00.000Z"), isActive: false }, targetEmployee: { id: "target-employee-1", organizationId: "org-1", userId: "target-user-1" } }]);
		const response = await POST(createRequest({ workPeriodId: "period-1" }));
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Work period is no longer running" });
	});

	it("returns conflict when the guarded update loses the race", async () => {
		mockState.updateReturning.mockResolvedValueOnce([]);
		const response = await POST(createRequest({ workPeriodId: "period-1" }));
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Active work period changed" });
	});
});
```

- [ ] **Step 2: Run tests and verify route is missing**

Run: `pnpm --filter webapp test src/app/api/time-entries/clock-out-on-behalf/route.test.ts`

Expected: FAIL because `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.ts`:

```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { createTimeEntry } from "@/app/[locale]/(app)/time-tracking/actions/entry-helpers";
import { db } from "@/db";
import { employee, userSettings, workPeriod } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { asAppSubject, ForbiddenError, toHttpError } from "@/lib/authorization";
import { createBillingForbiddenResponse, isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import { isValidIanaTimezone, resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";

class TimeEntryConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TimeEntryConflictError";
	}
}

async function getSavedUserTimezone(userId: string): Promise<string> {
	try {
		const settings = await db.query.userSettings.findFirst({
			where: eq(userSettings.userId, userId),
			columns: { timezone: true },
		});

		return isValidIanaTimezone(settings?.timezone) ? settings.timezone : "UTC";
	} catch {
		return "UTC";
	}
}

export async function POST(request: NextRequest) {
	await connection();

	try {
		const [resolvedHeaders, body] = await Promise.all([headers(), request.json()]);
		const session = await auth.api.getSession({ headers: resolvedHeaders });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const workPeriodId = typeof body.workPeriodId === "string" ? body.workPeriodId : null;
		if (!workPeriodId) {
			return NextResponse.json({ error: "workPeriodId is required" }, { status: 400 });
		}

		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		const [actorEmployee] = await db
			.select()
			.from(employee)
			.where(and(eq(employee.userId, session.user.id), eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
			.limit(1);

		if (!actorEmployee) {
			return NextResponse.json({ error: "Employee record not found in this organization" }, { status: 404 });
		}

		const [target] = await db
			.select({ period: workPeriod, targetEmployee: employee })
			.from(workPeriod)
			.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
			.where(and(eq(workPeriod.id, workPeriodId), eq(workPeriod.organizationId, organizationId), isNull(workPeriod.deletedAt)))
			.limit(1);

		if (!target) {
			return NextResponse.json({ error: "Work period not found" }, { status: 404 });
		}

		if (!target.period.isActive || target.period.endTime) {
			return NextResponse.json({ error: "Work period is no longer running" }, { status: 409 });
		}

		const ability = await getAbility();
		if (
			!ability?.can(
				"manage",
				asAppSubject("TimeEntry", {
					employeeId: target.targetEmployee.id,
					organizationId,
				}),
			)
		) {
			const error = new ForbiddenError("manage", "TimeEntry");
			const httpError = toHttpError(error);
			return NextResponse.json(httpError.body, { status: httpError.status });
		}

		const billingAccess = await requireBillingForMutation(organizationId);
		if (!isBillingMutationAllowed(billingAccess)) {
			return createBillingForbiddenResponse(billingAccess);
		}

		const entryTime = new Date();
		const timezone = await getSavedUserTimezone(target.targetEmployee.userId);
		const timezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: entryTime,
			timezone,
			timezoneSource: "manager_target_user_setting",
		});

		const entry = await db.transaction(async (tx) => {
			const lockKey = `${organizationId}:${target.targetEmployee.id}`;
			await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

			const [activePeriod] = await tx
				.select()
				.from(workPeriod)
				.where(and(eq(workPeriod.id, workPeriodId), eq(workPeriod.employeeId, target.targetEmployee.id), eq(workPeriod.organizationId, organizationId), eq(workPeriod.isActive, true), isNull(workPeriod.endTime), isNull(workPeriod.deletedAt)))
				.limit(1);

			if (!activePeriod) {
				throw new TimeEntryConflictError("Active work period changed");
			}

			const createdEntry = await createTimeEntry(
				{
					employeeId: target.targetEmployee.id,
					organizationId,
					type: "clock_out",
					timestamp: entryTime,
					createdBy: session.user.id,
					...timezoneCapture,
				},
				tx,
			);

			const durationMinutes = Math.round((entryTime.getTime() - activePeriod.startTime.getTime()) / 60000);
			const updatedPeriods = await tx
				.update(workPeriod)
				.set({ clockOutId: createdEntry.id, endTime: entryTime, durationMinutes, isActive: false })
				.where(and(eq(workPeriod.id, activePeriod.id), eq(workPeriod.employeeId, target.targetEmployee.id), eq(workPeriod.organizationId, organizationId), eq(workPeriod.isActive, true), isNull(workPeriod.endTime), isNull(workPeriod.deletedAt)))
				.returning({ id: workPeriod.id });

			if (updatedPeriods.length === 0) {
				throw new TimeEntryConflictError("Active work period changed");
			}

			return createdEntry;
		});

		return NextResponse.json({ entry }, { status: 201 });
	} catch (error) {
		if (error instanceof TimeEntryConflictError) {
			return NextResponse.json({ error: error.message }, { status: 409 });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
```

- [ ] **Step 4: Run route tests and verify pass**

Run: `pnpm --filter webapp test src/app/api/time-entries/clock-out-on-behalf/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.ts apps/webapp/src/app/api/time-entries/clock-out-on-behalf/route.test.ts
git commit -m "feat: add on-behalf clock-out api"
```

## Task 3: Calendar Event Employee Metadata

**Files:**
- Modify: `apps/webapp/src/lib/calendar/types.ts`
- Modify: `apps/webapp/src/lib/calendar/work-period-service.ts`
- Modify: `apps/webapp/src/lib/calendar/work-period-service.test.ts`

- [ ] **Step 1: Write failing metadata tests**

In `apps/webapp/src/lib/calendar/work-period-service.test.ts`, update the active running period assertion to include the target employee ID:

```ts
expect(event.metadata).toEqual(
	expect.objectContaining({
		employeeId: "employee-1",
		employeeName: "Ada Lovelace",
		isRunning: true,
	}),
);
```

Also update one completed work-period assertion:

```ts
expect(event.metadata).toEqual(
	expect.objectContaining({
		employeeId: "employee-1",
		employeeName: "Ada Lovelace",
	}),
);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter webapp test src/lib/calendar/work-period-service.test.ts`

Expected: FAIL because `metadata.employeeId` is not present.

- [ ] **Step 3: Add `employeeId` to the event type**

In `apps/webapp/src/lib/calendar/types.ts`, update `WorkPeriodEvent.metadata`:

```ts
metadata: {
	durationMinutes: number;
	employeeId: string;
	employeeName: string;
	notes?: string;
```

- [ ] **Step 4: Populate metadata in the service**

In `apps/webapp/src/lib/calendar/work-period-service.ts`, add `employeeId: period.employeeId` to both running and completed event metadata objects:

```ts
metadata: {
	durationMinutes,
	employeeId: period.employeeId,
	employeeName: user.name,
	startTime: startTimeFormatted,
	// existing metadata stays below
}
```

For completed periods:

```ts
metadata: {
	durationMinutes,
	employeeId: period.employeeId,
	employeeName: user.name,
	notes: notes || undefined,
	startTime: startTimeFormatted,
	endTime: endTimeFormatted,
	// existing metadata stays below
}
```

- [ ] **Step 5: Run tests and verify pass**

Run: `pnpm --filter webapp test src/lib/calendar/work-period-service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/calendar/types.ts apps/webapp/src/lib/calendar/work-period-service.ts apps/webapp/src/lib/calendar/work-period-service.test.ts
git commit -m "feat: expose work period employee metadata"
```

## Task 4: Schedule-X Stop Button Rendering And Delegation

**Files:**
- Modify: `apps/webapp/src/lib/calendar/schedule-x-adapter.ts`
- Modify: `apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`

- [ ] **Step 1: Write failing adapter tests**

In `apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts`, add:

```ts
it("renders a stop button for authorized running work periods", () => {
	const runningPeriod: WorkPeriodEvent = {
		id: "work-running-action",
		type: "work_period",
		date: new Date("2026-05-18T14:48:00.000Z"),
		endDate: new Date("2026-05-18T15:48:00.000Z"),
		title: "Ada Lovelace - 1h (running)",
		color: "#10b981",
		metadata: {
			durationMinutes: 60,
			employeeId: "employee-1",
			employeeName: "Ada Lovelace",
			isRunning: true,
		},
	};

	const scheduleXEvent = calendarEventToScheduleX(runningPeriod, "UTC", {
		canClockOutRunningPeriod: () => true,
	});

	expect(scheduleXEvent?._customContent?.timeGrid).toContain("data-running-clock-out-button");
	expect(scheduleXEvent?._customContent?.timeGrid).toContain('data-work-period-id="work-running-action"');
	expect(scheduleXEvent?._customContent?.timeGrid).toContain("Stop");
});

it("does not render a stop button for unauthorized running work periods", () => {
	const runningPeriod: WorkPeriodEvent = {
		id: "work-running-no-action",
		type: "work_period",
		date: new Date("2026-05-18T14:48:00.000Z"),
		endDate: new Date("2026-05-18T15:48:00.000Z"),
		title: "Ada Lovelace - 1h (running)",
		color: "#10b981",
		metadata: {
			durationMinutes: 60,
			employeeId: "employee-1",
			employeeName: "Ada Lovelace",
			isRunning: true,
		},
	};

	const scheduleXEvent = calendarEventToScheduleX(runningPeriod, "UTC", {
		canClockOutRunningPeriod: () => false,
	});

	expect(scheduleXEvent?._customContent?.timeGrid).not.toContain("data-running-clock-out-button");
});
```

- [ ] **Step 2: Run adapter tests and verify failure**

Run: `pnpm --filter webapp test src/lib/calendar/schedule-x-adapter.test.ts`

Expected: FAIL because `calendarEventToScheduleX` does not accept options and does not render the button.

- [ ] **Step 3: Add adapter options and button HTML**

In `apps/webapp/src/lib/calendar/schedule-x-adapter.ts`, add:

```ts
export interface ScheduleXAdapterOptions {
	canClockOutRunningPeriod?: (event: CalendarEvent) => boolean;
}
```

Change signatures:

```ts
export function calendarEventToScheduleX(
	event: CalendarEvent,
	timeZone?: string,
	options: ScheduleXAdapterOptions = {},
): ScheduleXEvent | null {
```

```ts
export function calendarEventsToScheduleX(
	events: CalendarEvent[],
	timeZone?: string,
	options: ScheduleXAdapterOptions = {},
): ScheduleXEvent[] {
```

Pass options inside the loop:

```ts
const scheduleXEvent = calendarEventToScheduleX(event, timeZone, options);
```

Add a helper near `formatUtcOffsetMinutes`:

```ts
function buildRunningClockOutButton(event: CalendarEvent, options: ScheduleXAdapterOptions): string {
	if (!event.metadata.isRunning || !options.canClockOutRunningPeriod?.(event)) return "";

	return `<button type="button" class="ml-auto inline-flex items-center rounded-sm border border-white/50 bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 shadow-sm hover:bg-white focus:outline-none focus:ring-2 focus:ring-white" data-running-clock-out-button="true" data-work-period-id="${escapeHtml(event.id)}" aria-label="Stop running work period">Stop</button>`;
}
```

Replace the running `_customContent.timeGrid` string with:

```ts
const stopButton = buildRunningClockOutButton(event, options);
const runningContent = `<span class="inline-flex w-full items-center gap-1.5"><span class="relative inline-flex size-2 shrink-0" aria-hidden="true"><span class="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75"></span><span class="relative inline-flex size-2 rounded-full bg-red-500"></span></span><span class="min-w-0 flex-1 truncate">${escapeHtml(event.title)}</span>${timezoneLabel ? `<span class="text-[10px] opacity-80">${escapeHtml(timezoneLabel)}</span>` : ""}${stopButton}</span>`;
```

Use `runningContent` in the existing ternary.

- [ ] **Step 4: Add delegated click props and handler tests**

In `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`, add a test that captures the passed adapter options and a test for delegated clicks:

```ts
it("passes clock-out authorization into Schedule-X event conversion", () => {
	const canClockOutRunningPeriod = vi.fn(() => true);
	render(
		<ScheduleXCalendarWrapper
			events={[runningWorkPeriod]}
			canClockOutRunningPeriod={canClockOutRunningPeriod}
			onRunningPeriodClockOutRequest={vi.fn()}
			onViewModeChange={vi.fn()}
			viewMode="week"
		/>,
	);

	expect(canClockOutRunningPeriod).toHaveBeenCalledWith(runningWorkPeriod);
});

it("delegates stop button clicks to onRunningPeriodClockOutRequest", () => {
	const onRunningPeriodClockOutRequest = vi.fn();
	render(
		<ScheduleXCalendarWrapper
			events={[runningWorkPeriod]}
			canClockOutRunningPeriod={() => true}
			onRunningPeriodClockOutRequest={onRunningPeriodClockOutRequest}
			onViewModeChange={vi.fn()}
			viewMode="week"
		/>,
	);

	const container = document.querySelector(".schedule-x-container")!;
	const button = document.createElement("button");
	button.dataset.runningClockOutButton = "true";
	button.dataset.workPeriodId = runningWorkPeriod.id;
	container.append(button);
	button.click();

	expect(onRunningPeriodClockOutRequest).toHaveBeenCalledWith(runningWorkPeriod);
});
```

- [ ] **Step 5: Implement delegated click props**

In both `ScheduleXCalendarWrapperProps` and `ScheduleXWrapperProps`, add:

```ts
canClockOutRunningPeriod?: (event: CalendarEvent) => boolean;
onRunningPeriodClockOutRequest?: (event: CalendarEvent) => void;
```

Destructure them in `ScheduleXCalendarWrapper`, pass adapter options:

```ts
const baseScheduleXEvents = calendarEventsToScheduleX(
	filterEventsForScheduleXView(liveEvents, viewMode),
	timeZone,
	{ canClockOutRunningPeriod },
);
```

Add the delegated click effect after `calendarContainerRef` is created:

```ts
useEffect(() => {
	const container = calendarContainerRef.current;
	if (!container || !onRunningPeriodClockOutRequest) return;

	const handleClick = (event: MouseEvent) => {
		const target = event.target instanceof Element ? event.target : null;
		const button = target?.closest<HTMLButtonElement>("[data-running-clock-out-button]");
		if (!button) return;

		event.preventDefault();
		event.stopPropagation();

		const workPeriodId = button.dataset.workPeriodId;
		const calendarEvent = events.find(
			(item) => item.id === workPeriodId && item.type === "work_period" && item.metadata.isRunning,
		);

		if (calendarEvent) {
			onRunningPeriodClockOutRequest(calendarEvent);
		}
	};

	container.addEventListener("click", handleClick);
	return () => container.removeEventListener("click", handleClick);
}, [events, onRunningPeriodClockOutRequest]);
```

- [ ] **Step 6: Run tests and verify pass**

Run: `pnpm --filter webapp test src/lib/calendar/schedule-x-adapter.test.ts src/components/calendar/schedule-x-calendar.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/calendar/schedule-x-adapter.ts apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-wrapper.tsx apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx
git commit -m "feat: render calendar running stop action"
```

## Task 5: Calendar Confirmation And Mutation Flow

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Write failing UI tests**

In `apps/webapp/src/components/calendar/calendar-view.test.tsx`, mock `sonner` and capture new `ScheduleXWrapper` props:

```ts
const { toastError, toastSuccess } = vi.hoisted(() => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { error: toastError, success: toastSuccess },
}));
```

Update the `ScheduleXWrapper` mock props to include:

```ts
canClockOutRunningPeriod,
onRunningPeriodClockOutRequest,
```

and render a test button:

```tsx
<button
	type="button"
	data-can-clock-out={String(canClockOutRunningPeriod?.(runningWorkPeriod) ?? false)}
	onClick={() => onRunningPeriodClockOutRequest?.(runningWorkPeriod)}
>
	Request stop
</button>
```

Add tests:

```ts
it("confirms and clocks out a running work period", async () => {
	global.fetch = vi.fn(async () =>
		Response.json({ entry: { id: "clock-out-1" } }, { status: 201 }),
	) as never;
	mockCalendarData.events = [runningWorkPeriod];
	render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

	fireEvent.click(screen.getByText("Request stop"));
	expect(screen.getByText("Clock out Ada Lovelace?"));
	fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));

	await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/time-entries/clock-out-on-behalf", expect.objectContaining({ method: "POST" })));
	expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ workPeriodId: "work-running" });
	expect(refetch).toHaveBeenCalled();
	expect(toastSuccess).toHaveBeenCalledWith("Employee clocked out successfully");
});

it("shows an error and keeps the dialog open when clock-out fails", async () => {
	global.fetch = vi.fn(async () =>
		Response.json({ error: "Work period is no longer running" }, { status: 409 }),
	) as never;
	mockCalendarData.events = [runningWorkPeriod];
	render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

	fireEvent.click(screen.getByText("Request stop"));
	fireEvent.click(screen.getByRole("button", { name: "Clock Out" }));

	await waitFor(() => expect(toastError).toHaveBeenCalledWith("Work period is no longer running"));
	expect(refetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter webapp test src/components/calendar/calendar-view.test.tsx`

Expected: FAIL because `CalendarView` does not pass clock-out props or render confirmation.

- [ ] **Step 3: Implement confirmation state and mutation**

In `apps/webapp/src/components/calendar/calendar-view.tsx`, add imports:

```ts
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
```

Add state:

```ts
const [pendingClockOutEvent, setPendingClockOutEvent] = useState<CalendarEvent | null>(null);
const [isClockingOutEmployee, setIsClockingOutEmployee] = useState(false);
```

Add helpers inside `CalendarView`:

```ts
const canClockOutRunningPeriod = (event: CalendarEvent) => {
	return event.type === "work_period" && event.metadata.isRunning === true && isManagerOrAbove;
};

const handleRunningPeriodClockOutRequest = (event: CalendarEvent) => {
	if (!canClockOutRunningPeriod(event)) return;
	setPendingClockOutEvent(event);
};

const handleConfirmClockOutEmployee = async () => {
	if (!pendingClockOutEvent) return;

	setIsClockingOutEmployee(true);
	try {
		const response = await fetch("/api/time-entries/clock-out-on-behalf", {
			body: JSON.stringify({ workPeriodId: pendingClockOutEvent.id }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});
		const result = await response.json().catch(() => ({}));

		if (!response.ok) {
			throw new Error(typeof result.error === "string" ? result.error : "Failed to clock out employee");
		}

		toast.success(t("calendar.clockOut.success", "Employee clocked out successfully"));
		setPendingClockOutEvent(null);
		refetch();
	} catch (error) {
		const message = error instanceof Error ? error.message : t("calendar.clockOut.error", "Failed to clock out employee");
		toast.error(message);
	} finally {
		setIsClockingOutEmployee(false);
	}
};
```

Pass props into `ScheduleXWrapper`:

```tsx
<ScheduleXWrapper
	events={events}
	timeZone={calendarTimeZone}
	isLoading={isLoading}
	viewMode={viewMode}
	onViewModeChange={setViewMode}
	onEventClick={handleEventClick}
	onRangeChange={handleRangeChange}
	onTimeRangeSelect={handleTimeRangeSelect}
	onRefresh={refetch}
	workHoursData={workHoursData}
	isSummaryLoading={isFetching}
	canClockOutRunningPeriod={canClockOutRunningPeriod}
	onRunningPeriodClockOutRequest={handleRunningPeriodClockOutRequest}
/>
```

Render the confirmation dialog near the other dialogs:

```tsx
<AlertDialog open={!!pendingClockOutEvent} onOpenChange={(open) => !open && !isClockingOutEmployee && setPendingClockOutEvent(null)}>
	<AlertDialogContent>
		<AlertDialogHeader>
			<AlertDialogTitle>
				{t("calendar.clockOut.confirmTitle", "Clock out {employeeName}?", {
					employeeName: pendingClockOutEvent?.metadata.employeeName ?? t("calendar.clockOut.employee", "employee"),
				})}
			</AlertDialogTitle>
			<AlertDialogDescription>
				{t("calendar.clockOut.confirmDescription", "This will create an auditable clock-out entry at the current server time. If the time needs adjustment, use the existing correction flow afterward.")}
			</AlertDialogDescription>
		</AlertDialogHeader>
		<AlertDialogFooter>
			<AlertDialogCancel disabled={isClockingOutEmployee}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
			<AlertDialogAction disabled={isClockingOutEmployee} onClick={(event) => { event.preventDefault(); void handleConfirmClockOutEmployee(); }}>
				{isClockingOutEmployee && <IconLoader2 className="mr-2 size-4 animate-spin" />}
				{t("calendar.clockOut.confirmAction", "Clock Out")}
			</AlertDialogAction>
		</AlertDialogFooter>
	</AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 4: Run UI tests and verify pass**

Run: `pnpm --filter webapp test src/components/calendar/calendar-view.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx
git commit -m "feat: confirm calendar employee clock-out"
```

## Task 6: Final Verification

**Files:**
- Verify only; modify files only if checks reveal issues.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter webapp test src/lib/authorization/__tests__/ability.test.ts src/app/api/time-entries/clock-out-on-behalf/route.test.ts src/lib/calendar/work-period-service.test.ts src/lib/calendar/schedule-x-adapter.test.ts src/components/calendar/schedule-x-calendar.test.tsx src/components/calendar/calendar-view.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `CI=true pnpm build`

Expected: PASS.

- [ ] **Step 4: Inspect git status and diff**

Run: `git status --short`

Expected: only intended files are modified or untracked. Do not touch unrelated files such as `docs/superpowers/plans/2026-06-09-invited-employee-drafts.md` unless explicitly asked.

Run: `git diff --stat`

Expected: changes match this plan's file list.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes, commit only those intended files:

```bash
git add <fixed-files>
git commit -m "fix: stabilize calendar employee clock-out"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: backend route, authorization, target timezone capture, organization scoping, running-event `employeeId`, day/week stop action, confirmation, refetch, error handling, and focused tests are all mapped to tasks.
- Placeholder scan: no unfinished-marker placeholders are present.
- Type consistency: the plan consistently uses `workPeriodId`, `metadata.employeeId`, `canClockOutRunningPeriod`, and `onRunningPeriodClockOutRequest` across adapter, Schedule-X wrapper, and CalendarView tasks.
