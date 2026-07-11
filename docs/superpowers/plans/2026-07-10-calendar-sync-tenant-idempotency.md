# Calendar Sync Tenant Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenant-scope every calendar synchronization job and make external event creation idempotent across concurrent workers and retries.

**Architecture:** Carry `organizationId` from every producer into the worker, then constrain connection and absence reads by organization and employee. Derive one stable SHA-256 key per organization/connection/absence, pass it through the provider contract as Google event `id` or Microsoft `transactionId`, and upsert the local mapping so concurrent workers converge.

**Tech Stack:** TypeScript, BullMQ, Drizzle ORM, Effect, Vitest, Google Calendar API v3, Microsoft Graph v1.0.

**Design:** `docs/superpowers/specs/2026-07-10-calendar-sync-tenant-idempotency-design.md`

**Commit policy:** Do not create commits unless the user explicitly requests one.

---

## File Map

- Modify `apps/webapp/src/lib/queue/index.ts`: require tenant identity in calendar jobs.
- Modify all six calendar queue producer modules: pass their existing organization identity.
- Modify producer tests: prove tenant identity reaches queued jobs.
- Modify `apps/webapp/src/lib/calendar-sync/providers/base.ts`: generate a deterministic provider-safe event key.
- Modify `apps/webapp/src/lib/calendar-sync/types.ts`: carry the key through the provider contract.
- Create provider/base tests: prove deterministic key and provider request behavior.
- Modify `apps/webapp/src/lib/calendar-sync/jobs/sync-processor.ts`: tenant-scope reads, pass the key, and upsert local state.
- Create `apps/webapp/src/lib/calendar-sync/jobs/sync-processor.test.ts`: prove mismatched tenants never reach providers and create persistence is conflict-safe.

### Task 1: Propagate Organization Identity Through Calendar Jobs

**Files:**
- Modify: `apps/webapp/src/lib/queue/index.ts:87-92`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect-helpers.ts:50-65`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts:667-670,755-759,789-793`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts:127-131`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/actions.ts:448-477`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts:104-115`
- Test: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.test.ts:98-126`
- Test: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts:449-520`

- [ ] **Step 1: Update producer expectations first**

Add `organizationId: "org-1"` to the vacation override helper input and each expected queue payload:

```ts
enqueueVacationOverrideCalendarSyncJobs({
	employeeId: "employee-1",
	organizationId: "org-1",
	summary,
});

expect(addCalendarSyncJobMock).toHaveBeenNthCalledWith(1, {
	absenceId: "updated-1",
	employeeId: "employee-1",
	organizationId: "org-1",
	action: "update",
});
```

Apply the same required property to all approval queue assertions.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm test -- 'src/app/[locale]/(app)/absences/request-absence-effect.test.ts' 'src/lib/approvals/server/absence-approvals.test.ts'
```

Expected: FAIL because the helper and approval producer do not include `organizationId`.

- [ ] **Step 3: Require and propagate organization identity**

Change the queue contract:

```ts
export interface CalendarSyncJobData {
	type: "calendar-sync";
	absenceId: string;
	employeeId: string;
	organizationId: string;
	action: "create" | "update" | "delete";
}
```

Change the vacation override helper input and all three payloads:

```ts
export function enqueueVacationOverrideCalendarSyncJobs(input: {
	employeeId: string;
	organizationId: string;
	summary: VacationOverrideSummary;
}) {
	for (const absenceId of input.summary.updatedAbsenceIds) {
		void addCalendarSyncJob({
			absenceId,
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			action: "update",
		});
	}

	for (const absenceId of input.summary.createdAbsenceIds) {
		void addCalendarSyncJob({
			absenceId,
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			action: "create",
		});
	}

	for (const absenceId of input.summary.deletedAbsenceIds) {
		void addCalendarSyncJob({
			absenceId,
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			action: "delete",
		});
	}
}
```

