import type { ReactNode } from "react";
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

/**
 * Widget metadata used by dashboard customization controls.
 */
export interface WidgetConfig {
	id: WidgetId;
	label: string;
	labelKey: string;
}

export const WIDGET_CONFIGS: WidgetConfig[] = [
	{
		id: "manager-today",
		label: "Manager Today",
		labelKey: "dashboard.widgets.manager-today",
	},
	{
		id: "managed-employees",
		label: "Managed Employees",
		labelKey: "dashboard.widgets.managed-employees",
	},
	{
		id: "pending-approvals",
		label: "Pending Approvals",
		labelKey: "dashboard.widgets.pending-approvals",
	},
	{
		id: "team-overview",
		label: "Team Overview",
		labelKey: "dashboard.widgets.team-overview",
	},
	{
		id: "quick-stats",
		label: "Time Tracking",
		labelKey: "dashboard.widgets.quick-stats",
	},
	{
		id: "presence-status",
		label: "Presence Status",
		labelKey: "dashboard.widgets.presence-status",
	},
	{
		id: "whos-out-today",
		label: "Who's Out Today",
		labelKey: "dashboard.widgets.whos-out-today",
	},
	{
		id: "upcoming-time-off",
		label: "Upcoming Time Off",
		labelKey: "dashboard.widgets.upcoming-time-off",
	},
	{
		id: "recently-approved",
		label: "Recently Approved",
		labelKey: "dashboard.widgets.recently-approved",
	},
	{
		id: "birthday-reminders",
		label: "Birthday Reminders",
		labelKey: "dashboard.widgets.birthday-reminders",
	},
	{
		id: "hydration",
		label: "Hydration",
		labelKey: "dashboard.widgets.hydration",
	},
	{
		id: "vacation-balance",
		label: "Vacation Balance",
		labelKey: "dashboard.widgets.vacation-balance",
	},
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

	// First, add valid widgets from saved order
	for (const id of savedOrder) {
		if (VALID_WIDGET_IDS.has(id as WidgetId) && !seen.has(id as WidgetId)) {
			seen.add(id as WidgetId);
			normalized.push(id as WidgetId);
		}
	}

	// Then, add any new widgets that weren't in the saved order
	for (const id of DEFAULT_WIDGET_ORDER) {
		if (!seen.has(id)) {
			normalized.push(id);
		}
	}

	return normalized;
}

/**
 * Validates and normalizes hidden widget IDs.
 * - Removes unknown widget IDs
 * - Ensures no duplicates
 */
export function normalizeHiddenWidgets(hiddenWidgets: string[] = []): WidgetId[] {
	const seen = new Set<WidgetId>();
	const normalized: WidgetId[] = [];

	for (const id of hiddenWidgets) {
		if (VALID_WIDGET_IDS.has(id as WidgetId) && !seen.has(id as WidgetId)) {
			seen.add(id as WidgetId);
			normalized.push(id as WidgetId);
		}
	}

	return normalized;
}

/**
 * Normalizes saved dashboard layout preferences with order and visibility state.
 */
export function normalizeWidgetLayout(layout: DashboardWidgetOrder): Required<DashboardWidgetOrder> & {
	order: WidgetId[];
	hidden: WidgetId[];
} {
	return {
		order: normalizeWidgetOrder(layout.order),
		hidden: normalizeHiddenWidgets(layout.hidden),
		version: layout.version,
	};
}

/**
 * Applies a reordered visible widget list back into the full layout without moving hidden slots.
 */
export function mergeVisibleWidgetOrder(
	currentOrder: WidgetId[],
	reorderedVisibleWidgets: WidgetId[],
	hiddenWidgets: WidgetId[],
): WidgetId[] {
	const hidden = new Set(hiddenWidgets);
	const visibleQueue = reorderedVisibleWidgets.filter((id) => !hidden.has(id));
	let visibleIndex = 0;

	return currentOrder.map((id) => {
		if (hidden.has(id)) {
			return id;
		}

		const nextVisibleWidget = visibleQueue[visibleIndex];
		visibleIndex += 1;
		return nextVisibleWidget ?? id;
	});
}

/**
 * Creates a map of widget ID to its render function.
 * This allows dynamic rendering based on the widget order.
 */
export type WidgetRenderMap = Record<WidgetId, () => ReactNode>;
