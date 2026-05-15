# Dashboard Widget Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users hide and re-show dashboard widgets from an icon-only dashboard customization control while preserving the existing widget reordering behavior.

**Architecture:** Extend the existing `dashboard_widget_order` JSON preference with an optional `hidden` array, normalize layout state in the dashboard widget registry, and keep all persistence through the existing user settings server actions. Render an icon-only dropdown control above the widget grid; the grid maps only visible widgets while reset restores default order and clears hidden IDs.

**Tech Stack:** Next.js client components, React, TanStack Query, Drizzle JSONB user settings, Radix/shadcn dropdown menu, Tolgee translations, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/db/schema/types.ts` to add `hidden?: string[]` to `DashboardWidgetOrder`.
- Modify: `apps/webapp/src/components/dashboard/widget-registry.ts` to add widget display metadata and layout normalization helpers.
- Modify: `apps/webapp/src/components/dashboard/widget-registry.test.ts` to test order, hidden IDs, and visible-order normalization.
- Modify: `apps/webapp/src/components/dashboard/actions.ts` to persist the extended layout object.
- Modify: `apps/webapp/src/components/dashboard/use-widget-order.ts` to expose visible widget order, hidden widgets, visibility toggling, and reset behavior.
- Create: `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx` for the icon-only customization dropdown.
- Create: `apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx` for trigger/accessibility and callback coverage.
- Modify: `apps/webapp/src/components/section-cards.tsx` to render the menu, visible widgets, and all-hidden empty state.
- Modify: `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx` only if needed to keep prop names accurate after `SectionCards` switches to visible widget order.

---

### Task 1: Extend Widget Layout Types And Normalization

**Files:**
- Modify: `apps/webapp/src/db/schema/types.ts:89-93`
- Modify: `apps/webapp/src/components/dashboard/widget-registry.ts:1-86`
- Modify: `apps/webapp/src/components/dashboard/widget-registry.test.ts:1-14`

- [ ] **Step 1: Write failing normalization tests**

Replace `apps/webapp/src/components/dashboard/widget-registry.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
	DEFAULT_WIDGET_ORDER,
	mergeVisibleWidgetOrder,
	normalizeWidgetLayout,
	normalizeWidgetOrder,
	VALID_WIDGET_IDS,
	WIDGET_CONFIGS,
} from "./widget-registry";

