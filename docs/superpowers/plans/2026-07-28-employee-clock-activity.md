# Employee Clock Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show localized time-since or last-activity text for each employee in the managed-employees dashboard widget and both team-page views.

**Architecture:** Enrich the existing organization-scoped, permission-aware presence response with the latest canonical clock event and its captured UTC offset while preserving the hook's current `getStatus` API. A shared `EmployeeActivityText` component delegates all Temporal calculations to an exported pure formatter, and only the dashboard and team page opt into rendering it.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, Effect, TanStack Query, Temporal polyfill, Tolgee, Vitest, Testing Library

---

## File Structure

- Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.ts`: return status plus latest accessible clock activity.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.test.ts`: verify latest-event selection and tenant/permission filters.
- Modify `apps/webapp/src/lib/query/use-employee-clock-statuses.ts`: preserve status-only access and add `getActivity`.
- Modify `apps/webapp/src/lib/query/use-employee-clock-statuses.test.tsx`: verify enriched mapping, failures, and omitted employees.
- Modify `apps/webapp/src/lib/query/index.ts`: export the new shared presence/activity types.
- Create `apps/webapp/src/components/employee-activity-text.tsx`: own localized activity rendering and pure Temporal formatting.
- Create `apps/webapp/src/components/employee-activity-text.test.tsx`: cover all relative/date/error boundaries.
- Modify `apps/webapp/messages/common/{de,el,en,es,fr,gsw,it,pl,pt,tr}.json`: add compact localized activity templates.
- Modify `apps/webapp/src/components/dashboard/managed-employees-widget.tsx`: render activity under dashboard employee details.
- Modify `apps/webapp/src/components/dashboard/managed-employees-widget.test.tsx`: verify activity metadata wiring.
- Modify `apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx`: render activity in cards and table rows.
- Modify `apps/webapp/src/app/[locale]/(app)/team/team-members-list.test.tsx`: verify both team-page layouts.

### Task 1: Enrich The Shared Presence Snapshot

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.ts`
- Modify: `apps/webapp/src/lib/query/use-employee-clock-statuses.test.tsx`
- Modify: `apps/webapp/src/lib/query/use-employee-clock-statuses.ts`
- Modify: `apps/webapp/src/lib/query/index.ts`

- [ ] **Step 1: Extend the server-action test harness and write failing activity tests**

Add `inArrayCalls` to the hoisted mocks and wrap Drizzle's real `inArray` in the same way the test already wraps `eq`:

```ts
const mocks = vi.hoisted(() => ({
	eqCalls: [] as Array<{ columnName: string; tableName: string | undefined; value: unknown }>,
	inArrayCalls: [] as Array<{
		columnName: string;
		tableName: string | undefined;
		values: unknown[];
	}>,
	getEmployeeSettingsActorContext: vi.fn(),
	getManagedEmployeeIdsForSettingsActor: vi.fn(),
}));

// Inside vi.mock("drizzle-orm", ...), next to eq:
inArray: vi.fn(
	(left: Parameters<typeof actual.inArray>[0], values: unknown[]) => {
		const column = left as { name?: string; table?: { [key: symbol]: string } };
		mocks.inArrayCalls.push({
			columnName: column.name ?? "",
			tableName: column.table?.[Symbol.for("drizzle:Name")],
			values,
		});
		return actual.inArray(left, values);
	},
),
```

Extend `createDbService` with optional activity rows. Invoke the activity query callback so SQL predicates are recorded, while returning controlled rows:

```ts
type ActivityRow = {
	employeeId: string;
	timestamp: Date;
	utcOffsetMinutes: number;
};

