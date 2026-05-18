# Dashboard Masonry Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the dashboard widget area to a responsive masonry-style column layout so widgets pack vertically with minimal empty space.

**Architecture:** Keep the change inside the existing dashboard component boundary. Use CSS columns for masonry, apply `break-inside-avoid` to each widget wrapper, mirror the layout in the loading skeleton, and disable widget drag handles because the current `@dnd-kit` rect sorting strategy is not reliable with CSS column visual order.

**Tech Stack:** Next.js client components, React, Tailwind CSS container query variants, Vitest, Testing Library, `@dnd-kit`.

---

## File Structure

- Modify `apps/webapp/src/components/dashboard/dashboard-widget.tsx`: add a `draggable` prop, hide the drag handle when disabled, and add masonry-safe wrapper classes.
- Modify `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx`: switch the dashboard container from CSS grid rows to CSS column masonry and pass `draggable={false}` into child `DashboardWidget` components.
- Modify `apps/webapp/src/components/section-cards.tsx`: update `SectionCardsSkeleton` to use the same responsive masonry column container.
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