describe("dashboard widget registry", () => {
	it("registers manager today near the front of the default order", () => {
		expect(DEFAULT_WIDGET_ORDER).toContain("manager-today");
		expect(DEFAULT_WIDGET_ORDER.indexOf("manager-today")).toBeLessThanOrEqual(1);
		expect(VALID_WIDGET_IDS.has("manager-today")).toBe(true);
	});

	it("adds manager today when normalizing an older saved order", () => {
		expect(normalizeWidgetOrder(["quick-stats", "presence-status"])).toContain("manager-today");
	});

	it("defines display metadata for every widget", () => {
		expect(WIDGET_CONFIGS.map((widget) => widget.id)).toEqual(DEFAULT_WIDGET_ORDER);
		expect(WIDGET_CONFIGS.every((widget) => widget.label.length > 0)).toBe(true);
		expect(WIDGET_CONFIGS.every((widget) => widget.labelKey.startsWith("dashboard.widgets."))).toBe(
			true,
		);
	});

	it("normalizes missing hidden widgets to an empty list", () => {
		expect(normalizeWidgetLayout({ order: ["quick-stats"], version: 1 })).toEqual({
			order: normalizeWidgetOrder(["quick-stats"]),
			hidden: [],
			version: 1,
		});
	});

	it("removes unknown and duplicate hidden widget ids", () => {
		expect(
			normalizeWidgetLayout({
				order: ["quick-stats", "quick-stats", "unknown-widget"],
				hidden: ["quick-stats", "unknown-widget", "quick-stats", "presence-status"],
				version: 1,
			}),
		).toEqual({
			order: normalizeWidgetOrder(["quick-stats"]),
			hidden: ["quick-stats", "presence-status"],
			version: 1,
		});
	});

	it("keeps new widgets visible by default", () => {
		const layout = normalizeWidgetLayout({
			order: ["quick-stats"],
			hidden: ["quick-stats"],
			version: 1,
		});

		expect(layout.order).toEqual(normalizeWidgetOrder(["quick-stats"]));
		expect(layout.hidden).toEqual(["quick-stats"]);
		expect(layout.order.filter((id) => !layout.hidden.includes(id))).toContain("manager-today");
	});

	it("merges reordered visible widgets without moving hidden widget slots", () => {
		expect(
			mergeVisibleWidgetOrder(
				["manager-today", "quick-stats", "presence-status", "whos-out-today"],
				["whos-out-today", "manager-today", "quick-stats"],
				["presence-status"],
			),
		).toEqual(["whos-out-today", "manager-today", "presence-status", "quick-stats"]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/components/dashboard/widget-registry.test.ts`

Expected: FAIL with errors that `mergeVisibleWidgetOrder`, `normalizeWidgetLayout`, and `WIDGET_CONFIGS` are not exported.

- [ ] **Step 3: Extend the persisted type**

In `apps/webapp/src/db/schema/types.ts`, replace the `DashboardWidgetOrder` type with:

```ts
// Type for dashboard widget order preferences
export type DashboardWidgetOrder = {
	order: string[];
	hidden?: string[];
	version: number;
};
```

- [ ] **Step 4: Implement registry metadata and normalization helpers**

Replace `apps/webapp/src/components/dashboard/widget-registry.ts` with:

```ts
import type { DashboardWidgetOrder } from "@/db/schema";

/**
 * Widget IDs used for dashboard widget ordering.
 * Each ID corresponds to a specific dashboard widget.
 */
export type WidgetId =
	| "manager-today"
	| "managed-employees"
	| "pending-approvals"
	| "team-overview"
	| "quick-stats"
	| "whos-out-today"
	| "upcoming-time-off"
	| "recently-approved"
	| "birthday-reminders"
	| "hydration"
	| "vacation-balance"
	| "presence-status";

/**
 * Default widget order for new users or when no preferences are set.
 * This order matches the original hardcoded layout in section-cards.tsx.
 */
export const DEFAULT_WIDGET_ORDER: WidgetId[] = [
	"manager-today",
	"managed-employees",
	"pending-approvals",
	"team-overview",
	"quick-stats",
	"presence-status",
	"whos-out-today",
	"upcoming-time-off",
	"recently-approved",
	"birthday-reminders",
	"hydration",
	"vacation-balance",
];

/**
 * Set of all valid widget IDs for validation.
 */
export const VALID_WIDGET_IDS = new Set<WidgetId>(DEFAULT_WIDGET_ORDER);

export interface WidgetConfig {
	id: WidgetId;
	label: string;
	labelKey: string;
}

export const WIDGET_CONFIGS: WidgetConfig[] = [
	{ id: "manager-today", label: "Manager Today", labelKey: "dashboard.widgets.manager-today" },
	{ id: "managed-employees", label: "Your Team", labelKey: "dashboard.widgets.managed-employees" },
	{ id: "pending-approvals", label: "Pending Approvals", labelKey: "dashboard.widgets.pending-approvals" },
	{ id: "team-overview", label: "Team Overview", labelKey: "dashboard.widgets.team-overview" },
	{ id: "quick-stats", label: "Time Tracking", labelKey: "dashboard.widgets.quick-stats" },
	{ id: "presence-status", label: "Presence Status", labelKey: "dashboard.widgets.presence-status" },
	{ id: "whos-out-today", label: "Who's Out Today", labelKey: "dashboard.widgets.whos-out-today" },
	{ id: "upcoming-time-off", label: "Upcoming Time Off", labelKey: "dashboard.widgets.upcoming-time-off" },
	{ id: "recently-approved", label: "Recently Approved", labelKey: "dashboard.widgets.recently-approved" },
	{ id: "birthday-reminders", label: "Birthday Reminders", labelKey: "dashboard.widgets.birthday-reminders" },
	{ id: "hydration", label: "Hydration", labelKey: "dashboard.widgets.hydration" },
	{ id: "vacation-balance", label: "Vacation Balance", labelKey: "dashboard.widgets.vacation-balance" },
];

/**
 * Validates and normalizes a widget order array.
 * - Removes unknown widget IDs
 * - Adds any new widgets that aren't in the saved order
 * - Ensures no duplicates
 */
export function normalizeWidgetOrder(savedOrder: string[]): WidgetId[] {
	const seen = new Set<WidgetId>();
	const normalized: WidgetId[] = [];

	for (const id of savedOrder) {
		if (VALID_WIDGET_IDS.has(id as WidgetId) && !seen.has(id as WidgetId)) {
			seen.add(id as WidgetId);
			normalized.push(id as WidgetId);
		}
	}

	for (const id of DEFAULT_WIDGET_ORDER) {
		if (!seen.has(id)) {
			normalized.push(id);
		}
	}

	return normalized;
}

export function normalizeHiddenWidgets(savedHidden: string[] | undefined): WidgetId[] {
	const seen = new Set<WidgetId>();
	const normalized: WidgetId[] = [];

	for (const id of savedHidden ?? []) {
		if (VALID_WIDGET_IDS.has(id as WidgetId) && !seen.has(id as WidgetId)) {
			seen.add(id as WidgetId);
			normalized.push(id as WidgetId);
		}
	}

	return normalized;
}

export function normalizeWidgetLayout(layout: DashboardWidgetOrder | null | undefined): {
	order: WidgetId[];
	hidden: WidgetId[];
	version: 1;
} {
	return {
		order: normalizeWidgetOrder(layout?.order ?? DEFAULT_WIDGET_ORDER),
		hidden: normalizeHiddenWidgets(layout?.hidden),
		version: 1,
	};
}

export function mergeVisibleWidgetOrder(
	currentOrder: string[],
	newVisibleOrder: WidgetId[],
	hiddenWidgets: WidgetId[],
): WidgetId[] {
	const hiddenSet = new Set(hiddenWidgets);
	const normalizedCurrentOrder = normalizeWidgetOrder(currentOrder);
	const nextVisibleOrder = newVisibleOrder.filter((id, index) => {
		return VALID_WIDGET_IDS.has(id) && !hiddenSet.has(id) && newVisibleOrder.indexOf(id) === index;
	});
	const nextVisibleSet = new Set(nextVisibleOrder);

	for (const id of normalizedCurrentOrder) {
		if (!hiddenSet.has(id) && !nextVisibleSet.has(id)) {
			nextVisibleOrder.push(id);
			nextVisibleSet.add(id);
		}
	}

	let visibleIndex = 0;
	return normalizedCurrentOrder.map((id) => {
		if (hiddenSet.has(id)) {
			return id;
		}

		const nextId = nextVisibleOrder[visibleIndex];
		visibleIndex += 1;
		return nextId;
	});
}
```

- [ ] **Step 5: Run the registry tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/components/dashboard/widget-registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/webapp/src/db/schema/types.ts apps/webapp/src/components/dashboard/widget-registry.ts apps/webapp/src/components/dashboard/widget-registry.test.ts
git commit -m "feat: normalize dashboard widget visibility"
```

---

### Task 2: Persist Hidden Widgets Through Existing Settings Actions

**Files:**
- Modify: `apps/webapp/src/components/dashboard/actions.ts:1298-1377`

- [ ] **Step 1: Update the server action to accept the extended layout**

In `apps/webapp/src/components/dashboard/actions.ts`, replace `updateWidgetOrder` with:

```ts
/**
 * Update dashboard widget order and visibility.
 */
export async function updateWidgetOrder(
	layout: Pick<DashboardWidgetOrder, "order" | "hidden">,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const widgetOrder: DashboardWidgetOrder = {
			order: layout.order,
			hidden: layout.hidden ?? [],
			version: 1,
		};

		yield* _(
			Effect.tryPromise({
				try: async () => {
					const updated = await dbService.db
						.update(userSettings)
						.set({
							dashboardWidgetOrder: widgetOrder,
							updatedAt: currentTimestamp(),
						})
						.where(eq(userSettings.userId, session.user.id))
						.returning();

					if (updated.length === 0) {
						await dbService.db.insert(userSettings).values({
							userId: session.user.id,
							dashboardWidgetOrder: widgetOrder,
							updatedAt: currentTimestamp(),
						});
					}
				},
				catch: (error) =>
					new NotFoundError({
						message: `Failed to update widget layout: ${error}`,
						entityType: "userSettings",
					}),
			}),
		);

		return { success: true };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

- [ ] **Step 2: Run TypeScript/Biome on changed server files**

Run: `pnpm --dir apps/webapp exec biome check src/components/dashboard/actions.ts src/db/schema/types.ts`

Expected: PASS.

- [ ] **Step 3: Commit Task 2**

```bash
git add apps/webapp/src/components/dashboard/actions.ts apps/webapp/src/db/schema/types.ts
git commit -m "feat: persist dashboard widget visibility"
```

---

### Task 3: Update The Widget Layout Hook

**Files:**
- Modify: `apps/webapp/src/components/dashboard/use-widget-order.ts:1-103`

- [ ] **Step 1: Replace the hook with layout-aware state handling**

Replace `apps/webapp/src/components/dashboard/use-widget-order.ts` with:

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query/keys";
import { getUserSettings, updateWidgetOrder } from "./actions";
import {
	DEFAULT_WIDGET_ORDER,
	mergeVisibleWidgetOrder,
	normalizeWidgetLayout,
	type WidgetId,
} from "./widget-registry";

type WidgetLayout = {
	order: WidgetId[];
	hidden: WidgetId[];
	version: 1;
};

/**
 * Hook for managing dashboard widget order and visibility with persistence.
 * Provides optimistic updates and automatic save on reorder or visibility changes.
 */
export function useWidgetOrder() {
	const queryClient = useQueryClient();

	const { data: settings, isLoading } = useQuery({
		queryKey: queryKeys.dashboard.widgetOrder(),
		queryFn: async () => {
			const result = await getUserSettings();
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		staleTime: 1000 * 60 * 5,
	});

	const { mutate: saveLayout, isPending: isSaving } = useMutation({
		mutationFn: async (layout: WidgetLayout) => {
			const result = await updateWidgetOrder(layout);
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		onMutate: async (newLayout) => {
			await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.widgetOrder() });

			const previousSettings = queryClient.getQueryData(queryKeys.dashboard.widgetOrder());

			queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), {
				dashboardWidgetOrder: newLayout,
			});

			return { previousSettings };
		},
		onError: (_error, _newLayout, context) => {
			if (context?.previousSettings) {
				queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), context.previousSettings);
			}
			toast.error("Failed to save dashboard layout", {
				description: "Your changes could not be saved. Please try again.",
			});
		},
		onSuccess: () => {
			toast.success("Dashboard layout saved");
		},
	});

	const layout = useMemo<WidgetLayout>(() => {
		return normalizeWidgetLayout(settings?.dashboardWidgetOrder ?? null);
	}, [settings?.dashboardWidgetOrder]);

	const hiddenSet = useMemo(() => new Set(layout.hidden), [layout.hidden]);

	const visibleWidgetOrder = useMemo<WidgetId[]>(() => {
		return layout.order.filter((widgetId) => !hiddenSet.has(widgetId));
	}, [hiddenSet, layout.order]);

	const onReorder = useCallback(
		(newVisibleOrder: WidgetId[]) => {
			saveLayout({
				order: mergeVisibleWidgetOrder(layout.order, newVisibleOrder, layout.hidden),
				hidden: layout.hidden,
				version: 1,
			});
		},
		[layout.hidden, layout.order, saveLayout],
	);

	const onVisibilityChange = useCallback(
		(widgetId: WidgetId, visible: boolean) => {
			const nextHidden = visible
				? layout.hidden.filter((hiddenWidgetId) => hiddenWidgetId !== widgetId)
				: [...layout.hidden, widgetId].filter(
						(hiddenWidgetId, index, hiddenWidgets) => hiddenWidgets.indexOf(hiddenWidgetId) === index,
					);

			saveLayout({
				order: layout.order,
				hidden: nextHidden,
				version: 1,
			});
		},
		[layout.hidden, layout.order, saveLayout],
	);

	const resetOrder = useCallback(() => {
		saveLayout({ order: DEFAULT_WIDGET_ORDER, hidden: [], version: 1 });
	}, [saveLayout]);

	return {
		widgetOrder: layout.order,
		visibleWidgetOrder,
		hiddenWidgets: layout.hidden,
		isLoading,
		isSaving,
		onReorder,
		onVisibilityChange,
		resetOrder,
	};
}
```

- [ ] **Step 2: Run Biome on the hook**

Run: `pnpm --dir apps/webapp exec biome check src/components/dashboard/use-widget-order.ts`

Expected: PASS.

- [ ] **Step 3: Commit Task 3**

```bash
git add apps/webapp/src/components/dashboard/use-widget-order.ts
git commit -m "feat: manage dashboard widget visibility state"
```

---

### Task 4: Add The Icon-Only Customization Menu

**Files:**
- Create: `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx`
- Create: `apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx`

- [ ] **Step 1: Write the failing menu tests**

Create `apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx` with:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardCustomizeMenu } from "./dashboard-customize-menu";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

describe("DashboardCustomizeMenu", () => {
	it("renders an icon-only accessible trigger", () => {
		render(
			<DashboardCustomizeMenu
				hiddenWidgets={[]}
				onReset={vi.fn()}
				onVisibilityChange={vi.fn()}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "Customize dashboard" });
		expect(trigger).toBeTruthy();
		expect(trigger.textContent).toBe("");
	});

	it("calls visibility changes from widget rows", () => {
		const onVisibilityChange = vi.fn();

		render(
			<DashboardCustomizeMenu
				hiddenWidgets={["quick-stats"]}
				onReset={vi.fn()}
				onVisibilityChange={onVisibilityChange}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Customize dashboard" }));
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Time Tracking" }));

		expect(onVisibilityChange).toHaveBeenCalledWith("quick-stats", true);
	});

	it("calls reset from the reset menu item", () => {
		const onReset = vi.fn();

		render(
			<DashboardCustomizeMenu
				hiddenWidgets={[]}
				onReset={onReset}
				onVisibilityChange={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Customize dashboard" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Reset layout" }));

		expect(onReset).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run the menu tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/components/dashboard/dashboard-customize-menu.test.tsx`

Expected: FAIL because `dashboard-customize-menu.tsx` does not exist.

- [ ] **Step 3: Create the customization menu component**

Create `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx` with:

```tsx
"use client";

import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WIDGET_CONFIGS, type WidgetId } from "./widget-registry";

interface DashboardCustomizeMenuProps {
	hiddenWidgets: WidgetId[];
	onVisibilityChange: (widgetId: WidgetId, visible: boolean) => void;
	onReset: () => void;
}

export function DashboardCustomizeMenu({
	hiddenWidgets,
	onVisibilityChange,
	onReset,
}: DashboardCustomizeMenuProps) {
	const { t } = useTranslate();
	const hiddenWidgetSet = new Set(hiddenWidgets);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={t("dashboard.customize.trigger", "Customize dashboard")}
					className="size-9"
					size="icon"
					variant="outline"
				>
					<IconAdjustmentsHorizontal className="size-4" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel>{t("dashboard.customize.title", "Dashboard widgets")}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{WIDGET_CONFIGS.map((widget) => {
					const visible = !hiddenWidgetSet.has(widget.id);

					return (
						<DropdownMenuCheckboxItem
							checked={visible}
							key={widget.id}
							onCheckedChange={(checked) => onVisibilityChange(widget.id, checked === true)}
							onSelect={(event) => event.preventDefault()}
						>
							{t(widget.labelKey, widget.label)}
						</DropdownMenuCheckboxItem>
					);
				})}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={onReset}>
					{t("dashboard.customize.reset", "Reset layout")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
```

- [ ] **Step 4: Run the menu tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/components/dashboard/dashboard-customize-menu.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx
git commit -m "feat: add dashboard customization menu"
```

---

### Task 5: Render Only Visible Widgets On The Dashboard

**Files:**
- Modify: `apps/webapp/src/components/section-cards.tsx:1-86`
- Modify: `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx:20-24` if comments still describe a full order after `SectionCards` passes visible order.

- [ ] **Step 1: Update `SectionCards` imports**

In `apps/webapp/src/components/section-cards.tsx`, add these imports with the existing dashboard imports:

```ts
import { useTranslate } from "@tolgee/react";
import { DashboardCustomizeMenu } from "@/components/dashboard/dashboard-customize-menu";
import { Button } from "@/components/ui/button";
```

- [ ] **Step 2: Add the all-hidden empty state component**

In `apps/webapp/src/components/section-cards.tsx`, add this below `SectionCardsSkeleton`:

```tsx
function HiddenWidgetsEmptyState({ onReset }: { onReset: () => void }) {
	const { t } = useTranslate();

	return (
		<div className="mx-4 rounded-xl border border-dashed bg-card p-8 text-center lg:mx-6">
			<h2 className="font-semibold text-card-foreground text-lg">
				{t("dashboard.customize.empty-title", "All dashboard widgets are hidden")}
			</h2>
			<p className="mx-auto mt-2 max-w-md text-muted-foreground text-sm">
				{t(
					"dashboard.customize.empty-description",
					"Use the dashboard customization icon to re-enable individual widgets, or reset the layout to show every widget again.",
				)}
			</p>
			<Button className="mt-4" onClick={onReset} variant="outline">
				{t("dashboard.customize.reset", "Reset layout")}
			</Button>
		</div>
	);
}
```

- [ ] **Step 3: Replace `SectionCards` with visible-widget rendering**

In `apps/webapp/src/components/section-cards.tsx`, replace the `SectionCards` function with:

```tsx
export function SectionCards() {
	const {
		visibleWidgetOrder,
		hiddenWidgets,
		onReorder,
		onVisibilityChange,
		resetOrder,
		isLoading,
	} = useWidgetOrder();

	if (isLoading) {
		return <SectionCardsSkeleton />;
	}

	return (
		<WidgetVisibilityProvider>
			<div className="mb-3 flex justify-end px-4 lg:px-6">
				<DashboardCustomizeMenu
					hiddenWidgets={hiddenWidgets}
					onReset={resetOrder}
					onVisibilityChange={onVisibilityChange}
				/>
			</div>
			{visibleWidgetOrder.length === 0 ? (
				<HiddenWidgetsEmptyState onReset={resetOrder} />
			) : (
				<SortableWidgetGrid widgetOrder={visibleWidgetOrder} onReorder={onReorder}>
					{visibleWidgetOrder.map((widgetId) => {
						const WidgetComponent = WIDGET_COMPONENTS[widgetId];
						if (!WidgetComponent) return null;
						return <WidgetComponent key={widgetId} />;
					})}
				</SortableWidgetGrid>
			)}
		</WidgetVisibilityProvider>
	);
}
```

- [ ] **Step 4: Update stale prop comments if needed**

If `apps/webapp/src/components/dashboard/sortable-widget-grid.tsx` still says `widgetOrder` is the full order including hidden widgets, replace only the prop comments with:

```ts
	/** Current order for widgets rendered by the dashboard grid */
	widgetOrder: WidgetId[];
	/** Called when rendered widgets are reordered */
	onReorder: (newOrder: WidgetId[]) => void;
```

- [ ] **Step 5: Run Biome on dashboard rendering files**

Run: `pnpm --dir apps/webapp exec biome check src/components/section-cards.tsx src/components/dashboard/sortable-widget-grid.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/webapp/src/components/section-cards.tsx apps/webapp/src/components/dashboard/sortable-widget-grid.tsx
git commit -m "feat: hide dashboard widgets from layout"
```

---

### Task 6: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/dashboard/widget-registry.ts`
- Verify: `apps/webapp/src/components/dashboard/widget-registry.test.ts`
- Verify: `apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx`
- Verify: `apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx`
- Verify: `apps/webapp/src/components/dashboard/use-widget-order.ts`
- Verify: `apps/webapp/src/components/dashboard/actions.ts`
- Verify: `apps/webapp/src/components/section-cards.tsx`

- [ ] **Step 1: Run focused tests**

Run: `pnpm --dir apps/webapp test src/components/dashboard/widget-registry.test.ts src/components/dashboard/dashboard-customize-menu.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run Biome on every touched implementation file**

Run: `pnpm --dir apps/webapp exec biome check src/db/schema/types.ts src/components/dashboard/widget-registry.ts src/components/dashboard/widget-registry.test.ts src/components/dashboard/actions.ts src/components/dashboard/use-widget-order.ts src/components/dashboard/dashboard-customize-menu.tsx src/components/dashboard/dashboard-customize-menu.test.tsx src/components/section-cards.tsx src/components/dashboard/sortable-widget-grid.tsx`

Expected: PASS.

- [ ] **Step 3: Run the full webapp test suite**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

- [ ] **Step 4: Run the production build if no environment variables are required**

Run: `CI=true pnpm build`

Expected: PASS. If the build requires unavailable Phase CLI environment variables, skip it and record the skipped variables in the final response.

- [ ] **Step 5: Commit final verification fixes if any were needed**

If verification required code changes, commit them:

```bash
git add apps/webapp/src/db/schema/types.ts apps/webapp/src/components/dashboard/widget-registry.ts apps/webapp/src/components/dashboard/widget-registry.test.ts apps/webapp/src/components/dashboard/actions.ts apps/webapp/src/components/dashboard/use-widget-order.ts apps/webapp/src/components/dashboard/dashboard-customize-menu.tsx apps/webapp/src/components/dashboard/dashboard-customize-menu.test.tsx apps/webapp/src/components/section-cards.tsx apps/webapp/src/components/dashboard/sortable-widget-grid.tsx
git commit -m "fix: stabilize dashboard widget visibility"
```

If verification passed without changes, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers icon-only customization, hide/show toggles, existing JSONB persistence, no database migration, reset behavior, all-hidden empty state, drag-and-drop preservation, invalid ID normalization, and tests.
- Placeholder scan: The plan does not contain open-ended implementation placeholders; each task includes exact file paths, code snippets, commands, and expected outcomes.
- Type consistency: The plan consistently uses `WidgetId`, `DashboardWidgetOrder`, `hidden`, `visibleWidgetOrder`, `onVisibilityChange`, `resetOrder`, `normalizeWidgetLayout`, and `mergeVisibleWidgetOrder` across tasks.