function createDbService({
	activeRows,
	organizationEmployeeRows,
	activityRows = [],
}: {
	activeRows: Array<{ employeeId: string }>;
	organizationEmployeeRows: Array<{ id: string }>;
	activityRows?: ActivityRow[];
}) {
	const orderedRows = Promise.resolve([]);
	const whereResult = Object.assign(orderedRows, {
		orderBy: vi.fn(() => Promise.resolve([])),
	});

	return {
		query: vi.fn((name: string, fn: () => unknown) => {
			if (name === "getEmployeeClockStatuses:organizationEmployees") {
				void fn();
				return Promise.resolve(organizationEmployeeRows);
			}
			if (name === "getEmployeeClockStatuses:activeWorkPeriods") {
				return Promise.resolve(activeRows);
			}
			if (name === "getEmployeeClockStatuses:latestActivities") {
				void fn();
				return Promise.resolve(activityRows);
			}
			return fn();
		}),
		db: {
			select: vi.fn(() => ({
				from: vi.fn(() => ({ where: vi.fn(() => whereResult) })),
			})),
		},
	};
}
```

Clear `inArrayCalls` in `beforeEach`. Update existing successful expectations from status strings to snapshots with null activity, then add this test:

```ts
it("returns the newest non-superseded clock activity for each accessible employee", async () => {
	const dbService = createDbService({
		activeRows: [{ employeeId: "emp-1" }],
		organizationEmployeeRows: [{ id: "emp-1" }, { id: "emp-2" }],
		activityRows: [
			{
				employeeId: "emp-1",
				timestamp: new Date("2026-07-28T10:40:00.000Z"),
				utcOffsetMinutes: 120,
			},
			{
				employeeId: "emp-1",
				timestamp: new Date("2026-07-28T08:00:00.000Z"),
				utcOffsetMinutes: 120,
			},
			{
				employeeId: "emp-2",
				timestamp: new Date("2026-07-27T16:05:00.000Z"),
				utcOffsetMinutes: -240,
			},
		],
	});
	mocks.getEmployeeSettingsActorContext.mockReturnValue(
		Effect.succeed({
			dbService,
			organizationId: "org-1",
			accessTier: "orgAdmin",
			currentEmployee: { id: "admin-1", role: "admin" },
			session: { user: { id: "user-1" } },
		}),
	);
	mocks.getManagedEmployeeIdsForSettingsActor.mockReturnValue(Effect.succeed(null));

	const result = await getEmployeeClockStatuses(["emp-1", "emp-2"]);

	expect(result.success).toBe(true);
	if (!result.success) return;
	expect(result.data).toEqual({
		"emp-1": {
			status: "clocked-in",
			lastActivityAt: "2026-07-28T10:40:00.000Z",
			lastActivityUtcOffsetMinutes: 120,
		},
		"emp-2": {
			status: "clocked-out",
			lastActivityAt: "2026-07-27T16:05:00.000Z",
			lastActivityUtcOffsetMinutes: -240,
		},
	});
	expect(mocks.eqCalls).toContainEqual({
		columnName: "organization_id",
		tableName: "time_entry",
		value: "org-1",
	});
	expect(mocks.eqCalls).toContainEqual({
		columnName: "is_superseded",
		tableName: "time_entry",
		value: false,
	});
	expect(mocks.inArrayCalls).toContainEqual({
		columnName: "type",
		tableName: "time_entry",
		values: ["clock_in", "clock_out"],
	});
});
```

In the existing manager-filtering test, provide an `activityRows` entry for `emp-2` even though only `emp-1` is managed, assert the response contains only `emp-1`, and assert the activity query receives only the accessible ID:

```ts
expect(mocks.inArrayCalls).toContainEqual({
	columnName: "employee_id",
	tableName: "time_entry",
	values: ["emp-1"],
});
expect(result.data).toEqual({
	"emp-1": {
		status: "clocked-in",
		lastActivityAt: null,
		lastActivityUtcOffsetMinutes: null,
	},
});
```

- [ ] **Step 2: Update the hook tests to describe the enriched contract**

Replace status-only fixture data with snapshots and assert both compatibility accessors:

```ts
mocks.getEmployeeClockStatuses.mockResolvedValue({
	success: true,
	data: {
		"emp-1": {
			status: "clocked-in",
			lastActivityAt: "2026-07-28T10:40:00.000Z",
			lastActivityUtcOffsetMinutes: 120,
		},
		"emp-2": {
			status: "clocked-out",
			lastActivityAt: null,
			lastActivityUtcOffsetMinutes: null,
		},
	},
});

expect(result.current.getStatus("emp-1")).toBe("unknown");
expect(result.current.getActivity("emp-1")).toBeNull();

