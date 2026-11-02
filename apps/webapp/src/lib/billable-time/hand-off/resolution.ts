/**
 * Resolving work changed after invoicing (#1499): the rules the resolve dialog
 * and the server share, and the comparison item with its mark version.
 * Client-safe.
 *
 * A comparison item is a handed-off invoiced work row together with the pieces
 * split off it (`carried_from_work_period_id`, possibly split again), all in
 * the same draft. It is resolved and stale-checked as one: its mark version
 * lists every row's `mark_version`, which the database bumps on every change
 * of a mark (correction, new mark, resolution).
 */

import { isUuid } from "../input";

export const RESOLUTION_EXPLANATION_MAX_LENGTH = 2000;
export const RESOLUTION_REFERENCE_MAX_LENGTH = 200;
export const MAX_RESOLVED_ITEMS = 1000;
/** Bounds the untrusted mark version (one `id:version` per row of the item). */
const MAX_MARK_VERSION_LENGTH = 20_000;

declare const markVersion: unique symbol;

/**
 * The opaque version of an item's mark that the client round-trips. Only
 * `itemMarkVersion` and `parseResolutionInput` make one.
 */
export type MarkVersion = string & { readonly [markVersion]: true };

/** An item to resolve: its handed-off row and the mark version the admin saw. */
export interface ResolveItem {
	invoicedWorkId: string;
	markVersion: MarkVersion;
}

export interface ResolutionInput {
	items: ResolveItem[];
	explanation: string;
	accountingReference: string | null;
}

export type ResolutionFieldError =
	| { field: "items"; code: "invalid" }
	| { field: "explanation"; code: "required" | "too_long" }
	| { field: "accountingReference"; code: "too_long" };

function parseItems(value: unknown): ResolveItem[] | null {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESOLVED_ITEMS) {
		return null;
	}
	const items: ResolveItem[] = [];
	const seen = new Set<string>();
	for (const candidate of value) {
		if (typeof candidate !== "object" || candidate === null) return null;
		const { invoicedWorkId, markVersion } = candidate as Record<string, unknown>;
		if (
			!isUuid(invoicedWorkId) ||
			typeof markVersion !== "string" ||
			markVersion.length === 0 ||
			markVersion.length > MAX_MARK_VERSION_LENGTH
		) {
			return null;
		}
		const id = invoicedWorkId.toLowerCase();
		if (seen.has(id)) return null;
		seen.add(id);
		// Untrusted: it only ever compares equal to the item's current version.
		items.push({ invoicedWorkId: id, markVersion: markVersion as MarkVersion });
	}
	return items;
}

/** Reads an untrusted resolve request: 1–2,000 characters of explanation after trimming. */
export function parseResolutionInput(
	input: unknown,
): { ok: true; value: ResolutionInput } | { ok: false; errors: ResolutionFieldError[] } {
	const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
	const errors: ResolutionFieldError[] = [];
	const items = parseItems(raw.items);
	if (!items) errors.push({ field: "items", code: "invalid" });
	const explanation = typeof raw.explanation === "string" ? raw.explanation.trim() : "";
	if (explanation.length === 0) errors.push({ field: "explanation", code: "required" });
	else if (explanation.length > RESOLUTION_EXPLANATION_MAX_LENGTH) {
		errors.push({ field: "explanation", code: "too_long" });
	}
	const reference =
		typeof raw.accountingReference === "string" ? raw.accountingReference.trim() : "";
	if (reference.length > RESOLUTION_REFERENCE_MAX_LENGTH) {
		errors.push({ field: "accountingReference", code: "too_long" });
	}
	if (!items || errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		value: { items, explanation, accountingReference: reference.length > 0 ? reference : null },
	};
}

export interface ItemRow {
	id: string;
	invoiceDraftId: string;
	workPeriodId: string;
	carriedFromWorkPeriodId: string | null;
	markVersion: number;
}

/**
 * Groups invoiced work rows into comparison items, keyed by the handed-off
 * row's id, in the order the rows came. A piece whose original is not among
 * the rows of its draft (deleted with its work period) is an item of its own.
 */
export function comparisonItems<Row extends ItemRow>(rows: readonly Row[]): Map<string, Row[]> {
	const key = (draftId: string, workPeriodId: string) => `${draftId}|${workPeriodId}`;
	const byPeriod = new Map(rows.map((row) => [key(row.invoiceDraftId, row.workPeriodId), row]));
	const children = new Map<string, Row[]>();
	const roots: Row[] = [];
	for (const row of rows) {
		const source =
			row.carriedFromWorkPeriodId === null
				? undefined
				: byPeriod.get(key(row.invoiceDraftId, row.carriedFromWorkPeriodId));
		if (!source || source === row) {
			roots.push(row);
			continue;
		}
		const siblings = children.get(source.id) ?? [];
		siblings.push(row);
		children.set(source.id, siblings);
	}
	const items = new Map<string, Row[]>();
	const placed = new Set<Row>();
	const collect = (root: Row) => {
		const members: Row[] = [root];
		placed.add(root);
		for (let index = 0; index < members.length; index += 1) {
			for (const child of children.get(members[index].id) ?? []) {
				if (placed.has(child)) continue;
				placed.add(child);
				members.push(child);
			}
		}
		items.set(root.id, members);
	};
	for (const root of roots) collect(root);
	// Rows that only reach each other (never written, but never lost either).
	for (const row of rows) if (!placed.has(row)) collect(row);
	return items;
}

/** The fields an item's rows are marked with, once each, sorted. */
export function itemChangedFields<Field extends string>(
	rows: readonly { changedFields: readonly Field[] }[],
): Field[] {
	return [...new Set(rows.flatMap((row) => row.changedFields))].sort();
}

/** The version of an item's mark: every row's id and mark version, sorted. */
export function itemMarkVersion(rows: readonly Pick<ItemRow, "id" | "markVersion">[]): MarkVersion {
	return rows
		.map((row) => `${row.id}:${row.markVersion}`)
		.sort()
		.join(",") as MarkVersion;
}
