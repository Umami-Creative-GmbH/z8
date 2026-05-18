# Dashboard Masonry Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the dashboard widget area to a responsive masonry-style column layout, remove the above-grid customize gap, and keep reliable widget reordering through the dashboard customize menu.

**Architecture:** Keep the change inside the existing dashboard component boundary. Use CSS columns for masonry, apply `break-inside-avoid` to each widget wrapper, mirror the layout in the loading skeleton, disable direct card drag handles, move the customize trigger into `SiteHeader` for dashboard routes only, and expose up/down reorder controls inside `DashboardCustomizeMenu`.

**Tech Stack:** Next.js client components, React, Tailwind CSS container query variants, Vitest, Testing Library, `@dnd-kit`.

---

## File Structure

- Modify `apps/webapp/src/components/dashboard/dashboard-widget.tsx`: add a `draggable` prop, hide the drag handle when disabled, and add masonry-safe wrapper classes.
- Modify `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx`: switch the dashboard container from CSS grid rows to CSS column masonry and pass `draggable={false}` into child `DashboardWidget` components.
- Modify `apps/webapp/src/components/section-cards.tsx`: update `SectionCardsSkeleton` to use the same responsive masonry column container.
- Modify `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx`: add visible-widget reorder controls alongside existing visibility toggles and reset.
- Modify `apps/webapp/src/components/site-header.tsx`: render the dashboard customize trigger before the notification bell only on dashboard routes.
- Create `apps/webapp/src/components/site-header.test.tsx`: assert dashboard-only customize trigger placement.
- Create `apps/webapp/src/components/dashboard/sortable-widget-grid.test.tsx`: assert the masonry container classes render and drag handles are not shown in masonry mode.
- Create `apps/webapp/src/components/dashboard/dashboard-widget.test.tsx`: assert widget wrappers avoid column breaks and disabled drag handles are not focusable or visible.

## Implementation Tasks

### Task 1: Add Tests For DashboardWidget Masonry Wrapper And Disabled Drag

**Files:**
- Create: `apps/webapp/src/components/dashboard/dashboard-widget.test.tsx`
- Modify later: `apps/webapp/src/components/dashboard/dashboard-widget.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/webapp/src/components/dashboard/dashboard-widget.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardWidget } from "./dashboard-widget";

vi.mock("./widget-visibility-context", () => ({
	useRegisterVisibleWidget: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: { role: "button" },
		listeners: { onPointerDown: vi.fn() },
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));

vi.mock("@dnd-kit/utilities", () => ({
	CSS: {
		Translate: {
			toString: () => undefined,
		},
	},
}));

describe("DashboardWidget", () => {
	it("renders as a masonry item that avoids column breaks", () => {
		render(
			<DashboardWidget id="quick-stats">
				<div>Time tracking content</div>
			</DashboardWidget>,
		);

		const widget = screen.getByText("Time tracking content").closest("[data-widget-id]");

		expect(widget?.className).toContain("break-inside-avoid");
		expect(widget?.className).toContain("mb-4");
	});

	it("does not expose a drag handle when dragging is disabled", () => {
		render(
			<DashboardWidget draggable={false} id="quick-stats">
				<div>Time tracking content</div>
			</DashboardWidget>,
		);

		expect(screen.queryByRole("button", { name: "Drag to reorder widget" })).toBeNull();
	});
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/dashboard/dashboard-widget.test.tsx
```

Expected: FAIL because `DashboardWidget` does not accept `draggable` and does not include `break-inside-avoid` or `mb-4`.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add apps/webapp/src/components/dashboard/dashboard-widget.test.tsx
git commit -m "test: cover dashboard widget masonry wrapper"
```

Expected: a commit containing only the new failing test.

### Task 2: Implement DashboardWidget Masonry Wrapper And Drag Toggle

**Files:**
- Modify: `apps/webapp/src/components/dashboard/dashboard-widget.tsx`
- Test: `apps/webapp/src/components/dashboard/dashboard-widget.test.tsx`

- [ ] **Step 1: Update the component props and wrapper classes**

In `apps/webapp/src/components/dashboard/dashboard-widget.tsx`, replace the props interface and function signature with:

```tsx
interface DashboardWidgetProps {
	/** Unique widget ID for sorting */
	id: WidgetId;
	/** Widget content - if null/undefined, widget won't render */
	children: ReactNode;
	/** Whether this widget can be reordered with drag-and-drop */
	draggable?: boolean;
}