Pass `currentEmployee.organizationId`, `absence.organizationId`, `actor.organizationId`, or `result.absence.organizationId` at every direct producer and helper call. Do not derive tenant identity from an employee or absence ID inside the queue module.

- [ ] **Step 4: Run producer tests and typecheck**

Run:

```bash
pnpm test -- 'src/app/[locale]/(app)/absences/request-absence-effect.test.ts' 'src/lib/approvals/server/absence-approvals.test.ts'
pnpm typecheck
```

Expected: focused tests PASS; typecheck reports no calendar producer missing `organizationId`.

### Task 2: Generate A Stable Provider-Safe Event Key

**Files:**
- Modify: `apps/webapp/src/lib/calendar-sync/providers/base.ts:207-212`
- Modify: `apps/webapp/src/lib/calendar-sync/types.ts:62-73`
- Create: `apps/webapp/src/lib/calendar-sync/providers/base.test.ts`

- [ ] **Step 1: Write deterministic-key tests**

```ts
import { describe, expect, it } from "vitest";
import { generateZ8EventId } from "./base";

const input = {
	organizationId: "org-1",
	calendarConnectionId: "connection-1",
	absenceId: "absence-1",
};

describe("generateZ8EventId", () => {
	it("returns a stable Google-compatible SHA-256 key", () => {
		const first = generateZ8EventId(input);
		const second = generateZ8EventId(input);

		expect(first).toBe(second);
		expect(first).toMatch(/^[a-f0-9]{64}$/);
	});

	it.each([
		["organizationId", "org-2"],
		["calendarConnectionId", "connection-2"],
		["absenceId", "absence-2"],
	] as const)("changes when %s changes", (field, value) => {
		expect(generateZ8EventId({ ...input, [field]: value })).not.toBe(generateZ8EventId(input));
	});
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test -- src/lib/calendar-sync/providers/base.test.ts`

Expected: FAIL because `generateZ8EventId` has the old one-argument, non-provider-safe implementation.

- [ ] **Step 3: Implement the key and provider contract field**

In `base.ts`:

```ts
import { createHash } from "node:crypto";

export function generateZ8EventId(input: {
	organizationId: string;
	calendarConnectionId: string;
	absenceId: string;
}): string {
	return createHash("sha256")
		.update(`${input.organizationId}:${input.calendarConnectionId}:${input.absenceId}`)
		.digest("hex");
}
```

In `CalendarEventToCreate`:

```ts
/** Stable key used to deduplicate provider create requests. */
idempotencyKey?: string;
```

- [ ] **Step 4: Run the key test and verify GREEN**

Run: `pnpm test -- src/lib/calendar-sync/providers/base.test.ts`

Expected: PASS.

### Task 3: Apply Provider-Native Idempotency

**Files:**
- Modify: `apps/webapp/src/lib/calendar-sync/providers/google.ts:366-432`
- Modify: `apps/webapp/src/lib/calendar-sync/providers/microsoft365.ts:46-59,357-430`
- Create: `apps/webapp/src/lib/calendar-sync/providers/google.test.ts`
- Create: `apps/webapp/src/lib/calendar-sync/providers/microsoft365.test.ts`

- [ ] **Step 1: Write Google create tests**

Instantiate `GoogleCalendarProvider`, stub `globalThis.fetch`, run `Effect.runPromise(provider.createEvent(...))`, and assert the parsed POST body contains:

```ts
expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
	id: "a".repeat(64),
	summary: "Out of Office",
});
```

Add a second test with `fetchMock.mockResolvedValue(new Response(null, { status: 409 }))` and assert the effect resolves to `{ id: "a".repeat(64) }` rather than rejecting.

- [ ] **Step 2: Write Microsoft create test**

Instantiate `Microsoft365CalendarProvider`, return a `201` response containing an external event ID, and assert the request body contains:

