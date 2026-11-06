import {
	comparePlainDates,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type {
	EquipmentAssignmentView,
	EquipmentExceptionView,
	EquipmentHandoverView,
} from "@/lib/organization/equipment/contracts";

type Transfer = NonNullable<EquipmentAssignmentView["transfers"]>[number];

export type HistoryEntry =
	| {
			kind: "issue" | "receipt";
			key: string;
			/** The actual handover date; `null` only for an unknown historical issue date. */
			date: string | null;
			recordedAt: string;
			handover: EquipmentHandoverView;
			exception?: EquipmentExceptionView;
			transfer?: Transfer;
			amended: boolean;
	  }
	| {
			kind: "exception";
			key: string;
			date: string;
			recordedAt: string;
			exception: EquipmentExceptionView;
			amended: boolean;
	  }
	| { kind: "departure_deadline"; key: string; date: string }
	| { kind: "deadline_passed"; key: string; date: string };

export type HistoryAssignment = Pick<
	EquipmentAssignmentView,
	| "issue"
	| "receipts"
	| "exceptions"
	| "corrections"
	| "transfers"
	| "departureDeadline"
	| "effectiveDeadline"
	| "overdue"
>;

/**
 * The assignment's history, newest first: handovers by their actual date,
 * exception decisions by the organization date they were recorded, and the
 * calendar milestones the record itself states (the departure deadline, and the
 * effective deadline once a return is overdue). Nothing gets a time it lacks; an
 * unknown historical issue date sorts as the oldest entry.
 */
export function historyEntries(
	assignment: HistoryAssignment,
	timezone: string,
): HistoryEntry[] {
	const corrections = assignment.corrections ?? [];
	const amendedHandover = (id: string) =>
		corrections.some((c) => c.handoverId === id);
	const transferOf = (id: string) =>
		assignment.transfers?.find((transfer) => transfer.handoverId === id);
	const entries: HistoryEntry[] = [
		{
			kind: "issue",
			key: `issue:${assignment.issue.id}`,
			date: assignment.issue.actualDate,
			recordedAt: assignment.issue.recordedAt,
			handover: assignment.issue,
			transfer: transferOf(assignment.issue.id),
			amended: amendedHandover(assignment.issue.id),
		},
		...assignment.receipts.map(
			(receipt): HistoryEntry => ({
				kind: "receipt",
				key: `receipt:${receipt.id}`,
				date: receipt.actualDate,
				recordedAt: receipt.recordedAt,
				handover: receipt,
				exception: assignment.exceptions?.find(
					(e) => e.id === receipt.exceptionId,
				),
				transfer: transferOf(receipt.id),
				amended: amendedHandover(receipt.id),
			}),
		),
		...(assignment.exceptions ?? []).map(
			(exception): HistoryEntry => ({
				kind: "exception",
				key: `exception:${exception.id}`,
				date: plainDateAt(
					parseInstant(exception.recordedAt),
					timezone,
				).toString(),
				recordedAt: exception.recordedAt,
				exception,
				amended: corrections.some((c) => c.exceptionId === exception.id),
			}),
		),
	];
	if (assignment.departureDeadline)
		entries.push({
			kind: "departure_deadline",
			key: "departure_deadline",
			date: assignment.departureDeadline,
		});
	if (assignment.overdue && assignment.effectiveDeadline)
		entries.push({
			kind: "deadline_passed",
			key: "deadline_passed",
			date: assignment.effectiveDeadline,
		});
	// A milestone closes its day, so it follows that day's recorded events; the
	// deadline passes after the departure that set it.
	const rank = (entry: HistoryEntry) =>
		entry.kind === "deadline_passed"
			? 2
			: entry.kind === "departure_deadline"
				? 1
				: 0;
	return entries.sort((left, right) => {
		if (left.date === null || right.date === null)
			return left.date === right.date ? 0 : left.date === null ? 1 : -1;
		return (
			comparePlainDates(
				parsePlainDate(right.date),
				parsePlainDate(left.date),
			) ||
			rank(right) - rank(left) ||
			("recordedAt" in right && "recordedAt" in left
				? parseInstant(right.recordedAt).epochMilliseconds -
					parseInstant(left.recordedAt).epochMilliseconds
				: 0)
		);
	});
}