await waitFor(() => expect(result.current.getStatus("emp-1")).toBe("clocked-in"));
expect(result.current.statuses).toEqual({
	"emp-1": "clocked-in",
	"emp-2": "clocked-out",
});
expect(result.current.getActivity("emp-1")).toEqual({
	lastActivityAt: "2026-07-28T10:40:00.000Z",
	lastActivityUtcOffsetMinutes: 120,
});
expect(result.current.getActivity("emp-2")).toBeNull();
expect(result.current.getActivity("inaccessible-employee")).toBeNull();
```

In the server-failure test, add `expect(result.current.getActivity("emp-1")).toBeNull()`.

- [ ] **Step 3: Run the focused tests to verify they fail**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run \
  'src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.test.ts' \
  src/lib/query/use-employee-clock-statuses.test.tsx
```

Expected: FAIL because the action still returns status strings and the hook has no `getActivity` accessor.

- [ ] **Step 4: Implement the enriched server response**

In `employee-clock-status.actions.ts`, import `desc` and `timeEntry`, then define:

```ts
export interface EmployeeClockActivity {
	lastActivityAt: string;
	lastActivityUtcOffsetMinutes: number;
}

export interface EmployeeClockPresence {
	status: EmployeeClockStatus;
	lastActivityAt: string | null;
	lastActivityUtcOffsetMinutes: number | null;
}

export type EmployeeClockPresenceMap = Record<string, EmployeeClockPresence>;
export type EmployeeClockStatusMap = Record<string, EmployeeClockStatus>;
```

Change the action result type and empty returns to `EmployeeClockPresenceMap`. After resolving `activeRows`, query only authorized IDs:

```ts
const activityRows = yield* _(
	resolveQueryEffect(
		"getEmployeeClockStatuses:latestActivities",
		actor.dbService.query("getEmployeeClockStatuses:latestActivities", async () => {
			return await actor.dbService.db
				.select({
					employeeId: timeEntry.employeeId,
					timestamp: timeEntry.timestamp,
					utcOffsetMinutes: timeEntry.utcOffsetMinutes,
				})
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, actor.organizationId),
						inArray(timeEntry.employeeId, accessibleEmployeeIds),
						inArray(timeEntry.type, ["clock_in", "clock_out"]),
						eq(timeEntry.isSuperseded, false),
					),
				)
				.orderBy(desc(timeEntry.timestamp), desc(timeEntry.id));
		}),
	),
);

const accessibleEmployeeIdSet = new Set(accessibleEmployeeIds);
const latestActivityByEmployee = new Map<string, EmployeeClockActivity>();
for (const row of activityRows) {
	if (
		accessibleEmployeeIdSet.has(row.employeeId) &&
		!latestActivityByEmployee.has(row.employeeId)
	) {
		latestActivityByEmployee.set(row.employeeId, {
			lastActivityAt: row.timestamp.toISOString(),
			lastActivityUtcOffsetMinutes: row.utcOffsetMinutes,
		});
	}
}
```

Replace the final map assembly with:

```ts
return Object.fromEntries(
	accessibleEmployeeIds.map((employeeId) => {
		const activity = latestActivityByEmployee.get(employeeId);
		return [
			employeeId,
			{
				status: clockedInEmployeeIds.has(employeeId) ? "clocked-in" : "clocked-out",
				lastActivityAt: activity?.lastActivityAt ?? null,
				lastActivityUtcOffsetMinutes:
					activity?.lastActivityUtcOffsetMinutes ?? null,
			},
		];
	}),
) satisfies EmployeeClockPresenceMap;
```

- [ ] **Step 5: Preserve the hook API and add activity access**

In `use-employee-clock-statuses.ts`, import the new types and replace `EMPTY_STATUSES` with:

```ts
const EMPTY_PRESENCE: EmployeeClockPresenceMap = {};
```

Type the query as `EmployeeClockPresenceMap`, then derive status-only compatibility data and activity access:

```ts
const snapshots = query.data ?? EMPTY_PRESENCE;
const statuses: EmployeeClockStatusMap = Object.fromEntries(
	Object.entries(snapshots).map(([employeeId, snapshot]) => [
		employeeId,
		snapshot.status,
	]),
);

const getStatus = (employeeId: string): EmployeeClockStatus =>
	snapshots[employeeId.trim()]?.status ?? "unknown";

const getActivity = (employeeId: string): EmployeeClockActivity | null => {
	const snapshot = snapshots[employeeId.trim()];
	if (
		!snapshot ||
		snapshot.lastActivityAt === null ||
		snapshot.lastActivityUtcOffsetMinutes === null
	) {
		return null;
	}

	return {
		lastActivityAt: snapshot.lastActivityAt,
		lastActivityUtcOffsetMinutes: snapshot.lastActivityUtcOffsetMinutes,
	};
};

return {
	...query,
	employeeIds: normalizedEmployeeIds,
	snapshots,
	statuses,
	getStatus,
	getActivity,
};
```

Keep failed action results mapped to `EMPTY_PRESENCE`. In `src/lib/query/index.ts`, export `EmployeeClockActivity`, `EmployeeClockPresence`, `EmployeeClockPresenceMap`, and `EmployeeClockStatusMap` from the action module.

- [ ] **Step 6: Run the focused tests and commit**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run \
  'src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.test.ts' \
  src/lib/query/use-employee-clock-statuses.test.tsx
```

Expected: PASS for both test files.

Commit:

```bash
git add -- \
  'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.ts' \
  apps/webapp/src/lib/query/use-employee-clock-statuses.test.tsx \
  apps/webapp/src/lib/query/use-employee-clock-statuses.ts \
  apps/webapp/src/lib/query/index.ts
git commit -m "feat: expose latest employee clock activity"
```

### Task 2: Add The Temporal Activity Formatter And Localized Component

**Files:**
- Create: `apps/webapp/src/components/employee-activity-text.tsx`
- Create: `apps/webapp/src/components/employee-activity-text.test.tsx`
- Modify: `apps/webapp/messages/common/de.json`
- Modify: `apps/webapp/messages/common/el.json`
- Modify: `apps/webapp/messages/common/en.json`
- Modify: `apps/webapp/messages/common/es.json`
- Modify: `apps/webapp/messages/common/fr.json`
- Modify: `apps/webapp/messages/common/gsw.json`
- Modify: `apps/webapp/messages/common/it.json`
- Modify: `apps/webapp/messages/common/pl.json`
- Modify: `apps/webapp/messages/common/pt.json`
- Modify: `apps/webapp/messages/common/tr.json`

- [ ] **Step 1: Write failing pure formatter and component tests**

Create `employee-activity-text.test.tsx` with a fixed clock and explicit templates:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

import {
	EmployeeActivityText,
	formatEmployeeActivity,
	type EmployeeActivityTemplates,
} from "./employee-activity-text";

const templates: EmployeeActivityTemplates = {
	relativeMinutes: (minutes) => `since ${minutes}min`,
	relativeHours: (hours) => `since ${hours}h`,
	relativeHoursMinutes: (hours, minutes) => `since ${hours}h ${minutes}min`,
	lastActivity: (date) => `last activity ${date}`,
};
const now = parseInstant("2026-07-28T12:00:00Z");

function format(lastActivityAt: string, offset = 0) {
	return formatEmployeeActivity({
		lastActivityAt,
		lastActivityUtcOffsetMinutes: offset,
		templates,
		now,
	});
}

describe("formatEmployeeActivity", () => {
	it.each([
		["2026-07-28T11:59:40Z", "since 0min"],
		["2026-07-28T11:19:20Z", "since 40min"],
		["2026-07-28T10:00:00Z", "since 2h"],
		["2026-07-28T09:45:00Z", "since 2h 15min"],
		["2026-07-28T04:00:00Z", "since 8h"],
	])("formats %s as %s", (lastActivityAt, expected) => {
		expect(format(lastActivityAt)).toBe(expected);
	});

	it("keeps an under-three-hour event relative across midnight", () => {
		expect(
			formatEmployeeActivity({
				lastActivityAt: "2026-07-27T23:30:00Z",
				lastActivityUtcOffsetMinutes: 0,
				templates,
				now: parseInstant("2026-07-28T01:00:00Z"),
			}),
		).toBe("since 1h 30min");
	});

	it("uses the captured offset for an older event date", () => {
		expect(format("2026-07-27T20:30:00Z", 120)).toBe("last activity 27.07.");
	});

	it.each([
		[null, 0],
		["2026-07-28T11:00:00Z", null],
		["not-an-instant", 0],
		["2026-07-28T12:01:00Z", 0],
		["2026-07-28T11:00:00Z", 1440],
	] as const)("omits invalid activity %s at offset %s", (lastActivityAt, offset) => {
		expect(
			formatEmployeeActivity({
				lastActivityAt,
				lastActivityUtcOffsetMinutes: offset,
				templates,
				now,
			}),
		).toBeNull();
	});
});

describe("EmployeeActivityText", () => {
	it("renders localized muted activity text", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
		render(
			<EmployeeActivityText
				lastActivityAt="2026-07-28T11:20:00Z"
				lastActivityUtcOffsetMinutes={0}
			/>,
		);
		expect(screen.getByText("since 40min").className).toContain("text-muted-foreground");
		vi.useRealTimers();
	});
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run src/components/employee-activity-text.test.tsx
```

