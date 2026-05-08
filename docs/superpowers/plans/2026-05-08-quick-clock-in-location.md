# Quick Clock-In Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a work location selector to the global quick clock-in popover and replace the old `field` work location value with `remote` globally.

**Architecture:** Reuse the existing `WorkLocationSelector` and the existing `clockIn({ workLocationType })` mutation path. Centralize the location literals in a small shared module, update schema/API/offline paths, and migrate persisted `field` rows to `remote`.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM/PostgreSQL, Vitest, Testing Library, Tolgee JSON messages, service worker offline queue.

---

## File Map

- Create: `apps/webapp/src/lib/time-tracking/work-location.ts` for shared location values, type, and stale-value normalization.
- Create: `apps/webapp/drizzle/0013_work_location_remote.sql` for the enum replacement and data migration.
- Create: `apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx` for quick clock-in selector behavior.
- Modify: `apps/webapp/src/db/schema/enums.ts` and `apps/webapp/src/db/schema/time-tracking.ts` for schema literals/comments.
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx`, `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`, and `apps/webapp/src/components/time-tracking/time-clock-popover.tsx` for UI behavior.
- Modify: `apps/webapp/src/lib/query/use-time-clock.ts`, `apps/webapp/src/lib/offline/types.ts`, `apps/webapp/public/sw.js`, `apps/webapp/public/lib/offline-queue-db.js`, and `apps/webapp/public/lib/sync-service.js` for offline support.
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`, `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`, and `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.canonical.ts` for server-side types and persistence.
- Modify: `apps/webapp/src/app/api/mobile/time-clock/route.ts` and `apps/webapp/src/app/api/mobile/time-clock/route.test.ts` for mobile API validation.
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/queries.ts`, `apps/webapp/src/lib/compliance/rules/presence-requirement-rule.ts`, and `apps/webapp/src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts` for onsite semantics.
- Modify: `apps/webapp/src/lib/time-record/migration/backfill.ts`, `apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts`, `apps/webapp/messages/timeTracking/en.json`, and `apps/webapp/messages/timeTracking/de.json` for type/test/message consistency.

---

### Task 1: Shared Type And Database Migration

**Files:**
- Create: `apps/webapp/src/lib/time-tracking/work-location.ts`
- Create: `apps/webapp/drizzle/0013_work_location_remote.sql`
- Modify: `apps/webapp/src/db/schema/enums.ts:236-241`
- Modify: `apps/webapp/src/db/schema/time-tracking.ts:102-103`

- [ ] **Step 1: Create the shared work location module**

Create `apps/webapp/src/lib/time-tracking/work-location.ts`:

```ts
export const WORK_LOCATION_TYPES = ["office", "home", "remote", "other"] as const;

export type WorkLocationType = (typeof WORK_LOCATION_TYPES)[number];

const WORK_LOCATION_TYPE_SET = new Set<string>(WORK_LOCATION_TYPES);

export function normalizeWorkLocationType(value: string | null | undefined): WorkLocationType {
	if (value === "field") {
		return "remote";
	}

	if (value && WORK_LOCATION_TYPE_SET.has(value)) {
		return value as WorkLocationType;
	}

	return "office";
}
```

- [ ] **Step 2: Update the Drizzle enum**

Replace the existing enum in `apps/webapp/src/db/schema/enums.ts` with:

```ts
export const workLocationTypeEnum = pgEnum("work_location_type", [
	"office",
	"home",
	"remote",
	"other",
]);
```

- [ ] **Step 3: Update the schema comment**

Replace the location comment in `apps/webapp/src/db/schema/time-tracking.ts` with:

```ts
		// Work location type - employee tags at clock-in (office, home, remote, other)
		workLocationType: workLocationTypeEnum("work_location_type"),
```

- [ ] **Step 4: Add the SQL migration**

Create `apps/webapp/drizzle/0013_work_location_remote.sql`:

```sql
CREATE TYPE "public"."work_location_type_new" AS ENUM('office', 'home', 'remote', 'other');
--> statement-breakpoint
ALTER TABLE "work_period"
	ALTER COLUMN "work_location_type" TYPE "public"."work_location_type_new"
	USING CASE
		WHEN "work_location_type"::text = 'field' THEN 'remote'::"public"."work_location_type_new"
		WHEN "work_location_type" IS NULL THEN NULL
		ELSE "work_location_type"::text::"public"."work_location_type_new"
	END;