export function DashboardWidget({ id, children, draggable = true }: DashboardWidgetProps) {
```

Replace the wrapper `className` on the outer `<div>` with:

```tsx
className={cn("relative group mb-4 break-inside-avoid", isDragging && "z-50")}
```

- [ ] **Step 2: Hide the drag handle when dragging is disabled**

In `apps/webapp/src/components/dashboard/dashboard-widget.tsx`, wrap the existing `<Button>` drag handle in this conditional:

```tsx
{draggable ? (
	<Button
		variant="ghost"
		size="icon"
		className={cn(
			"absolute -top-2 -right-2 z-10 size-7",
			"opacity-0 group-hover:opacity-100 transition-opacity",
			"bg-background border shadow-sm",
			"cursor-grab active:cursor-grabbing",
			"hover:bg-muted",
			isDragging && "opacity-100 cursor-grabbing",
		)}
		{...attributes}
		{...listeners}
		aria-label="Drag to reorder widget"
	>
		<IconGripVertical className="size-4 text-muted-foreground" aria-hidden="true" />
	</Button>
) : null}
```

Keep `{children}` immediately after the conditional.

- [ ] **Step 3: Run the dashboard widget test**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/dashboard/dashboard-widget.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add apps/webapp/src/components/dashboard/dashboard-widget.tsx apps/webapp/src/components/dashboard/dashboard-widget.test.tsx
git commit -m "feat: prepare dashboard widgets for masonry layout"
```

Expected: a commit containing the widget wrapper and drag-toggle implementation.

### Task 3: Add Tests For SortableWidgetGrid Masonry Container

**Files:**
- Create: `apps/webapp/src/components/dashboard/sortable-widget-grid.test.tsx`
- Modify later: `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/webapp/src/components/dashboard/sortable-widget-grid.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DashboardWidget } from "./dashboard-widget";
import { SortableWidgetGrid } from "./sortable-widget-grid";

vi.mock("@dnd-kit/core", () => ({
	closestCenter: vi.fn(),
	DndContext: ({ children }: { children: ReactNode }) => <div data-testid="dnd-context">{children}</div>,
	DragOverlay: ({ children }: { children: ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
	KeyboardSensor: vi.fn(),
	MouseSensor: vi.fn(),
	TouchSensor: vi.fn(),
	useSensor: vi.fn(() => ({})),
	useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
	arrayMove: (items: unknown[], oldIndex: number, newIndex: number) => {
		const nextItems = [...items];
		const [item] = nextItems.splice(oldIndex, 1);
		nextItems.splice(newIndex, 0, item);
		return nextItems;
	},
	rectSortingStrategy: vi.fn(),
	SortableContext: ({ children }: { children: ReactNode }) => (
		<div data-testid="sortable-context">{children}</div>
	),
	useSortable: () => ({
		attributes: { role: "button" },
		listeners: { onPointerDown: vi.fn() },
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));

vi.mock("@dnd-kit/utilities", () => ({
	CSS: {
		Translate: {
			toString: () => undefined,
		},
	},
}));

vi.mock("./widget-visibility-context", () => ({
	useRegisterVisibleWidget: vi.fn(),
	useVisibleWidgets: () => ["quick-stats", "presence-status"],
}));

describe("SortableWidgetGrid", () => {
	it("renders widgets in a responsive masonry column container", () => {
		render(
			<SortableWidgetGrid onReorder={vi.fn()} widgetOrder={["quick-stats", "presence-status"]}>
				<DashboardWidget id="quick-stats">Time tracking</DashboardWidget>
				<DashboardWidget id="presence-status">Presence status</DashboardWidget>
			</SortableWidgetGrid>,
		);

		const container = screen.getByText("Time tracking").closest(".columns-1");

		expect(container?.className).toContain("columns-1");
		expect(container?.className).toContain("@xl/main:columns-2");
		expect(container?.className).toContain("@5xl/main:columns-3");
		expect(container?.className).toContain("gap-4");
		expect(container?.className).not.toContain("grid-cols");
	});

	it("does not expose drag handles in masonry mode", () => {
		render(
			<SortableWidgetGrid onReorder={vi.fn()} widgetOrder={["quick-stats", "presence-status"]}>
				<DashboardWidget id="quick-stats">Time tracking</DashboardWidget>
				<DashboardWidget id="presence-status">Presence status</DashboardWidget>
			</SortableWidgetGrid>,
		);

		expect(screen.queryByRole("button", { name: "Drag to reorder widget" })).toBeNull();
	});
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/dashboard/sortable-widget-grid.test.tsx
```

Expected: FAIL because the grid still uses `grid-cols` classes and does not disable child drag handles.

- [ ] **Step 3: Commit the failing test**

Run:

```bash
git add apps/webapp/src/components/dashboard/sortable-widget-grid.test.tsx
git commit -m "test: cover dashboard masonry grid container"
```

Expected: a commit containing only the new failing grid test.

### Task 4: Implement CSS Column Masonry In SortableWidgetGrid

**Files:**
- Modify: `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx`
- Test: `apps/webapp/src/components/dashboard/sortable-widget-grid.test.tsx`

- [ ] **Step 1: Import React helpers needed to clone dashboard widgets**

In `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx`, replace the React import with:

```tsx
import { Children, cloneElement, isValidElement, type ReactNode, useId, useState } from "react";
```

- [ ] **Step 2: Add a helper that disables drag handles for masonry children**

In `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx`, add this helper above `export function SortableWidgetGrid`:

```tsx
function renderMasonryChildren(children: ReactNode) {
	return Children.map(children, (child) => {
		if (!isValidElement<{ draggable?: boolean }>(child)) {
			return child;
		}

		return cloneElement(child, { draggable: false });
	});
}
```

- [ ] **Step 3: Replace the grid container with CSS columns**

In `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx`, replace this block:

```tsx
<div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 lg:px-6 items-start">
	{children}
</div>
```

with:

```tsx
<div className="columns-1 @xl/main:columns-2 @5xl/main:columns-3 gap-4 px-4 lg:px-6">
	{renderMasonryChildren(children)}
</div>
```

- [ ] **Step 4: Run the grid test**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/dashboard/sortable-widget-grid.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the widget test again**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/dashboard/dashboard-widget.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the masonry grid implementation**

Run:

```bash
git add apps/webapp/src/components/dashboard/sortable-widget-grid.tsx apps/webapp/src/components/dashboard/sortable-widget-grid.test.tsx
git commit -m "feat: use masonry columns for dashboard widgets"
```

Expected: a commit containing the CSS column masonry grid implementation.

### Task 5: Update The Loading Skeleton To Match Masonry

**Files:**
- Modify: `apps/webapp/src/components/section-cards.tsx`
- Test manually: dashboard loading state and existing dashboard tests

- [ ] **Step 1: Update the skeleton container classes**

In `apps/webapp/src/components/section-cards.tsx`, replace the `SectionCardsSkeleton` container:

```tsx
<div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 lg:px-6 items-start">
```

with:

```tsx
<div className="columns-1 @xl/main:columns-2 @5xl/main:columns-3 gap-4 px-4 lg:px-6">
```

- [ ] **Step 2: Update the skeleton card wrapper classes**

In `apps/webapp/src/components/section-cards.tsx`, replace the `WidgetSkeleton` outer `<div>` class:

```tsx
className="rounded-xl border bg-card p-6"
```

with:

```tsx
className="mb-4 break-inside-avoid rounded-xl border bg-card p-6"
```

- [ ] **Step 3: Run related dashboard component tests**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/dashboard/dashboard-widget.test.tsx src/components/dashboard/sortable-widget-grid.test.tsx src/components/dashboard/dashboard-customize-menu.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit the skeleton update**

Run:

```bash
git add apps/webapp/src/components/section-cards.tsx
git commit -m "feat: align dashboard skeleton with masonry layout"
```

Expected: a commit containing only the skeleton layout update.

### Task 6: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/dashboard/dashboard-widget.tsx`
- Verify: `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx`
- Verify: `apps/webapp/src/components/section-cards.tsx`
- Verify: `apps/webapp/src/components/dashboard/dashboard-widget.test.tsx`
- Verify: `apps/webapp/src/components/dashboard/sortable-widget-grid.test.tsx`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @z8/webapp test -- src/components/dashboard/dashboard-widget.test.tsx src/components/dashboard/sortable-widget-grid.test.tsx src/components/dashboard/dashboard-customize-menu.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the broader test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 4: Manual responsive check**

Run:

```bash
pnpm dev
```

Expected: the dev server starts successfully. Open the dashboard and verify these states:

- Mobile width: widgets stack in one column.
- Medium dashboard width: widgets pack into two columns.
- Wide dashboard width: widgets pack into three columns.
- Widget cards keep their natural heights and do not split across columns.
- The customization menu still opens, hides widgets, re-shows widgets, and resets the layout.
- If all widgets are hidden, the existing empty state appears.
- No drag handle is visible or focusable on dashboard widgets.

- [ ] **Step 5: Commit any final fixes from verification**

If verification required fixes, run:

```bash
git add apps/webapp/src/components/dashboard/dashboard-widget.tsx apps/webapp/src/components/dashboard/sortable-widget-grid.tsx apps/webapp/src/components/section-cards.tsx apps/webapp/src/components/dashboard/dashboard-widget.test.tsx apps/webapp/src/components/dashboard/sortable-widget-grid.test.tsx
git commit -m "fix: verify dashboard masonry layout"
```

Expected: commit only if verification changed files. If no files changed, skip this commit.

## Self-Review

- Spec coverage: The plan covers CSS column masonry, responsive one/two/three-column behavior, preserved visibility/reset data flow, drag disabled when unreliable, skeleton alignment, tests, and manual verification.
- Placeholder scan: The plan contains concrete file paths, commands, code snippets, expected test outcomes, and commit messages.
- Type consistency: The new `draggable?: boolean` prop is introduced in `DashboardWidgetProps` and passed through a typed `isValidElement<{ draggable?: boolean }>(child)` guard before `cloneElement(child, { draggable: false })` from `SortableWidgetGrid`.

## Follow-Up Implementation Tasks

These tasks extend the approved masonry implementation with dashboard-only header placement and reliable menu-based reordering. Execute them after Task 5 and before final verification.

### Task 7: Add Reorder Tests To DashboardCustomizeMenu

**Files:**
- Modify: `apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx`
- Modify later: `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx`

- [ ] **Step 1: Replace the test file with reorder coverage**

Replace `apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx` with:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardCustomizeMenu } from "./dashboard-customize-menu";
import { DEFAULT_WIDGET_ORDER, type WidgetId } from "./widget-registry";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string>) =>
			values?.widget ? fallback.replace("{widget}", values.widget) : fallback,
	}),
}));

