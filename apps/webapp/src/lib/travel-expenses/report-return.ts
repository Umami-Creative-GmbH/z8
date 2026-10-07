import type { TravelExpenseReportStatus } from "@/db/schema/travel-expense";

/**
 * Pure rules of returned, withdrawn and resubmitted travel expense reports
 * (#603). A report is edited by its employee only while it is a draft (never
 * submitted, or withdrawn) or returned for changes; submitted and decided
 * reports are frozen, and a rejected report stays terminal.
 */

export const EDITABLE_REPORT_STATUSES = [
	"draft",
	"returned",
] as const satisfies readonly TravelExpenseReportStatus[];

export function isEditableReportStatus(status: TravelExpenseReportStatus): boolean {
	return (EDITABLE_REPORT_STATUSES as readonly string[]).includes(status);
}

export const RETURN_NOTE_MAX_LENGTH = 2000;
export const RETURN_ITEM_COMMENT_MAX_LENGTH = 1000;

export interface ReturnReportInput {
	note: string;
	itemComments: ReadonlyArray<{ itemId: string; body: string }>;
}

export interface ParsedReturnReport {
	note: string;
	/** One comment per commented item, in the order of the submitted items. */
	itemComments: Array<{ itemId: string; body: string }>;
}

export type ReturnReportInputError =
	| "note_required"
	| "note_too_long"
	| "comment_too_long"
	| "unknown_item"
	| "duplicate_item";

/**
 * Validates what a reviewer returns: a required note and optional comments on
 * items of the submitted revision they reviewed. Blank comments are dropped.
 */
export function parseReturnReportInput(
	input: ReturnReportInput,
	submittedItemIds: readonly string[],
): { ok: true; value: ParsedReturnReport } | { ok: false; error: ReturnReportInputError } {
	const note = input.note.trim();
	if (!note) return { ok: false, error: "note_required" };
	if (note.length > RETURN_NOTE_MAX_LENGTH) return { ok: false, error: "note_too_long" };
	const byItem = new Map<string, string>();
	const submitted = new Set(submittedItemIds);
	for (const comment of input.itemComments) {
		const body = comment.body.trim();
		if (!body) continue;
		if (!submitted.has(comment.itemId)) return { ok: false, error: "unknown_item" };
		if (byItem.has(comment.itemId)) return { ok: false, error: "duplicate_item" };
		if (body.length > RETURN_ITEM_COMMENT_MAX_LENGTH) {
			return { ok: false, error: "comment_too_long" };
		}
		byItem.set(comment.itemId, body);
	}
	return {
		ok: true,
		value: {
			note,
			itemComments: submittedItemIds.flatMap((itemId) => {
				const body = byItem.get(itemId);
				return body ? [{ itemId, body }] : [];
			}),
		},
	};
}