```ts
expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
	transactionId: "a".repeat(64),
	subject: "Out of Office",
});
```

- [ ] **Step 3: Run provider tests and verify RED**

Run:

```bash
pnpm test -- src/lib/calendar-sync/providers/google.test.ts src/lib/calendar-sync/providers/microsoft365.test.ts
```

Expected: FAIL because neither provider sends the idempotency key and Google rejects `409`.

- [ ] **Step 4: Implement Google event identity and duplicate recovery**

Include the key in `googleEvent`:

```ts
const googleEvent: Partial<GoogleEvent> = {
	id: event.idempotencyKey,
	summary: event.title,
	description: event.description,
	status: event.status ?? "confirmed",
	visibility: event.visibility ?? "default",
	location: event.location,
};
```

Handle only deterministic create conflicts before generic API error conversion:

```ts
if (response.status === 409 && event.idempotencyKey) {
	return { id: event.idempotencyKey };
}
if (!response.ok) {
	throw await handleGoogleApiError(response);
}
```

- [ ] **Step 5: Implement Microsoft transaction identity**

Add `transactionId?: string` to `MSGraphEvent` and map the provider contract:

```ts
const msEvent: Partial<MSGraphEvent> = {
	transactionId: event.idempotencyKey,
	subject: event.title,
	body: event.description ? { content: event.description, contentType: "text" } : undefined,
	isAllDay: event.isAllDay,
	showAs: event.status === "tentative" ? "tentative" : "oof",
	sensitivity: event.visibility === "private" ? "private" : "normal",
	location: event.location ? { displayName: event.location } : undefined,
};
```

- [ ] **Step 6: Run provider tests and verify GREEN**

Run:

```bash
pnpm test -- src/lib/calendar-sync/providers/base.test.ts src/lib/calendar-sync/providers/google.test.ts src/lib/calendar-sync/providers/microsoft365.test.ts
```

Expected: PASS.

### Task 4: Tenant-Scope Processing And Converge Local State

**Files:**
- Modify: `apps/webapp/src/lib/calendar-sync/jobs/sync-processor.ts:34-206,220-286`
- Create: `apps/webapp/src/lib/calendar-sync/jobs/sync-processor.test.ts`

- [ ] **Step 1: Write processor tenant-boundary tests**

Mock `@/db`, token storage, and provider lookup. Use a real `processCalendarSyncJob` call with:

```ts
const job = {
	type: "calendar-sync" as const,
	absenceId: "absence-1",
	employeeId: "employee-1",
	organizationId: "org-1",
	action: "create" as const,
};
```

Test that a connection lookup returning no row resolves as a successful no-op and never calls the provider. Spy on `eq` and assert the lookup includes both:

```ts
expect(eq).toHaveBeenCalledWith(calendarConnection.employeeId, "employee-1");
expect(eq).toHaveBeenCalledWith(calendarConnection.organizationId, "org-1");
```

Then return a scoped connection but no absence row. Assert the provider remains untouched and the absence query includes:

```ts
expect(eq).toHaveBeenCalledWith(absenceEntry.id, "absence-1");
expect(eq).toHaveBeenCalledWith(absenceEntry.employeeId, "employee-1");
expect(eq).toHaveBeenCalledWith(absenceEntry.organizationId, "org-1");
expect(eq).toHaveBeenCalledWith(absenceCategory.organizationId, "org-1");
expect(eq).toHaveBeenCalledWith(employee.organizationId, "org-1");
```

- [ ] **Step 2: Write create convergence test**

Configure mocks with a scoped absence, valid credentials, no existing sync row, and a provider result. Assert `createEvent` receives the stable key:

```ts
expect(provider.createEvent).toHaveBeenCalledWith(
	expect.anything(),
	"primary",
	expect.objectContaining({
		idempotencyKey: generateZ8EventId({
			organizationId: "org-1",
			calendarConnectionId: "connection-1",
			absenceId: "absence-1",
		}),
	}),
);
```

