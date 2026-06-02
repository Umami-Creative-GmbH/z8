# Calendar Mobile Controls And Employee Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move calendar filters and legend into a mobile-only bottom sheet and make the employee selector list fill the available sheet height.

**Architecture:** Keep calendar data and filter state in `CalendarView`. Add a mobile-only controls sheet that reuses the existing `CalendarFiltersComponent` and `CalendarLegend`, while preserving the current desktop sidebar. Fix `EmployeeSelectModal` layout by making the command/list region flex instead of using a fixed maximum list height.

**Tech Stack:** Next.js client components, React state, Tailwind CSS, existing Z8 UI primitives (`Button`, `Sheet`, `Card`), Vitest, Testing Library.

---

## File Structure

- Modify `apps/webapp/src/components/calendar/calendar-view.tsx`: add mobile-only bottom sheet state and render filters/legend in a mobile sheet while keeping desktop sidebar unchanged.
- Modify `apps/webapp/src/components/employee-select/employee-select-modal.tsx`: replace fixed `max-h-[320px]` list sizing with flex-based full-height layout.
- Modify `apps/webapp/src/components/calendar/calendar-view.test.tsx`: stop mocking filters/legend if needed and assert mobile controls render while desktop sidebar content stays desktop-only.
- Add or modify `apps/webapp/src/components/employee-select/employee-select-modal.test.tsx`: verify the employee list uses flex-based available-height classes and no longer uses the fixed 320px cap.

### Task 1: Calendar Mobile Controls Sheet

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Write the failing calendar layout test**

Update the existing mocks in `apps/webapp/src/components/calendar/calendar-view.test.tsx` so the filter and legend mocks expose their labels, then add this test inside `describe("CalendarView", ...)`:

```tsx
vi.mock("./calendar-filters", () => ({
	CalendarFiltersComponent: () => <div data-testid="calendar-filters">Filters</div>,
}));

vi.mock("./calendar-legend", () => ({
	CalendarLegend: () => <div data-testid="calendar-legend">Legend</div>,
}));

it("renders filters and legend in desktop sidebar and mobile controls sheet", () => {
	render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

	expect(screen.getByTestId("calendar-desktop-controls")).toHaveClass("hidden");
	expect(screen.getByTestId("calendar-desktop-controls")).toHaveClass("md:block");
	expect(screen.getByTestId("calendar-mobile-controls")).toHaveClass("md:hidden");
	expect(screen.getByRole("button", { name: /filter.*legende|filters.*legend/i })).toBeInTheDocument();
	expect(screen.getAllByTestId("calendar-filters")).toHaveLength(2);
	expect(screen.getAllByTestId("calendar-legend")).toHaveLength(2);
});
```

- [ ] **Step 2: Run the failing calendar test**

Run:

```bash
pnpm vitest apps/webapp/src/components/calendar/calendar-view.test.tsx --run
```

Expected: FAIL because `calendar-desktop-controls`, `calendar-mobile-controls`, and the mobile sheet trigger do not exist yet.

- [ ] **Step 3: Implement the mobile controls sheet**

In `apps/webapp/src/components/calendar/calendar-view.tsx`, add imports:

```tsx
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
```

Add state near the other dialog state:

```tsx
const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
```

Replace the current sidebar block with this structure:

```tsx
{viewMode !== "year" && (
	<div className="space-y-4 order-2 md:order-1">
		<CalendarEmployeeSelector
			currentEmployeeId={currentEmployeeId}
			selectedEmployeeId={selectedEmployeeId}
			onEmployeeChange={handleEmployeeChange}
			isManagerOrAbove={isManagerOrAbove}
		/>
		<WorkBalanceCard balance={workBalance} compact />

		<div data-testid="calendar-desktop-controls" className="hidden space-y-4 md:block">
			<CalendarFiltersComponent
				filters={filters}
				onFiltersChange={setFilters}
				currentEmployeeId={currentEmployeeId}
			/>
			<CalendarLegend />
		</div>

		<div data-testid="calendar-mobile-controls" className="md:hidden">
			<Sheet open={mobileControlsOpen} onOpenChange={setMobileControlsOpen}>
				<SheetTrigger asChild>
					<Button type="button" variant="outline" className="w-full justify-start gap-2">
						<IconAdjustmentsHorizontal className="size-4" />
						Filter & Legende
					</Button>
				</SheetTrigger>
				<SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto p-0">
					<SheetHeader className="border-b px-4 py-3 text-left">
						<SheetTitle>Filter & Legende</SheetTitle>
						<SheetDescription>
							Steuere, welche Kalendereinträge sichtbar sind.
						</SheetDescription>
					</SheetHeader>
					<div className="space-y-4 p-4">
						<CalendarFiltersComponent
							filters={filters}
							onFiltersChange={setFilters}
							currentEmployeeId={currentEmployeeId}
						/>
						<CalendarLegend />
					</div>
				</SheetContent>
			</Sheet>
		</div>
	</div>
)}
```