--> statement-breakpoint
ALTER TABLE "time_record_work"
	ALTER COLUMN "work_location_type" TYPE "public"."work_location_type_new"
	USING CASE
		WHEN "work_location_type"::text = 'field' THEN 'remote'::"public"."work_location_type_new"
		WHEN "work_location_type" IS NULL THEN NULL
		ELSE "work_location_type"::text::"public"."work_location_type_new"
	END;
--> statement-breakpoint
DROP TYPE "public"."work_location_type";
--> statement-breakpoint
ALTER TYPE "public"."work_location_type_new" RENAME TO "work_location_type";
```

- [ ] **Step 5: Verify the expected type errors are exposed**

Run: `pnpm --filter webapp exec tsc --noEmit --pretty false`

Expected: FAIL with TypeScript errors at remaining locations that still reference `field` as a valid `workLocationType`.

- [ ] **Step 6: Commit Task 1**

Run: `git add apps/webapp/src/lib/time-tracking/work-location.ts apps/webapp/src/db/schema/enums.ts apps/webapp/src/db/schema/time-tracking.ts apps/webapp/drizzle/0013_work_location_remote.sql && git commit -m "feat: add remote work location enum"`

Expected: commit succeeds.

---

### Task 2: Server, Mobile API, And Offline Data Paths

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.canonical.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`
- Modify: `apps/webapp/src/app/api/mobile/time-clock/route.ts`
- Modify: `apps/webapp/src/app/api/mobile/time-clock/route.test.ts`
- Modify: `apps/webapp/src/lib/query/use-time-clock.ts`
- Modify: `apps/webapp/src/lib/offline/types.ts`
- Modify: `apps/webapp/public/sw.js`
- Modify: `apps/webapp/public/lib/offline-queue-db.js`
- Modify: `apps/webapp/public/lib/sync-service.js`

- [ ] **Step 1: Write failing server clock-in persistence test**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`, extend the hoisted mock state with `insertValues` and `insert`:

```ts
insertValues: vi.fn(),
insert: vi.fn(),
```

Update the `@/db` mock:

```ts
vi.mock("@/db", () => ({
	db: {
		insert: mockState.insert,
		update: vi.fn(() => ({
			set: mockState.updateSet,
		})),
	},
}));
```

Import both functions:

```ts
const { clockIn, clockOut } = await import("./clocking");
```

Add this setup line in `beforeEach`:

```ts
mockState.insert.mockReturnValue({ values: mockState.insertValues });
mockState.insertValues.mockResolvedValue(undefined);
mockState.getActiveWorkPeriod.mockResolvedValue(null);
mockState.createTimeEntry.mockResolvedValue({
	id: "clock-in-1",
	type: "clock_in",
	timestamp: new Date("2026-05-04T10:00:00.000Z"),
});
```

Add this test before the `clockOut` describe block or in a new `describe("clockIn")` block:

```ts
describe("clockIn", () => {
	it("stores the selected remote work location", async () => {
		const result = await clockIn("remote");

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				workLocationType: "remote",
			}),
		);
	});
});
```

- [ ] **Step 2: Run the failing server test**

Run: `pnpm --filter webapp test -- src/app/[locale]/\(app\)/time-tracking/actions/clocking.test.ts`

Expected: FAIL because `clockIn` still accepts the old union and may not compile with the new shared type.

- [ ] **Step 3: Update server-side work location types**

In `actions.ts`, `actions/clocking.ts`, and `actions.canonical.ts`, import the shared type:

```ts
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
```

Replace each `"office" | "home" | "field" | "other"` work-location union with `WorkLocationType`. For nullable canonical input use:

```ts
workLocationType?: WorkLocationType | null;
```

- [ ] **Step 4: Update mobile API validation and tests**

In `apps/webapp/src/app/api/mobile/time-clock/route.ts`, import shared values:

```ts
import { WORK_LOCATION_TYPES } from "@/lib/time-tracking/work-location";
```

Replace the zod enum with:

```ts
workLocationType: z.enum(WORK_LOCATION_TYPES, {
	error: "workLocationType is required for clock_in",
}),
```

In `route.test.ts`, add:

```ts
it("passes remote work location to clockIn", async () => {
	mockState.clockIn.mockResolvedValue({ success: true, data: { id: "entry-1" } });

	const response = await POST(
		new Request("https://app.example.com/api/mobile/time-clock", {
			method: "POST",
			body: JSON.stringify({ action: "clock_in", workLocationType: "remote" }),
			headers: { "content-type": "application/json" },
		}),
	);

	expect(response.status).toBe(200);
	expect(mockState.clockIn).toHaveBeenCalledWith("remote");
});