Assert the insert chain calls:

```ts
expect(onConflictDoUpdate).toHaveBeenCalledWith({
	target: [syncedAbsence.absenceEntryId, syncedAbsence.calendarConnectionId],
	set: expect.objectContaining({
		externalEventId: "external-1",
		externalCalendarId: "primary",
		syncStatus: "synced",
		lastAction: "create",
		syncError: null,
	}),
});
```

- [ ] **Step 3: Run processor tests and verify RED**

Run: `pnpm test -- src/lib/calendar-sync/jobs/sync-processor.test.ts`

Expected: FAIL because the processor omits tenant predicates, does not pass an idempotency key, and inserts without conflict handling.

- [ ] **Step 4: Add tenant predicates throughout the processor**

Destructure and log `organizationId`:

```ts
const { absenceId, employeeId, organizationId, action } = data;
```

Scope the connection:

```ts
where: and(
	eq(calendarConnection.organizationId, organizationId),
	eq(calendarConnection.employeeId, employeeId),
	eq(calendarConnection.isActive, true),
	eq(calendarConnection.pushEnabled, true),
),
```

Pass `organizationId` and `employeeId` into create/update handlers. Scope create and update absence reads with `and(...)` predicates for absence ID, absence organization, absence employee, category organization, and joined employee organization.

- [ ] **Step 5: Pass the deterministic key and upsert the sync row**

After mapping the event:

```ts
eventToCreate.idempotencyKey = generateZ8EventId({
	organizationId,
	calendarConnectionId: connection.id,
	absenceId,
});
```

Replace the create-path conditional update/insert with one insert and conflict update:

```ts
const syncedAt = new Date();
await db
	.insert(syncedAbsence)
	.values({
		absenceEntryId: absenceId,
		calendarConnectionId: connection.id,
		externalEventId: result.id,
		externalCalendarId: connection.calendarId,
		externalEventEtag: result.etag,
		syncStatus: "synced",
		lastAction: "create",
		lastSyncedAt: syncedAt,
		syncError: null,
		updatedAt: syncedAt,
	})
	.onConflictDoUpdate({
		target: [syncedAbsence.absenceEntryId, syncedAbsence.calendarConnectionId],
		set: {
			externalEventId: result.id,
			externalCalendarId: connection.calendarId,
			externalEventEtag: result.etag,
			syncStatus: "synced",
			lastAction: "create",
			lastSyncedAt: syncedAt,
			syncError: null,
			updatedAt: syncedAt,
		},
	});
```

The early `existingSync.syncStatus === "synced"` return stays unchanged.

- [ ] **Step 6: Run processor tests and verify GREEN**

Run: `pnpm test -- src/lib/calendar-sync/jobs/sync-processor.test.ts`

Expected: PASS.

### Task 5: Calendar Fix Verification

**Files:**
- Verify all files listed above.

- [ ] **Step 1: Run all focused calendar and producer suites**

```bash
pnpm test -- src/lib/calendar-sync/providers/base.test.ts src/lib/calendar-sync/providers/google.test.ts src/lib/calendar-sync/providers/microsoft365.test.ts src/lib/calendar-sync/jobs/sync-processor.test.ts 'src/app/[locale]/(app)/absences/request-absence-effect.test.ts' src/lib/approvals/server/absence-approvals.test.ts
```

Expected: all focused tests PASS without warnings or unhandled rejections.

- [ ] **Step 2: Run project typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Run the complete webapp test suite**

Run: `pnpm test`

Expected: PASS. If unrelated concurrent failures occur, record their exact files and output without changing unrelated work.

- [ ] **Step 4: Review the final diff for scope and security**

Confirm every `addCalendarSyncJob` call includes `organizationId`, every processor entity read is tenant-bound, no credentials or event contents were added to logs, provider IDs are deterministic and connection-specific, and no unrelated files were modified.