Expected: FAIL because `employee-activity-text.tsx` does not exist.

- [ ] **Step 3: Implement the formatter and component**

Create `employee-activity-text.tsx`:

```tsx
"use client";

import { useTranslate } from "@tolgee/react";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	compareInstants,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";

export interface EmployeeActivityTemplates {
	relativeMinutes(minutes: number): string;
	relativeHours(hours: number): string;
	relativeHoursMinutes(hours: number, minutes: number): string;
	lastActivity(date: string): string;
}

interface FormatEmployeeActivityInput {
	lastActivityAt: string | null;
	lastActivityUtcOffsetMinutes: number | null;
	templates: EmployeeActivityTemplates;
	now?: Instant;
}

export function formatEmployeeActivity({
	lastActivityAt,
	lastActivityUtcOffsetMinutes,
	templates,
	now,
}: FormatEmployeeActivityInput): string | null {
	if (lastActivityAt === null || lastActivityUtcOffsetMinutes === null) return null;

	try {
		const activity = parseInstant(lastActivityAt);
		const current = now ?? systemClock.nowInstant();
		if (compareInstants(activity, current) > 0) return null;

		const elapsedMinutes = Math.floor(activity.until(current).total({ unit: "minutes" }));
		const zone = offsetMinutesToTimeZoneId(lastActivityUtcOffsetMinutes);
		const activityDate = activity.toZonedDateTimeISO(zone).toPlainDate();
		const currentDate = current.toZonedDateTimeISO(zone).toPlainDate();

		if (elapsedMinutes < 180 || activityDate.equals(currentDate)) {
			const hours = Math.floor(elapsedMinutes / 60);
			const minutes = elapsedMinutes % 60;
			if (hours === 0) return templates.relativeMinutes(minutes);
			if (minutes === 0) return templates.relativeHours(hours);
			return templates.relativeHoursMinutes(hours, minutes);
		}

		const date = `${String(activityDate.day).padStart(2, "0")}.${String(
			activityDate.month,
		).padStart(2, "0")}.`;
		return templates.lastActivity(date);
	} catch {
		return null;
	}
}

interface EmployeeActivityTextProps {
	lastActivityAt: string | null;
	lastActivityUtcOffsetMinutes: number | null;
}

export function EmployeeActivityText({
	lastActivityAt,
	lastActivityUtcOffsetMinutes,
}: EmployeeActivityTextProps) {
	const { t } = useTranslate();
	const text = formatEmployeeActivity({
		lastActivityAt,
		lastActivityUtcOffsetMinutes,
		templates: {
			relativeMinutes: (minutes) =>
				t("common:presence.activity.relativeMinutes", "since {minutes}min", { minutes }),
			relativeHours: (hours) =>
				t("common:presence.activity.relativeHours", "since {hours}h", { hours }),
			relativeHoursMinutes: (hours, minutes) =>
				t(
					"common:presence.activity.relativeHoursMinutes",
					"since {hours}h {minutes}min",
					{ hours, minutes },
				),
			lastActivity: (date) =>
				t("common:presence.activity.lastActivity", "last activity {date}", { date }),
		},
	});

	return text ? <p className="text-xs text-muted-foreground">{text}</p> : null;
}
```