it("rejects obsolete field work location", async () => {
	const response = await POST(
		new Request("https://app.example.com/api/mobile/time-clock", {
			method: "POST",
			body: JSON.stringify({ action: "clock_in", workLocationType: "field" }),
			headers: { "content-type": "application/json" },
		}),
	);

	expect(response.status).toBe(400);
	expect(mockState.clockIn).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Carry workLocationType through offline queue code**

In `apps/webapp/src/lib/offline/types.ts`, import `WorkLocationType` and add the optional field:

```ts
import type { WorkLocationType } from "@/lib/time-tracking/work-location";

workLocationType?: WorkLocationType;
```

Place `workLocationType?: WorkLocationType;` on `QueuedClockEvent` near `organizationId`.

In `apps/webapp/src/lib/query/use-time-clock.ts`, import `WorkLocationType`, replace the inline clock-in param unions, and add the selected value to the queued event:

```ts
const result = await queueClockEvent({
	type: "clock_in",
	timestamp: Date.now(),
	organizationId: "pending",
	workLocationType: params?.workLocationType,
});
```

In `apps/webapp/public/sw.js`, add `workLocationType` in both queue paths:

```js
workLocationType: body.workLocationType,
```

and for the message payload path no extra code is needed because `handleQueueClockEvent` passes the payload through.

In `apps/webapp/public/lib/offline-queue-db.js`, add the JSDoc line:

```js
 * @param {string} [event.workLocationType] - Optional work location type for clock-in
```

and persist it in `queuedEvent`:

```js
workLocationType: event.workLocationType,
```

In `apps/webapp/public/lib/sync-service.js`, add the body field:

```js
if (event.workLocationType) body.workLocationType = event.workLocationType;
```

- [ ] **Step 6: Run focused API/server tests**

Run: `pnpm --filter webapp test -- src/app/[locale]/\(app\)/time-tracking/actions/clocking.test.ts src/app/api/mobile/time-clock/route.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run: `git add apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions/clocking.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions.canonical.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions/clocking.test.ts apps/webapp/src/app/api/mobile/time-clock/route.ts apps/webapp/src/app/api/mobile/time-clock/route.test.ts apps/webapp/src/lib/query/use-time-clock.ts apps/webapp/src/lib/offline/types.ts apps/webapp/public/sw.js apps/webapp/public/lib/offline-queue-db.js apps/webapp/public/lib/sync-service.js && git commit -m "feat: carry work location through clock in paths"`

Expected: commit succeeds.

---

### Task 3: Quick Clock-In UI Selector

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx`
- Modify: `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-clock-popover.tsx`
- Create: `apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`
- Modify: `apps/webapp/messages/timeTracking/en.json`
- Modify: `apps/webapp/messages/timeTracking/de.json`

- [ ] **Step 1: Write failing quick popover test**

Create `apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeClockPopover } from "@/components/time-tracking/time-clock-popover";

const clockInMock = vi.fn();

vi.mock("@/lib/query", () => ({
	useElapsedTimer: () => 0,
	useTimeClock: () => ({
		hasEmployee: true,
		employeeId: "employee-1",
		isClockedIn: false,
		activeWorkPeriod: null,
		isLoading: false,
		clockIn: clockInMock,
		clockOut: vi.fn(),
		updateNotes: vi.fn(),
		isClockingOut: false,
		isUpdatingNotes: false,
		isMutating: false,
	}),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

describe("TimeClockPopover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clockInMock.mockResolvedValue({ success: true, data: { id: "entry-1" } });
		localStorage.clear();
	});

	it("preselects office for quick clock-in", async () => {
		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: /clock in/i }));
		fireEvent.click(screen.getByRole("button", { name: /^clock in$/i }));

		await waitFor(() => {
			expect(clockInMock).toHaveBeenCalledWith({ workLocationType: "office" });
		});
	});

	it("submits the selected remote location", async () => {
		render(<TimeClockPopover />);

		fireEvent.click(screen.getByRole("button", { name: /clock in/i }));
		fireEvent.click(screen.getByRole("radio", { name: "Remote" }));
		fireEvent.click(screen.getByRole("button", { name: /^clock in$/i }));

		await waitFor(() => {
			expect(clockInMock).toHaveBeenCalledWith({ workLocationType: "remote" });
		});
	});
});
```

- [ ] **Step 2: Run the failing quick popover test**

Run: `pnpm --filter webapp test -- src/components/time-tracking/time-clock-popover.test.tsx`

Expected: FAIL because the popover does not render a location selector and calls `clockIn()` without params.

- [ ] **Step 3: Update `WorkLocationSelector` to use remote**

In `clock-in-out-widget-parts.tsx`, import the shared type and replace prop types with `WorkLocationType`:

```ts
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
```

Replace the `field` toggle with this `remote` toggle:

```tsx
<ToggleGroupItem value="remote" aria-label={t("timeTracking.workLocationRemote", "Remote")}>
	<IconMapPin className="size-4" />
	<span className="hidden @[20rem]/widget:inline text-xs">
		{t("timeTracking.workLocationRemote", "Remote")}
	</span>
</ToggleGroupItem>
```

- [ ] **Step 4: Normalize full widget location state**

In `use-clock-in-out-widget.tsx`, remove the local `WorkLocationType` alias and import:

```ts
import { normalizeWorkLocationType, type WorkLocationType } from "@/lib/time-tracking/work-location";
```

Replace `getInitialWorkLocationType` with:

```ts
function getInitialWorkLocationType(): WorkLocationType {
	if (typeof window === "undefined") {
		return "office";
	}

	return normalizeWorkLocationType(localStorage.getItem("z8-work-location-type"));
}
```

- [ ] **Step 5: Add quick popover location state and selector**

In `time-clock-popover.tsx`, import `WorkLocationSelector` and shared types:

```ts
import { WorkLocationSelector } from "./clock-in-out-widget-parts";
import { normalizeWorkLocationType, type WorkLocationType } from "@/lib/time-tracking/work-location";
```

Add state after `open`:

```ts
const [workLocationType, setWorkLocationType] = useState<WorkLocationType>(() => {
	if (typeof window === "undefined") {
		return "office";
	}

	return normalizeWorkLocationType(localStorage.getItem("z8-work-location-type"));
});
```

Update `handleClockIn`:

```ts
const result = await clockIn({ workLocationType });
```

After a successful online or queued clock-in, persist the selected value:

```ts
localStorage.setItem("z8-work-location-type", workLocationType);
```

Render the selector before the action button while not clocked in:

```tsx
{!isClockedIn && (
	<WorkLocationSelector value={workLocationType} onChange={setWorkLocationType} t={t} />
)}
```

- [ ] **Step 6: Add translation labels**

In `apps/webapp/messages/timeTracking/en.json`, add keys inside `timeTracking`:

```json
"workLocationHome": "Home",
"workLocationOffice": "Office",
"workLocationOther": "Other",
"workLocationRemote": "Remote"
```

In `apps/webapp/messages/timeTracking/de.json`, add:

```json
"workLocationHome": "Zuhause",
"workLocationOffice": "Büro",
"workLocationOther": "Andere",
"workLocationRemote": "Remote"
```

- [ ] **Step 7: Run the quick popover test**

Run: `pnpm --filter webapp test -- src/components/time-tracking/time-clock-popover.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run: `git add apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/time-clock-popover.tsx apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx apps/webapp/messages/timeTracking/en.json apps/webapp/messages/timeTracking/de.json && git commit -m "feat: add quick clock-in location selector"`

Expected: commit succeeds.

---

### Task 4: Presence Compliance And Backfill Consistency

**Files:**
- Modify: `apps/webapp/src/lib/compliance/rules/presence-requirement-rule.ts`
- Modify: `apps/webapp/src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/queries.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/lib/time-record/migration/backfill.ts`
- Modify: `apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts`

- [ ] **Step 1: Write failing presence compliance test**

In `presence-requirement-rule.test.ts`, replace the existing `test("field counts as on-site"...)` block in `describe("location type classification")` with:

```ts
test("remote does not count as on-site", async () => {
	const workPeriods = [
		makeWorkPeriod(0, "remote"),
		makeWorkPeriod(1, "remote"),
		makeWorkPeriod(2, "remote"),
	];

	const findings = await rule.detectViolations(
		makeInput({
			workPeriods,
			presenceConfig: makePresenceConfig({ requiredOnsiteDays: 3 }),
		}),
	);

	expect(findings).toHaveLength(1);
	expect((findings[0].evidence as PresenceRequirementEvidence).actualOnsiteDays).toBe(0);
});
```

- [ ] **Step 2: Run the failing presence test**

Run: `pnpm --filter webapp test -- src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts`

Expected: FAIL because the code still references `field` or lacks the new remote expectation.

- [ ] **Step 3: Update onsite logic**

In `presence-requirement-rule.ts`, replace:

```ts
const ONSITE_LOCATION_TYPES = new Set(["office", "field"]);
```

with:

```ts
const ONSITE_LOCATION_TYPES = new Set(["office"]);
```

In `actions/queries.ts` and the monolithic `actions.ts`, replace each onsite check:

```ts
if (period.workLocationType === "office" || period.workLocationType === "field") {
```

with:

```ts
if (period.workLocationType === "office") {
```

- [ ] **Step 4: Update backfill types and fixtures**

In `backfill.ts`, replace each work location union with:

```ts
workLocationType: "office" | "home" | "remote" | "other" | null;
```

In `backfill.test.ts`, replace any `workLocationType: "field"` fixture with:

```ts
workLocationType: "remote",
```

- [ ] **Step 5: Run compliance and backfill tests**

Run: `pnpm --filter webapp test -- src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts src/lib/time-record/migration/__tests__/backfill.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run: `git add apps/webapp/src/lib/compliance/rules/presence-requirement-rule.ts apps/webapp/src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions/queries.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions.ts apps/webapp/src/lib/time-record/migration/backfill.ts apps/webapp/src/lib/time-record/migration/__tests__/backfill.test.ts && git commit -m "fix: treat remote work as offsite presence"`

Expected: commit succeeds.

---

### Task 5: Global Field Removal And Verification

**Files:**
- Inspect and modify any remaining source files returned by the searches below.

- [ ] **Step 1: Search for obsolete `field` work location references**

Run: `pnpm --filter webapp exec rg '"field"|workLocationField|WorkLocationField|work location.*field|field.*work location' src messages public drizzle`

Expected: Only unrelated uses of the English word `field` remain. There must be no valid work location unions, labels, or API schemas that include `field`.

- [ ] **Step 2: Fix remaining location-specific references**

For each remaining location-specific match, apply one of these exact replacements:

```ts
"office" | "home" | "field" | "other"
```

becomes:

```ts
WorkLocationType
```

and:

```ts
"field"
```

becomes:

```ts
"remote"
```

Only apply the second replacement when the match is a work location value, not an unrelated form field or database field name.

- [ ] **Step 3: Run focused tests**

Run: `pnpm --filter webapp test -- src/components/time-tracking/time-clock-popover.test.tsx src/app/[locale]/\(app\)/time-tracking/actions/clocking.test.ts src/app/api/mobile/time-clock/route.test.ts src/lib/compliance/rules/__tests__/presence-requirement-rule.test.ts src/lib/time-record/migration/__tests__/backfill.test.ts`

Expected: PASS.

- [ ] **Step 4: Run full webapp tests**

Run: `pnpm --filter webapp test`

Expected: PASS.

- [ ] **Step 5: Run TypeScript check**

Run: `pnpm --filter webapp exec tsc --noEmit --pretty false`

Expected: PASS.

- [ ] **Step 6: Run production build**

Run: `pnpm --filter webapp build`

Expected: PASS. If this fails because required system-level environment variables are unavailable to agents, record the skipped build and the missing variables in the final response instead of changing env configuration.

- [ ] **Step 7: Commit final verification fixes**

Run: `git add apps/webapp && git commit -m "chore: finish remote work location rollout"`

Expected: commit succeeds if Step 2 changed files. If Step 2 did not change files, skip this commit.

---

## Self-Review Notes

- Spec coverage: The plan adds the quick popover selector, defaults to `office`, persists location on clock-in, replaces `field` with `remote`, migrates historical data, updates mobile/offline paths, and verifies presence compliance semantics.
- Placeholder scan: No task contains deferred implementation markers. Each code change step includes the exact code or replacement rule needed.
- Type consistency: All runtime paths use `WorkLocationType` from `apps/webapp/src/lib/time-tracking/work-location.ts`, and stale `field` local storage values normalize to `remote`.
