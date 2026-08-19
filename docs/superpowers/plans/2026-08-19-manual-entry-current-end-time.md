# Manual Entry Current End Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default a newly opened manual time entry's clock-out field to the exact current minute in the employee's timezone.

**Architecture:** Keep default calculation in the existing `getDefaultValues()` boundary so every panel reset receives a fresh value. Use Luxon's explicit employee timezone because this file is legacy/unmigrated date code, and preserve an explicit `defaultClockOutTime` prop as the highest-priority value.

**Tech Stack:** React 19, TypeScript, TanStack Form, Luxon, Vitest, Testing Library.

**Design:** `docs/superpowers/specs/2026-08-19-manual-entry-current-end-time-design.md`

**Repository constraint:** Do not create commits unless the user explicitly requests them.

---

### Task 1: Calculate The Employee-Local Current End Time

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`
- Modify: `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`

- [ ] **Step 1: Add a failing fixed-clock default test**

Freeze the clock and open the dialog for an employee timezone that differs from UTC. Assert the clock-out input receives the exact employee-local minute rather than `17:00`.

```tsx
vi.setSystemTime(new Date("2026-08-19T12:37:45.000Z"));

render(
	<ManualTimeEntryDialog
		employeeId="employee-1"
		employeeTimezone="Europe/Berlin"
		hasManager
	/>,
);

await user.click(screen.getByRole("button", { name: "Add Manual Time Entry" }));
expect(screen.getByLabelText("Clock Out")).toHaveValue("14:37");
```

- [ ] **Step 2: Add explicit-default and reopen tests**

Verify `defaultClockOutTime="16:15"` still wins. Then advance the fixed clock, close and reopen the uncontrolled panel, and assert the default is recalculated from the new instant rather than retaining the original value.

```tsx
expect(screen.getByLabelText("Clock Out")).toHaveValue("16:15");

vi.setSystemTime(new Date("2026-08-19T12:42:00.000Z"));
await user.click(screen.getByRole("button", { name: "Cancel" }));
await user.click(screen.getByRole("button", { name: "Add Manual Time Entry" }));
expect(screen.getByLabelText("Clock Out")).toHaveValue("14:42");
```

- [ ] **Step 3: Run the test and verify RED**

```bash
pnpm --filter webapp exec vitest run src/components/time-tracking/manual-time-entry-dialog.test.tsx
```

Expected: the employee-local and reopen assertions receive `17:00`.

- [ ] **Step 4: Replace the fixed default**

In `getDefaultValues()`, derive the current employee-local minute at invocation time and preserve prop precedence:

```ts
const now = DateTime.now().setZone(employeeTimezone);

return {
	date: defaults.defaultDate ?? now.toISODate() ?? "",
	clockInTime: defaults.defaultClockInTime ?? "09:00",
	clockOutTime:
		defaults.defaultClockOutTime ?? now.toFormat("HH:mm"),
	// existing remaining defaults
};
```

Do not store `now` outside the function, add rounding, use the browser timezone, or update an already open form.

- [ ] **Step 5: Run focused verification**

```bash
pnpm --filter webapp exec vitest run src/components/time-tracking/manual-time-entry-dialog.test.tsx
pnpm --filter webapp typecheck
git diff --check
```

Expected: the manual-entry tests and typecheck pass, and the diff check emits no output.