const visibleWidgetOrder: WidgetId[] = ["quick-stats", "presence-status", "vacation-balance"];

function renderMenu(props: Partial<React.ComponentProps<typeof DashboardCustomizeMenu>> = {}) {
	return render(
		<DashboardCustomizeMenu
			hiddenWidgets={[]}
			onReorder={vi.fn()}
			onReset={vi.fn()}
			onVisibilityChange={vi.fn()}
			visibleWidgetOrder={visibleWidgetOrder}
			{...props}
		/>,
	);
}

function openMenu() {
	fireEvent.pointerDown(screen.getByRole("button", { name: "Customize dashboard" }));
}

describe("DashboardCustomizeMenu", () => {
	it("renders an icon-only accessible trigger", () => {
		renderMenu();

		const trigger = screen.getByRole("button", { name: "Customize dashboard" });
		expect(trigger).toBeTruthy();
		expect(trigger.textContent).toBe("");
	});

	it("calls visibility changes from widget rows", () => {
		const onVisibilityChange = vi.fn();

		renderMenu({ hiddenWidgets: ["quick-stats"], onVisibilityChange });

		openMenu();
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Time Tracking" }));

		expect(onVisibilityChange).toHaveBeenCalledWith("quick-stats", true);
	});

	it("calls reset from the reset menu item", () => {
		const onReset = vi.fn();

		renderMenu({ onReset });

		openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "Reset layout" }));

		expect(onReset).toHaveBeenCalledTimes(1);
	});

	it("moves a visible widget up", () => {
		const onReorder = vi.fn();

		renderMenu({ onReorder });

		openMenu();
		const row = screen.getByTestId("dashboard-widget-menu-row-presence-status");
		fireEvent.click(within(row).getByRole("button", { name: "Move Presence Status up" }));

		expect(onReorder).toHaveBeenCalledWith(["presence-status", "quick-stats", "vacation-balance"]);
	});

	it("moves a visible widget down", () => {
		const onReorder = vi.fn();

		renderMenu({ onReorder });

		openMenu();
		const row = screen.getByTestId("dashboard-widget-menu-row-presence-status");
		fireEvent.click(within(row).getByRole("button", { name: "Move Presence Status down" }));

		expect(onReorder).toHaveBeenCalledWith(["quick-stats", "vacation-balance", "presence-status"]);
	});

	it("disables invalid first and last visible widget moves", () => {
		renderMenu();

		openMenu();
		const firstRow = screen.getByTestId("dashboard-widget-menu-row-quick-stats");
		const lastRow = screen.getByTestId("dashboard-widget-menu-row-vacation-balance");

		expect(
			(within(firstRow).getByRole("button", { name: "Move Time Tracking up" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(
				within(lastRow).getByRole("button", {
					name: "Move Vacation Balance down",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("keeps hidden widgets toggleable without active reorder controls", () => {
		renderMenu({ hiddenWidgets: ["quick-stats"] });

		openMenu();
		const hiddenRow = screen.getByTestId("dashboard-widget-menu-row-quick-stats");

		expect(screen.getByRole("menuitemcheckbox", { name: "Time Tracking" })).toBeTruthy();
		expect(within(hiddenRow).queryByRole("button", { name: "Move Time Tracking up" })).toBeNull();
		expect(within(hiddenRow).queryByRole("button", { name: "Move Time Tracking down" })).toBeNull();
	});

	it("reorders any visible widget list passed to the menu", () => {
		const onReorder = vi.fn();

		renderMenu({ onReorder, visibleWidgetOrder: DEFAULT_WIDGET_ORDER.slice(0, 3) });

		openMenu();
		const row = screen.getByTestId("dashboard-widget-menu-row-managed-employees");
		fireEvent.click(within(row).getByRole("button", { name: "Move Managed Employees up" }));

		expect(onReorder).toHaveBeenCalledWith([
			"managed-employees",
			"manager-today",
			"pending-approvals",
		]);
	});
});
```

- [ ] **Step 2: Run the menu test to verify it fails**

Run from `apps/webapp`:

```bash
pnpm test src/components/dashboard/dashboard-customize-menu.test.tsx
```

Expected: FAIL because `DashboardCustomizeMenu` does not yet accept `visibleWidgetOrder` or `onReorder`, does not render reorder controls, and does not expose row test IDs.

- [ ] **Step 3: Commit the failing test**

Run from the worktree root:

```bash
git add apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx
git commit -m "test: cover dashboard menu reordering"
```

Expected: a commit containing only the updated menu test.

### Task 8: Implement Reorder Controls In DashboardCustomizeMenu

**Files:**
- Modify: `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx`
- Test: `apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx`

- [ ] **Step 1: Update imports**

In `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx`, replace the Tabler import with:

```tsx
import { IconAdjustmentsHorizontal, IconArrowDown, IconArrowUp } from "@tabler/icons-react";
```

- [ ] **Step 2: Update props**

Replace `DashboardCustomizeMenuProps` with:

```tsx
interface DashboardCustomizeMenuProps {
	hiddenWidgets: WidgetId[];
	visibleWidgetOrder: WidgetId[];
	onReorder: (newOrder: WidgetId[]) => void;
	onVisibilityChange: (widgetId: WidgetId, visible: boolean) => void;
	onReset: () => void;
}
```

Update the function destructuring to include `visibleWidgetOrder` and `onReorder`:

```tsx
export function DashboardCustomizeMenu({
	hiddenWidgets,
	visibleWidgetOrder,
	onReorder,
	onVisibilityChange,
	onReset,
}: DashboardCustomizeMenuProps) {
```

- [ ] **Step 3: Add reorder helper functions inside the component**

After `hiddenWidgetSet`, add:

```tsx
	const visibleIndexByWidget = new Map(
		visibleWidgetOrder.map((widgetId, index) => [widgetId, index] as const),
	);

	function moveWidget(widgetId: WidgetId, direction: "up" | "down") {
		const currentIndex = visibleIndexByWidget.get(widgetId);
		if (currentIndex === undefined) return;

		const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
		if (nextIndex < 0 || nextIndex >= visibleWidgetOrder.length) return;

		const nextOrder = [...visibleWidgetOrder];
		const [movedWidget] = nextOrder.splice(currentIndex, 1);
		nextOrder.splice(nextIndex, 0, movedWidget);
		onReorder(nextOrder);
	}
```

- [ ] **Step 4: Replace the widget row rendering**

Replace the current `WIDGET_CONFIGS.map` return block with:

```tsx
{WIDGET_CONFIGS.map((widget) => {
	const visible = !hiddenWidgetSet.has(widget.id);
	const visibleIndex = visibleIndexByWidget.get(widget.id);
	const label = t(widget.labelKey, widget.label);
	const canMoveUp = visible && visibleIndex !== undefined && visibleIndex > 0;
	const canMoveDown =
		visible && visibleIndex !== undefined && visibleIndex < visibleWidgetOrder.length - 1;

	return (
		<div
			className="flex items-center gap-1 px-2 py-1"
			data-testid={`dashboard-widget-menu-row-${widget.id}`}
			key={widget.id}
		>
			<DropdownMenuCheckboxItem
				checked={visible}
				className="min-w-0 flex-1"
				onCheckedChange={(checked) => onVisibilityChange(widget.id, checked === true)}
				onSelect={(event) => event.preventDefault()}
			>
				<span className="truncate">{label}</span>
			</DropdownMenuCheckboxItem>
			{visible ? (
				<div className="flex shrink-0 items-center gap-1">
					<Button
						aria-label={t("dashboard.customize.move-up", "Move {widget} up", {
							widget: label,
						})}
						disabled={!canMoveUp}
						onClick={(event) => {
							event.preventDefault();
							moveWidget(widget.id, "up");
						}}
						size="icon"
						variant="ghost"
						className="size-7"
					>
						<IconArrowUp className="size-3.5" aria-hidden="true" />
					</Button>
					<Button
						aria-label={t("dashboard.customize.move-down", "Move {widget} down", {
							widget: label,
						})}
						disabled={!canMoveDown}
						onClick={(event) => {
							event.preventDefault();
							moveWidget(widget.id, "down");
						}}
						size="icon"
						variant="ghost"
						className="size-7"
					>
						<IconArrowDown className="size-3.5" aria-hidden="true" />
					</Button>
				</div>
			) : null}
		</div>
	);
})}
```

- [ ] **Step 5: Run the menu test**

Run from `apps/webapp`:

```bash
pnpm test src/components/dashboard/dashboard-customize-menu.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the implementation**

Run from the worktree root:

```bash
git add apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx
git commit -m "feat: reorder dashboard widgets from customize menu"
```

Expected: a commit containing only menu reorder implementation and its tests.

### Task 9: Move Dashboard Customize Trigger Into SiteHeader

**Files:**
- Create: `apps/webapp/src/components/site-header.test.tsx`
- Modify: `apps/webapp/src/components/site-header.tsx`
- Modify: `apps/webapp/src/components/section-cards.tsx`

- [ ] **Step 1: Add failing header tests**

Create `apps/webapp/src/components/site-header.test.tsx` with:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./site-header";

let pathname = "/";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/navigation", () => ({
	usePathname: () => pathname,
}));

vi.mock("@/components/providers/user-preferences-provider", () => ({
	useTimeFormat: () => "24h",
}));

vi.mock("@/components/notifications", () => ({
	NotificationBell: () => <button type="button">Notifications</button>,
}));

vi.mock("@/components/time-tracking/time-clock-popover", () => ({
	TimeClockPopover: () => <button type="button">Clock In</button>,
}));

vi.mock("@/components/ui/sidebar", () => ({
	SidebarTrigger: () => <button type="button">Toggle sidebar</button>,
}));

vi.mock("@/components/dashboard/dashboard-header-customize", () => ({
	DashboardHeaderCustomize: () => <button type="button">Customize dashboard</button>,
}));

describe("SiteHeader", () => {
	it("shows the dashboard customize trigger before notifications on the dashboard route", () => {
		pathname = "/en";

		render(<SiteHeader />);

		const buttons = screen.getAllByRole("button").map((button) => button.textContent);
		expect(buttons).toEqual([
			"Toggle sidebar",
			"Customize dashboard",
			"Notifications",
			"Clock In",
		]);
	});

	it("does not show the dashboard customize trigger outside the dashboard route", () => {
		pathname = "/en/time-tracking";

		render(<SiteHeader />);

		expect(screen.queryByRole("button", { name: "Customize dashboard" })).toBeNull();
		expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the header test to verify it fails**

Run from `apps/webapp`:

```bash
pnpm test src/components/site-header.test.tsx
```

Expected: FAIL because `DashboardHeaderCustomize` does not exist and `SiteHeader` does not render it.

- [ ] **Step 3: Create a header customize component**

Create `apps/webapp/src/components/dashboard/dashboard-header-customize.tsx` with:

```tsx
"use client";

import { DashboardCustomizeMenu } from "@/components/dashboard/dashboard-customize-menu";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";

export function DashboardHeaderCustomize() {
	const { visibleWidgetOrder, hiddenWidgets, onReorder, onVisibilityChange, resetOrder, isLoading } =
		useWidgetOrder();

	if (isLoading) {
		return null;
	}

	return (
		<DashboardCustomizeMenu
			hiddenWidgets={hiddenWidgets}
			onReorder={onReorder}
			onReset={resetOrder}
			onVisibilityChange={onVisibilityChange}
			visibleWidgetOrder={visibleWidgetOrder}
		/>
	);
}
```

- [ ] **Step 4: Update SiteHeader to render the dashboard-only trigger**

In `apps/webapp/src/components/site-header.tsx`, add this import:

```tsx
import { DashboardHeaderCustomize } from "@/components/dashboard/dashboard-header-customize";
```

After `const pathname = usePathname();`, add:

```tsx
	const normalizedPath = pathname.replace(/^\/[a-z]{2}(\/|$)/, "/");
	const isDashboardRoute = normalizedPath === "/" || normalizedPath === "";
```

In the header action group, replace:

```tsx
<NotificationBell />
```

with:

```tsx
{isDashboardRoute ? <DashboardHeaderCustomize /> : null}
<NotificationBell />
```

- [ ] **Step 5: Remove the above-grid customize row from SectionCards**

In `apps/webapp/src/components/section-cards.tsx`, remove the `DashboardCustomizeMenu` import.

In `DashboardWidgetLayout`, remove `hiddenWidgets` and `onVisibilityChange` from the props and from the call site. Keep `resetOrder` because `HiddenWidgetsEmptyState` still uses it.

Replace the fragment section:

```tsx
<div className="mb-3 flex justify-end px-4 lg:px-6">
	<DashboardCustomizeMenu
		hiddenWidgets={hiddenWidgets}
		onReset={resetOrder}
		onVisibilityChange={onVisibilityChange}
	/>
</div>
```

with no markup. The returned fragment should begin directly with:

```tsx
{hasConfiguredWidgets ? (
	<SortableWidgetGrid widgetOrder={visibleWidgetOrder} onReorder={onReorder}>
```

Keep `resetOrder` in `DashboardWidgetLayout` because `HiddenWidgetsEmptyState` uses it.

- [ ] **Step 6: Run targeted tests**

Run from `apps/webapp`:

```bash
pnpm test src/components/site-header.test.tsx src/components/dashboard/dashboard-customize-menu.test.tsx src/components/dashboard/sortable-widget-grid.test.tsx src/components/dashboard/dashboard-widget.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the header move**

Run from the worktree root:

```bash
git add apps/webapp/src/components/site-header.tsx apps/webapp/src/components/site-header.test.tsx apps/webapp/src/components/dashboard/dashboard-header-customize.tsx apps/webapp/src/components/section-cards.tsx
git commit -m "feat: move dashboard customization to header"
```

Expected: a commit containing only the header placement change, new header adapter, removed above-grid row, and header tests.

### Task 10: Final Verification For Header Reorder Follow-Up

**Files:**
- Verify: `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx`
- Verify: `apps/webapp/src/components/dashboard/dashboard-header-customize.tsx`
- Verify: `apps/webapp/src/components/site-header.tsx`
- Verify: `apps/webapp/src/components/section-cards.tsx`

- [ ] **Step 1: Run focused dashboard/header tests**

Run from `apps/webapp`:

```bash
pnpm test src/components/site-header.test.tsx src/components/dashboard/dashboard-customize-menu.test.tsx src/components/dashboard/dashboard-widget.test.tsx src/components/dashboard/sortable-widget-grid.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full tests and record known environment status**

Run from the worktree root:

```bash
pnpm test
```

Expected: PASS if the local Better Auth secret environment is configured. If it fails with `BetterAuthError: Empty secret value for version 1 in secrets`, record it as an existing environment blocker and do not modify unrelated auth code.

- [ ] **Step 3: Run production build and record known environment status**

Run from the worktree root:

```bash
CI=true pnpm build
```

Expected: PASS if the local mobile/build environment is configured. If it fails in unrelated mobile Expo/React Native bundling before webapp completion, record the exact failure and do not modify unrelated mobile code.

- [ ] **Step 4: Manual browser verification**

Run from the worktree root:

```bash
pnpm dev
```

Expected: the dev server starts. Verify in a browser:

- Dashboard route: customize trigger appears before the notification bell.
- Non-dashboard routes: customize trigger is not visible.
- Dashboard widgets start directly below the header/content area with no above-grid customize spacer.
- Menu visibility toggles still hide and re-show widgets.
- Menu move up/down changes visible widget order and persists after reload.
- First visible widget cannot move up, last visible widget cannot move down.
- Hidden widgets remain toggleable and do not show active move controls.
- Mobile, medium, and wide masonry columns still pack widgets correctly.

- [ ] **Step 5: Commit any final fixes from verification**

If verification required fixes, run:

```bash
git add apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx apps/webapp/src/components/dashboard/dashboard-header-customize.tsx apps/webapp/src/components/site-header.tsx apps/webapp/src/components/section-cards.tsx apps/webapp/src/components/site-header.test.tsx apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx
git commit -m "fix: verify dashboard header customization"
```

Expected: commit only if verification changed files. If no files changed, skip this commit.

## Follow-Up Self-Review

- Spec coverage: The follow-up tasks cover header-only dashboard trigger placement, removal of the above-grid customize row, menu-based reorder controls, disabled invalid moves, hidden widget behavior, focused tests, and manual verification.
- Placeholder scan: The follow-up plan contains concrete file paths, commands, code snippets, expected outcomes, and commit messages.
- Type consistency: `DashboardCustomizeMenu` receives `visibleWidgetOrder: WidgetId[]`, `onReorder: (newOrder: WidgetId[]) => void`, `hiddenWidgets: WidgetId[]`, `onVisibilityChange`, and `onReset`; `DashboardHeaderCustomize` obtains those values from `useWidgetOrder` and passes them through unchanged.
