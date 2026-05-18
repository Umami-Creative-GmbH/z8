# Quick Break Active Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coffee-button quick break action that splits the current active session into work, break, and continued work without clocking the user out.

**Architecture:** Implement the split in the focused clocking server-action module, then re-export it through the legacy `actions.ts` entrypoint used by the webapp hook. A reusable quick-break popover calls a TanStack Query mutation exposed by `useTimeClock`, and both clock UI surfaces render the same component while clocked in.

**Tech Stack:** Next.js server actions, Drizzle ORM, React, TanStack Query, Tolgee, shadcn/ui `Button`, `Input`, `Popover`, Vitest, Testing Library.

---

## File Structure

- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`: add `addBreakToActiveSession`.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`: add server-action tests for split and validation paths.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`: re-export `addBreakToActiveSession` for existing webapp imports.
- Modify `apps/webapp/src/lib/query/use-time-clock.ts`: add the quick-break mutation.
- Modify `apps/webapp/src/lib/query/use-time-clock.presence.test.tsx`: verify invalidation after quick break.
- Create `apps/webapp/src/components/time-tracking/quick-break-popover.tsx`: reusable coffee icon popover.
- Create `apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx`: popover behavior tests.
- Modify `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`: add `handleAddBreak`.
- Modify `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`: render quick break beside Clock Out.
- Modify `apps/webapp/src/components/time-tracking/time-clock-popover.tsx`: render quick break in the header popover.
- Modify `apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`: update hook mocks for new fields.

## Task 1: Server Action And Tests

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`

- [ ] **Step 1: Write failing server-action tests**

In `actions/clocking.test.ts`, extend `mockState` with `insertReturning: vi.fn()` and update the import:

```ts
const { addBreakToActiveSession, clockIn, clockOut } = await import("./clocking");
```

In each `beforeEach`, set insert chaining:

```ts
mockState.insertValues.mockReturnValue({ returning: mockState.insertReturning });
mockState.insertReturning.mockResolvedValue([
	{ id: "period-2", startTime: new Date("2026-05-04T10:00:00.000Z") },
]);
```

Add this test block:

```ts
describe("addBreakToActiveSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.updateWhere.mockResolvedValue(undefined);
		mockState.insertValues.mockReturnValue({ returning: mockState.insertReturning });
		mockState.insertReturning.mockResolvedValue([
			{ id: "period-2", startTime: new Date("2026-05-04T10:00:00.000Z") },
		]);
		mockState.getCurrentSession.mockResolvedValue({ user: { id: "user-1" } });
		mockState.getCurrentEmployee.mockResolvedValue({ id: "employee-1", organizationId: "org-1", teamId: null, managerId: null });
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "period-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			startTime: new Date("2026-05-04T09:00:00.000Z"),
			workLocationType: "remote",
		});
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-out-1", type: "clock_out" })
			.mockResolvedValueOnce({ id: "clock-in-2", type: "clock_in" });
	});

	it("splits the active session and starts a new active period", async () => {
		const result = await addBreakToActiveSession(30);

		expect(result).toEqual({ success: true, data: { id: "period-2", startTime: new Date("2026-05-04T10:00:00.000Z") } });
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "clock_out", timestamp: new Date("2026-05-04T09:30:00.000Z") }));
		expect(mockState.updateSet).toHaveBeenCalledWith(expect.objectContaining({ clockOutId: "clock-out-1", endTime: new Date("2026-05-04T09:30:00.000Z"), durationMinutes: 30, isActive: false, approvalStatus: "approved" }));
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "clock_in", timestamp: new Date("2026-05-04T10:00:00.000Z") }));
		expect(mockState.insertValues).toHaveBeenCalledWith(expect.objectContaining({ clockInId: "clock-in-2", startTime: new Date("2026-05-04T10:00:00.000Z"), workLocationType: "remote" }));
	});

	it("rejects zero minutes before writing entries", async () => {
		await expect(addBreakToActiveSession(0)).resolves.toEqual({ success: false, error: "Enter a break duration of at least 1 minute." });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("rejects when the employee is not clocked in", async () => {
		mockState.getActiveWorkPeriod.mockResolvedValue(null);
		await expect(addBreakToActiveSession(30)).resolves.toEqual({ success: false, error: "You are not currently clocked in." });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("rejects breaks as long as the active session", async () => {
		await expect(addBreakToActiveSession(60)).resolves.toEqual({ success: false, error: "Break duration must be shorter than your current session." });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run the failing test**

Run from `apps/webapp`: `pnpm test -- --run 'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts'`

Expected: FAIL because `addBreakToActiveSession` is not exported.

- [ ] **Step 3: Implement the server action**

Add after `clockOut` in `actions/clocking.ts`:

```ts
export async function addBreakToActiveSession(
	breakMinutes: number,
): Promise<ServerActionResult<{ id: string; startTime: Date }>> {
	const session = await getCurrentSession();
	if (!session?.user) return { success: false, error: "Not authenticated" };

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) return { success: false, error: "Employee profile not found" };

	if (!Number.isInteger(breakMinutes) || breakMinutes < 1) {
		return { success: false, error: "Enter a break duration of at least 1 minute." };
	}

	const activeWorkPeriod = await getActiveWorkPeriod(currentEmployee.id);
	if (!activeWorkPeriod) return { success: false, error: "You are not currently clocked in." };
	if (activeWorkPeriod.organizationId !== currentEmployee.organizationId) {
		return { success: false, error: "You are not allowed to edit this time entry" };
	}

	const now = new Date();
	const activeSessionMinutes = Math.floor((now.getTime() - activeWorkPeriod.startTime.getTime()) / 60000);
	if (breakMinutes >= activeSessionMinutes) {
		return { success: false, error: "Break duration must be shorter than your current session." };
	}

	const breakStart = new Date(now.getTime() - breakMinutes * 60000);
	if (breakStart <= activeWorkPeriod.startTime) {
		return { success: false, error: "Break duration must be shorter than your current session." };
	}

	try {
		const clockOutEntry = await createTimeEntry({ employeeId: currentEmployee.id, organizationId: currentEmployee.organizationId, type: "clock_out", timestamp: breakStart, createdBy: session.user.id });
		await db.update(workPeriod).set({ clockOutId: clockOutEntry.id, endTime: breakStart, durationMinutes: calculateDurationMinutes(activeWorkPeriod.startTime, breakStart), isActive: false, approvalStatus: "approved", pendingChanges: null, updatedAt: new Date() }).where(eq(workPeriod.id, activeWorkPeriod.id));
		const clockInEntry = await createTimeEntry({ employeeId: currentEmployee.id, organizationId: currentEmployee.organizationId, type: "clock_in", timestamp: now, createdBy: session.user.id });
		const [newPeriod] = await db.insert(workPeriod).values({ employeeId: currentEmployee.id, organizationId: currentEmployee.organizationId, clockInId: clockInEntry.id, startTime: now, workLocationType: activeWorkPeriod.workLocationType ?? "office" }).returning({ id: workPeriod.id, startTime: workPeriod.startTime });

		return newPeriod ? { success: true, data: newPeriod } : { success: false, error: "Failed to add break. Please try again." };
	} catch (error) {
		logger.error({ error }, "Add break to active session error");
		return { success: false, error: "Failed to add break. Please try again." };
	}
}
```

- [ ] **Step 4: Re-export through the legacy actions entrypoint**

In `actions.ts`, add:

```ts
export { addBreakToActiveSession } from "./actions/clocking";
```

- [ ] **Step 5: Run server-action tests**

Run from `apps/webapp`: `pnpm test -- --run 'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts'`

Expected: PASS.

## Task 2: Query Hook Mutation

**Files:**
- Modify: `apps/webapp/src/lib/query/use-time-clock.ts`
- Modify: `apps/webapp/src/lib/query/use-time-clock.presence.test.tsx`

- [ ] **Step 1: Write the failing hook test**

In `use-time-clock.presence.test.tsx`, add `addBreakToActiveSession: vi.fn()` to `mocks`, add it to the actions mock, then add:

```ts
it("invalidates employee clock statuses after adding a break", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const invalidateSpy = vi.spyOn(client, "invalidateQueries");
	mocks.addBreakToActiveSession.mockResolvedValue({ success: true, data: { id: "period-2", startTime: new Date("2026-05-04T10:00:00.000Z") } });

	const { result } = renderHook(() => useTimeClock(), { wrapper: wrapper(client) });
	await result.current.addBreak({ breakMinutes: 30 });

	await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.employeeClockStatuses.all }));
});
```

- [ ] **Step 2: Run the failing hook test**

Run from `apps/webapp`: `pnpm test -- --run src/lib/query/use-time-clock.presence.test.tsx`

Expected: FAIL because `addBreak` is missing.

- [ ] **Step 3: Implement the mutation**

In `use-time-clock.ts`, import `addBreakToActiveSession`, add a mutation that rejects offline use with `Adding a break requires an internet connection.`, calls `addBreakToActiveSession(breakMinutes)` online, invalidates `queryKeys.timeClock.status()` and `queryKeys.employeeClockStatuses.all` on success, and return:

```ts
addBreak: addBreakMutation.mutateAsync,
isAddingBreak: addBreakMutation.isPending,
isMutating: clockInMutation.isPending || clockOutMutation.isPending || addBreakMutation.isPending || updateNotesMutation.isPending,
```

- [ ] **Step 4: Run the hook test**

Run from `apps/webapp`: `pnpm test -- --run src/lib/query/use-time-clock.presence.test.tsx`

Expected: PASS.

## Task 3: Quick Break Popover Component

**Files:**
- Create: `apps/webapp/src/components/time-tracking/quick-break-popover.tsx`
- Create: `apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `quick-break-popover.test.tsx` with tests that render `QuickBreakPopover`, open `Add break`, submit `30`, assert `onAddBreak(30)`, submit `0`, assert `Enter a break duration of at least 1 minute.`, and render with `isAddingBreak={true}` to assert the `Applying...` button is disabled.