- [ ] **Step 4: Run the calendar test to verify it passes**

Run:

```bash
pnpm vitest apps/webapp/src/components/calendar/calendar-view.test.tsx --run
```

Expected: PASS for the new test and existing calendar view tests.

### Task 2: Employee Selector Full-Height List

**Files:**
- Modify: `apps/webapp/src/components/employee-select/employee-select-modal.tsx`
- Test: `apps/webapp/src/components/employee-select/employee-select-modal.test.tsx`

- [ ] **Step 1: Write the failing employee selector layout test**

If `apps/webapp/src/components/employee-select/employee-select-modal.test.tsx` does not exist, create it with this source-level regression test:

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("EmployeeSelectModal layout", () => {
	it("lets the employee list fill the available sheet height", () => {
		const source = readFileSync(
			resolve(__dirname, "employee-select-modal.tsx"),
			"utf8",
		);

		expect(source).not.toContain("max-h-[320px]");
		expect(source).toContain("flex-1 min-h-0 overflow-y-auto");
	});
});
```

- [ ] **Step 2: Run the failing employee selector test**

Run:

```bash
pnpm vitest apps/webapp/src/components/employee-select/employee-select-modal.test.tsx --run
```

Expected: FAIL because `employee-select-modal.tsx` still contains `max-h-[320px]` and does not contain `flex-1 min-h-0 overflow-y-auto` on the list.

- [ ] **Step 3: Implement the full-height list layout**

In `apps/webapp/src/components/employee-select/employee-select-modal.tsx`, change the `CommandPrimitive` className from:

```tsx
className={cn(
	"bg-popover text-popover-foreground flex h-full flex-col overflow-hidden",
	"border-0",
)}
```

to:

```tsx
className={cn(
	"bg-popover text-popover-foreground flex h-full min-h-0 flex-col overflow-hidden",
	"border-0",
)}
```

Change the `CommandPrimitive.List` className from:

```tsx
className="max-h-[320px] overflow-y-auto overflow-x-hidden scroll-py-2 p-2"
```

to:

```tsx
className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-py-2 p-2"
```

- [ ] **Step 4: Run the employee selector test to verify it passes**

Run:

```bash
pnpm vitest apps/webapp/src/components/employee-select/employee-select-modal.test.tsx --run
```

Expected: PASS.

### Task 3: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Verify: `apps/webapp/src/components/employee-select/employee-select-modal.tsx`
- Verify: `docs/superpowers/specs/2026-06-02-calendar-mobile-controls-employee-selector-design.md`

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm vitest apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/components/employee-select/employee-select-modal.test.tsx --run
```

Expected: PASS.

- [ ] **Step 2: Run type/lint check available in the repo**

Run:

```bash
pnpm lint
```

Expected: PASS, or document any pre-existing unrelated failures with file paths.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git diff -- apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/components/employee-select/employee-select-modal.tsx apps/webapp/src/components/employee-select/employee-select-modal.test.tsx docs/superpowers/specs/2026-06-02-calendar-mobile-controls-employee-selector-design.md docs/superpowers/plans/2026-06-02-calendar-mobile-controls-employee-selector.md
```

Expected: Diff only contains the approved mobile controls, employee selector height fix, tests, spec, and plan.

## Self-Review

- Spec coverage: Task 1 covers the mobile-only filter and legend sheet while preserving desktop sidebar behavior. Task 2 covers the shared employee selector sheet height. Task 3 covers verification.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: The plan uses existing component names and prop names from `CalendarView`, `CalendarFiltersComponent`, `CalendarLegend`, and `EmployeeSelectModal`.