- [ ] **Step 4: Add all localized templates**

Add an `activity` object before `clockedIn` in each locale's existing `presence` object. Use these exact values:

```json
// en
"activity": { "lastActivity": "last activity {date}", "relativeHours": "since {hours}h", "relativeHoursMinutes": "since {hours}h {minutes}min", "relativeMinutes": "since {minutes}min" }

// de
"activity": { "lastActivity": "letzte Aktivität {date}", "relativeHours": "seit {hours}h", "relativeHoursMinutes": "seit {hours}h {minutes}min", "relativeMinutes": "seit {minutes}min" }

// fr
"activity": { "lastActivity": "dernière activité {date}", "relativeHours": "depuis {hours}h", "relativeHoursMinutes": "depuis {hours}h {minutes}min", "relativeMinutes": "depuis {minutes}min" }

// es
"activity": { "lastActivity": "última actividad {date}", "relativeHours": "hace {hours}h", "relativeHoursMinutes": "hace {hours}h {minutes}min", "relativeMinutes": "hace {minutes}min" }

// it
"activity": { "lastActivity": "ultima attività {date}", "relativeHours": "da {hours}h", "relativeHoursMinutes": "da {hours}h {minutes}min", "relativeMinutes": "da {minutes}min" }

// pt
"activity": { "lastActivity": "última atividade {date}", "relativeHours": "há {hours}h", "relativeHoursMinutes": "há {hours}h {minutes}min", "relativeMinutes": "há {minutes}min" }

// pl
"activity": { "lastActivity": "ostatnia aktywność {date}", "relativeHours": "od {hours}h", "relativeHoursMinutes": "od {hours}h {minutes}min", "relativeMinutes": "od {minutes}min" }

// tr
"activity": { "lastActivity": "son etkinlik {date}", "relativeHours": "{hours} sa önce", "relativeHoursMinutes": "{hours} sa {minutes} dk önce", "relativeMinutes": "{minutes} dk önce" }

// el
"activity": { "lastActivity": "τελευταία δραστηριότητα {date}", "relativeHours": "πριν από {hours}ω", "relativeHoursMinutes": "πριν από {hours}ω {minutes}λεπ", "relativeMinutes": "πριν από {minutes}λεπ" }

// gsw
"activity": { "lastActivity": "letschti Aktivität {date}", "relativeHours": "sit {hours}h", "relativeHoursMinutes": "sit {hours}h {minutes}min", "relativeMinutes": "sit {minutes}min" }
```

Remove the `// locale` labels when placing the objects into JSON; they are headings for this plan, not JSON syntax.

- [ ] **Step 5: Run tests, validate locale JSON, and commit**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run \
  src/components/employee-activity-text.test.tsx \
  src/tolgee/shared.test.ts
```

Expected: PASS, including loading every supported locale file as valid JSON.

Commit:

```bash
git add -- \
  apps/webapp/src/components/employee-activity-text.tsx \
  apps/webapp/src/components/employee-activity-text.test.tsx \
  apps/webapp/messages/common/de.json \
  apps/webapp/messages/common/el.json \
  apps/webapp/messages/common/en.json \
  apps/webapp/messages/common/es.json \
  apps/webapp/messages/common/fr.json \
  apps/webapp/messages/common/gsw.json \
  apps/webapp/messages/common/it.json \
  apps/webapp/messages/common/pl.json \
  apps/webapp/messages/common/pt.json \
  apps/webapp/messages/common/tr.json
git commit -m "feat: format employee clock activity"
```

### Task 3: Show Activity In The Dashboard Widget

**Files:**
- Modify: `apps/webapp/src/components/dashboard/managed-employees-widget.test.tsx`
- Modify: `apps/webapp/src/components/dashboard/managed-employees-widget.tsx`

- [ ] **Step 1: Write a failing dashboard integration test**

Use a hoisted activity mock and a deterministic component stub:

```tsx
const { getActivityMock, getCurrentEmployeeMock, getManagedEmployeesMock } = vi.hoisted(() => ({
	getActivityMock: vi.fn(),
	getCurrentEmployeeMock: vi.fn(),
	getManagedEmployeesMock: vi.fn(),
}));

