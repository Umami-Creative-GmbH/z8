import { type AnyColumn, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { EngagementKind } from "./engagement-kind";

/** The roster filter `All | Employees | External Contractors` (#1995). */
export const engagementFilters = ["all", "employee", "contractor"] as const;
export type EngagementFilter = (typeof engagementFilters)[number];

export const engagementFilterSchema = z.enum(engagementFilters).default("all");

export function isEngagementFilter(value: unknown): value is EngagementFilter {
	return typeof value === "string" && (engagementFilters as readonly string[]).includes(value);
}

/** A row without an engagement kind predates it and is an employee. */
export function matchesEngagementFilter(
	kind: EngagementKind | null | undefined,
	filter: EngagementFilter,
): boolean {
	return filter === "all" || (kind ?? "employee") === filter;
}

export function filterByEngagement<T extends { engagementKind?: EngagementKind | null }>(
	rows: readonly T[],
	filter: EngagementFilter,
): T[] {
	return filter === "all"
		? [...rows]
		: rows.filter((row) => matchesEngagementFilter(row.engagementKind, filter));
}

type PickerRow = { id: string; engagementKind?: EngagementKind | null };

/** A people picker offers the engagement filter only once its rows hold an External Contractor. */
export function hasExternalContractors(rows: readonly PickerRow[]): boolean {
	return rows.some((row) => row.engagementKind === "contractor");
}

/**
 * The rows a people picker lists under an engagement filter, in their order.
 * The filter narrows the picker, never the choice: rows already chosen stay
 * listed whatever the filter, so a chosen person never vanishes.
 */
export function engagementPickerRows<T extends PickerRow>(
	rows: readonly T[],
	filter: EngagementFilter,
	chosenIds: readonly string[],
): T[] {
	const chosen = new Set(chosenIds);
	return rows.filter(
		(row) => matchesEngagementFilter(row.engagementKind, filter) || chosen.has(row.id),
	);
}

/** The SQL condition of a filter on an `engagement_kind` column; none for `all`. */
export function engagementFilterCondition(
	column: AnyColumn,
	filter: EngagementFilter,
): SQL | undefined {
	return filter === "all" ? undefined : eq(column, filter);
}
