import type { ReactNode } from "react";

/**
 * Widget IDs used for dashboard widget ordering.
 * Each ID corresponds to a specific dashboard widget.
 */
export type WidgetId =
	| "managed-employees"
	| "pending-approvals"
	| "team-overview"
	| "quick-stats"
	| "whos-out-today"
	| "upcoming-time-off"
	| "recently-approved"
	| "birthday-reminders"
	| "hydration";

/**
 * Default widget order for new users or when no preferences are set.
 * This order matches the original hardcoded layout in section-cards.tsx.
 */
export const DEFAULT_WIDGET_ORDER: WidgetId[] = [
	"managed-employees",
	"pending-approvals",
	"team-overview",
	"quick-stats",
	"whos-out-today",
	"upcoming-time-off",
	"recently-approved",
	"birthday-reminders",
	"hydration",
];

/**
 * Set of all valid widget IDs for validation.
 */
export const VALID_WIDGET_IDS = new Set<WidgetId>(DEFAULT_WIDGET_ORDER);

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
 * Widget metadata for future extensibility (visibility, conditional rendering, etc.)
 */
export interface WidgetConfig {
	id: WidgetId;
	/** Whether the widget should be shown (for future visibility toggle feature) */
	visible?: boolean;
}

/**
 * Creates a map of widget ID to its render function.
 * This allows dynamic rendering based on the widget order.
 */
export type WidgetRenderMap = Record<WidgetId, () => ReactNode>;