vi.mock("@/components/employee-activity-text", () => ({
	EmployeeActivityText: ({
		lastActivityAt,
		lastActivityUtcOffsetMinutes,
	}: {
		lastActivityAt: string | null;
		lastActivityUtcOffsetMinutes: number | null;
	}) => <span>{`${lastActivityAt}|${lastActivityUtcOffsetMinutes}`}</span>,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({
		getStatus: () => "clocked-in",
		getActivity: getActivityMock,
	}),
}));
```

Add this test, using the same employee fixture as the existing hover-style test:

```ts
it("renders the employee's latest clock activity", async () => {
	getActivityMock.mockReturnValue({
		lastActivityAt: "2026-07-28T10:40:00.000Z",
		lastActivityUtcOffsetMinutes: 120,
	});
	getCurrentEmployeeMock.mockResolvedValue({ id: "manager-1", role: "manager" });
	getManagedEmployeesMock.mockResolvedValue({
		success: true,
		data: [
			{
				id: "employee-1",
				position: "Designer",
				user: {
					id: "user-1",
					name: "Ada Lovelace",
					email: "ada@example.com",
					image: null,
				},
				team: { name: "Ops" },
			},
		],
	});

	renderManagedEmployeesWidget();

	expect(await screen.findByText("2026-07-28T10:40:00.000Z|120")).toBeTruthy();
	expect(getActivityMock).toHaveBeenCalledWith("employee-1");
});
```

- [ ] **Step 2: Run the dashboard test to verify it fails**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run src/components/dashboard/managed-employees-widget.test.tsx
```

Expected: FAIL because the widget does not call `getActivity` or render `EmployeeActivityText`.

- [ ] **Step 3: Wire activity into each dashboard employee card**

Import `EmployeeActivityText` and add nullable activity fields to `ManagedEmployee`:

```ts
lastActivityAt?: string | null;
lastActivityUtcOffsetMinutes?: number | null;
```

Resolve activity once per employee:

```ts
const employeesWithPresence = employees.map((employee) => {
	const activity = presence.getActivity(employee.id);
	return {
		...employee,
		clockStatus: presence.getStatus(employee.id),
		lastActivityAt: activity?.lastActivityAt ?? null,
		lastActivityUtcOffsetMinutes:
			activity?.lastActivityUtcOffsetMinutes ?? null,
	};
});
```

Render it below the existing position/email line inside the details column:

```tsx
<EmployeeActivityText
	lastActivityAt={employee.lastActivityAt ?? null}
	lastActivityUtcOffsetMinutes={employee.lastActivityUtcOffsetMinutes ?? null}
/>
```

- [ ] **Step 4: Run the dashboard and shared component tests, then commit**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run \
  src/components/employee-activity-text.test.tsx \
  src/components/dashboard/managed-employees-widget.test.tsx
```

Expected: PASS.

Commit:

```bash
git add -- \
  apps/webapp/src/components/dashboard/managed-employees-widget.test.tsx \
  apps/webapp/src/components/dashboard/managed-employees-widget.tsx
git commit -m "feat: show clock activity on dashboard"
```

### Task 4: Show Activity In Team Cards And Table Rows

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx`

- [ ] **Step 1: Write a failing team-layout integration test**

Add a hoisted `getActivityMock`, return it from the presence-hook mock, and stub the shared component with the complete code below. Ensure the Tolgee test mock accepts `string | number` parameters:

```tsx
const { getActivityMock } = vi.hoisted(() => ({ getActivityMock: vi.fn() }));

vi.mock("@/components/employee-activity-text", () => ({
	EmployeeActivityText: ({
		lastActivityAt,
		lastActivityUtcOffsetMinutes,
	}: {
		lastActivityAt: string | null;
		lastActivityUtcOffsetMinutes: number | null;
	}) => <span>{`${lastActivityAt}|${lastActivityUtcOffsetMinutes}`}</span>,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({
		getStatus: () => "clocked-out",
		getActivity: getActivityMock,
	}),
}));
```

