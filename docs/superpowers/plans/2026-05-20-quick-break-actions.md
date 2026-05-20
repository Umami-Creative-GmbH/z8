# Quick Break Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix quick break action layout in the calendar/time tracking widget and add an icon-only header quick break trigger while clocked in.

**Architecture:** Reuse the existing `QuickBreakPopover` everywhere so validation, default `30` minute duration, mutation handling, and copy remain consistent. Add narrow presentation props to the popover rather than duplicating break logic.

**Tech Stack:** React client components, Tailwind CSS, Tabler icons, Tolgee translations, Vitest/Testing Library.

---

## File Structure

- Modify `apps/webapp/src/components/time-tracking/quick-break-popover.tsx`: add an `iconOnly` presentation prop and preserve accessible labeling.
- Modify `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`: set the clock action to `basis-2/3` and the break popover to `basis-1/3` when clocked in.
- Modify `apps/webapp/src/components/time-tracking/time-clock-popover.tsx`: render a sibling icon-only `QuickBreakPopover` next to the header clock-out trigger while clocked in.
- Modify `apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx`: add coverage for icon-only rendering.
- Modify `apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`: add coverage for header break visibility while clocked in.

### Task 1: QuickBreakPopover Presentation Prop

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/quick-break-popover.tsx`
- Test: `apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx`

- [ ] **Step 1: Add a failing icon-only test**

Add this test to `quick-break-popover.test.tsx`:

```tsx
it("renders an icon-only trigger with an accessible label", () => {
	render(
		<QuickBreakPopover
			onAddBreak={async () => ({ success: true })}
			isAddingBreak={false}
			isDisabled={false}
			t={t}
			iconOnly
		/>,
	);

	const button = screen.getByRole("button", { name: "Add break" });
	expect(button.textContent).toBe("");
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `pnpm --filter webapp test apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx`

Expected: FAIL because `iconOnly` is not a valid prop or the trigger still renders visible text.

- [ ] **Step 3: Implement the prop**

Change `QuickBreakPopoverProps` and the trigger label rendering:

```tsx
interface QuickBreakPopoverProps {
	onAddBreak: (breakMinutes: number) => Promise<{ success: boolean; error?: string }>;
	isAddingBreak: boolean;
	isDisabled: boolean;
	t: TFnType;
	buttonClassName?: string;
	iconOnly?: boolean;
}

export function QuickBreakPopover({
	onAddBreak,
	isAddingBreak,
	isDisabled,
	t,
	buttonClassName,
	iconOnly = false,
}: QuickBreakPopoverProps) {
```

Replace the trigger content with:

```tsx
<IconCoffee className="size-4" />
{iconOnly ? null : <span className="hidden sm:inline">{addBreakLabel}</span>}
```

- [ ] **Step 4: Run focused test to verify pass**

Run: `pnpm --filter webapp test apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx`

Expected: PASS.

### Task 2: Calendar Widget 2/3 and 1/3 Layout

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`

- [ ] **Step 1: Update the action row classes**

When `widget.isClockedIn` is true, set the primary clock action to `basis-2/3` and the break popover trigger to `basis-1/3`. Keep the not-clocked-in clock action full width.

Use this structure:

```tsx
<div className="flex gap-2">
	<div className={widget.isClockedIn ? "basis-2/3" : "w-full"}>
		<ClockActionButton
			isClockedIn={widget.isClockedIn}
			isMutating={widget.isMutating}
			isClockingOut={widget.isClockingOut}
			onClick={widget.isClockedIn ? widget.handleClockOut : widget.handleClockIn}
			t={widget.t}
		/>
	</div>
	{widget.isClockedIn ? (
		<QuickBreakPopover
			onAddBreak={widget.handleAddBreak}
			isAddingBreak={widget.isAddingBreak}
			isDisabled={widget.isMutating}
			t={widget.t}
			buttonClassName="w-full px-3"
		/>
	) : null}
</div>
```

If `QuickBreakPopover` itself needs the basis class because `PopoverTrigger` is the button, use `buttonClassName="basis-1/3 px-3"` and keep the primary wrapper as `basis-2/3`.

- [ ] **Step 2: Run TypeScript or focused tests**

Run: `pnpm --filter webapp test apps/webapp/src/components/time-tracking/use-clock-in-out-widget.test.tsx apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx`

Expected: PASS.

### Task 3: Header Icon-Only Quick Break Trigger

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/time-clock-popover.tsx`
- Test: `apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`

- [ ] **Step 1: Add a failing visibility test**

Add or update tests so clocked-in state expects both the clock-out button and a separate `Add break` icon button, while clocked-out state does not show `Add break`.

```tsx
it("shows an icon-only quick break trigger next to the header clock-out button while clocked in", () => {
	isClockedInMock = true;
	render(<TimeClockPopover />);

	expect(screen.getByRole("button", { name: /clock out/i })).toBeTruthy();
	expect(screen.getByRole("button", { name: "Add break" })).toBeTruthy();
});

it("does not show the header quick break trigger while clocked out", () => {
	isClockedInMock = false;
	render(<TimeClockPopover />);

	expect(screen.queryByRole("button", { name: "Add break" })).toBeNull();
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `pnpm --filter webapp test apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`

Expected: FAIL because no header-level quick break trigger exists.

- [ ] **Step 3: Implement header sibling action**

Wrap the current header `Popover` and the conditional `QuickBreakPopover` in a flex row:

```tsx
return (
	<div className="flex items-center gap-2">
		<Popover open={open} onOpenChange={setOpen}>
			{/* existing clock trigger and popover content */}
		</Popover>
		{isClockedIn ? (
			<QuickBreakPopover
				onAddBreak={handleAddBreak}
				isAddingBreak={isAddingBreak}
				isDisabled={isMutating}
				t={t}
				buttonClassName="h-9 w-9 p-0"
				iconOnly
			/>
		) : null}
	</div>
);
```

Keep the existing in-popover quick break action unless product direction later removes it.

- [ ] **Step 4: Run focused test to verify pass**

Run: `pnpm --filter webapp test apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx`

Expected: PASS.

### Task 4: Final Verification

**Files:**
- Verify changed files only.

- [ ] **Step 1: Run focused test suite**

Run: `pnpm --filter webapp test apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx apps/webapp/src/components/time-tracking/use-clock-in-out-widget.test.tsx`

Expected: PASS.

- [ ] **Step 2: Inspect diff**

Run: `git diff -- apps/webapp/src/components/time-tracking/quick-break-popover.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/time-clock-popover.tsx apps/webapp/src/components/time-tracking/quick-break-popover.test.tsx apps/webapp/src/components/time-tracking/time-clock-popover.test.tsx docs/superpowers/specs/2026-05-20-quick-break-actions-design.md docs/superpowers/plans/2026-05-20-quick-break-actions.md`

Expected: Diff only contains quick break layout/action changes and supporting docs.