- [ ] **Step 2: Run the failing component test**

Run from `apps/webapp`: `pnpm test -- --run src/components/time-tracking/quick-break-popover.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `QuickBreakPopover`**

Create a client component with props:

```ts
interface QuickBreakPopoverProps {
	onAddBreak: (breakMinutes: number) => Promise<{ success: boolean; error?: string }>;
	isAddingBreak: boolean;
	isDisabled: boolean;
	t: TFnType;
	buttonClassName?: string;
}
```

Use `IconCoffee`, `Button`, `Input`, and `Popover`. Default the input to `30`, validate integer minutes `>= 1`, call `onAddBreak(breakMinutes)`, close and reset on success, and show the returned error on failure. The trigger button must have `aria-label="Add break"` through Tolgee fallback `t("timeTracking.quickBreak.addBreak", "Add break")`.

- [ ] **Step 4: Run the component test**

Run from `apps/webapp`: `pnpm test -- --run src/components/time-tracking/quick-break-popover.test.tsx`

Expected: PASS.

## Task 4: Main Clock Widget Integration

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`

- [ ] **Step 1: Add `handleAddBreak`**

In `use-clock-in-out-widget.tsx`, add a handler that calls `timeClock.addBreak({ breakMinutes })`, shows success toast `Break added` with description `You are still clocked in.`, shows the returned error on failure, and returns `{ success: true }` or `{ success: false, error: result.error }`. Include it in the returned object.

- [ ] **Step 2: Render beside Clock Out**

In `clock-in-out-widget.tsx`, import `QuickBreakPopover`, wrap `ClockActionButton` in `div className="flex gap-2"`, keep the clock button flexible, and render `QuickBreakPopover` only when `widget.isClockedIn` with `onAddBreak={widget.handleAddBreak}`, `isAddingBreak={widget.isAddingBreak}`, `isDisabled={widget.isMutating}`, `t={widget.t}`, and `buttonClassName="shrink-0 px-4"`.

- [ ] **Step 3: Run focused tests**

Run from `apps/webapp`: `pnpm test -- --run src/components/time-tracking/quick-break-popover.test.tsx src/lib/query/use-time-clock.presence.test.tsx`

Expected: PASS.

## Task 5: Header Clock Popover Integration

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/time-clock-popover.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`

- [ ] **Step 1: Update test mocks**

In `time-clock-popover.test.tsx`, add `const addBreakMock = vi.fn();`, return `addBreak: addBreakMock` and `isAddingBreak: false` from the mocked `useTimeClock`, and reset with `addBreakMock.mockResolvedValue({ success: true });` in `beforeEach`.

- [ ] **Step 2: Integrate the popover**

In `time-clock-popover.tsx`, import `QuickBreakPopover`, destructure `addBreak` and `isAddingBreak`, add a local `handleAddBreak` with the same success/error toast behavior as the main widget, and render the popover beside the existing Clock Out button only when `isClockedIn`.

- [ ] **Step 3: Run the header popover test**

Run from `apps/webapp`: `pnpm test -- --run src/components/time-tracking/time-clock-popover.test.tsx`

Expected: PASS.

## Task 6: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run focused tests**

Run from `apps/webapp`:

```bash
pnpm test -- --run 'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' src/lib/query/use-time-clock.presence.test.tsx src/components/time-tracking/quick-break-popover.test.tsx src/components/time-tracking/time-clock-popover.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Manual behavior check if env vars are available**

Run `pnpm dev` only if required system environment variables are available. Verify clocked-out state has no coffee button, clocked-in state shows it beside Clock Out, applying `30` keeps the user clocked in and resets elapsed time, and applying `0` shows the minimum-duration error. If Phase/system env vars are unavailable, skip this step and report it.

- [ ] **Step 3: Commit if explicitly authorized**

Only if the user explicitly authorizes commits in the execution session:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts apps/webapp/src/lib/query/use-time-clock.ts apps/webapp/src/lib/query/use-time-clock.presence.test.tsx apps/webapp/src/components/time-tracking/quick-break-popover.tsx apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/time-clock-popover.tsx apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx
git commit -m "feat: add quick break action"
```

Expected: commit succeeds. If commits are not authorized, leave changes uncommitted and report modified files.

## Self-Review Notes

- Spec coverage: server split action, server validation, query invalidation, reusable popover, both web clock surfaces, online-only behavior, and focused tests are covered.
- Scope: no break table, notes, custom break start/end fields, project selection, or offline queue support are added.
- Type consistency: server action is `addBreakToActiveSession(breakMinutes)`, hook API is `addBreak({ breakMinutes })`, and UI handlers return `{ success, error? }` to the reusable popover.