Add one test that covers both mutually exclusive layouts:

```ts
it("renders latest clock activity in card and table views", () => {
	getActivityMock.mockReturnValue({
		lastActivityAt: "2026-07-28T10:40:00.000Z",
		lastActivityUtcOffsetMinutes: 120,
	});
	render(<TeamMembersList employees={[employee({})]} />);

	expect(screen.getByText("2026-07-28T10:40:00.000Z|120")).toBeTruthy();

	fireEvent.click(screen.getByRole("radio", { name: "Table view" }));

	expect(screen.getByText("2026-07-28T10:40:00.000Z|120")).toBeTruthy();
	expect(getActivityMock).toHaveBeenCalledWith("employee-1");
});
```

- [ ] **Step 2: Run the team test to verify it fails**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run \
  'src/app/[locale]/(app)/team/team-members-list.test.tsx'
```

Expected: FAIL because neither team layout renders the shared activity component.

- [ ] **Step 3: Wire activity into the team presentation model**

Import `EmployeeActivityText` and extend `ManagedEmployeeWithPresence`:

```ts
type ManagedEmployeeWithPresence = ManagedEmployee & {
	clockStatus?: EmployeeClockStatus;
	lastActivityAt: string | null;
	lastActivityUtcOffsetMinutes: number | null;
};
```

Resolve activity while enriching the employee list:

```ts
const employeesWithPresence = employees.map((employee) => {
	const activity = presence.getActivity(employee.id);
	return {
		...employee,
		clockStatus: presence.getStatus(employee.id),
		lastActivityAt: activity?.lastActivityAt ?? null,
		lastActivityUtcOffsetMinutes:
			activity?.lastActivityUtcOffsetMinutes ?? null,
	};
});
```

- [ ] **Step 4: Render the shared component in cards and table rows**

In `TeamMemberCards`, place this below email and optional position:

```tsx
<EmployeeActivityText
	lastActivityAt={employee.lastActivityAt}
	lastActivityUtcOffsetMinutes={employee.lastActivityUtcOffsetMinutes}
/>
```

In the table's employee identity cell, place this below email:

```tsx
<EmployeeActivityText
	lastActivityAt={row.original.lastActivityAt}
	lastActivityUtcOffsetMinutes={row.original.lastActivityUtcOffsetMinutes}
/>
```

- [ ] **Step 5: Run the team and shared component tests, then commit**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run \
  src/components/employee-activity-text.test.tsx \
  'src/app/[locale]/(app)/team/team-members-list.test.tsx'
```

Expected: PASS.

Commit:

```bash
git add -- \
  'apps/webapp/src/app/[locale]/(app)/team/team-members-list.test.tsx' \
  'apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx'
git commit -m "feat: show clock activity on team page"
```

### Task 5: Verify The Complete Feature

**Files:**
- Verify only; do not modify unrelated files.

- [ ] **Step 1: Run the complete focused regression suite**

Run:

```bash
TZ=UTC pnpm --dir apps/webapp exec vitest run \
  'src/app/[locale]/(app)/settings/employees/employee-clock-status.actions.test.ts' \
  src/lib/query/use-employee-clock-statuses.test.tsx \
  src/components/employee-activity-text.test.tsx \
  src/components/dashboard/managed-employees-widget.test.tsx \
  'src/app/[locale]/(app)/team/team-members-list.test.tsx' \
  src/components/user-avatar.test.tsx \
  src/tolgee/shared.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run the webapp typecheck**

Run:

```bash
pnpm --dir apps/webapp typecheck
```

Expected: `next typegen` and TypeScript complete with exit code 0. If errors originate from pre-existing concurrent changes, record the exact diagnostics and verify none reference files changed by this plan.

- [ ] **Step 3: Inspect the final diff and repository state**

Run:

```bash
git status --short
git diff --check
git log --oneline -6
```

Expected: no whitespace errors; only intended uncommitted changes, if any, are reported. Do not alter or stage unrelated concurrent work.
