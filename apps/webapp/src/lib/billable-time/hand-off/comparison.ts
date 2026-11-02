/**
 * Comparing a comparison item with its hand-off (#1501): the item's values as
 * handed off, as its latest resolution reviewed them and now, and which
 * fields differ. Pure; the resolution store reads the values.
 *
 * Times are compared as instants and shown at the offsets the work recorded
 * (`docs/refs/timekeeping.md`), never the viewer's time zone. The hand-off
 * column has the handed-off row only; current and last resolved values cover
 * every piece split off it.
 */

import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { workDayOf } from "@/lib/datetime/temporal-format";
import { formatUnits } from "@/lib/money/exact-decimal";
import { minutesAsHundredths } from "./hand-off-plan";
import {
	COMPARED_FIELDS,
	type ComparedField,
	type ComparedReferenceView,
	type ComparedWorkValuesView,
	type RecordedTimeView,
	type WorkComparisonView,
} from "./views";

/** One work period of an item as it was or is (a resolution snapshot piece fits). */
export interface ComparedPiece {
	removed: boolean;
	startedAt: string;
	endedAt: string | null;
	/** The clock-in entry's recorded offset; null when it is missing. */
	startOffsetMinutes: number | null;
	endOffsetMinutes: number | null;
	durationMinutes: number | null;
	projectId: string | null;
	projectName: string | null;
	customerId: string | null;
	customerName: string | null;
	billable: boolean;
}

export interface CompareWorkInput {
	/** The frozen invoiced work row. */
	handOff: ComparedPiece;
	/** The latest resolution's snapshot, handed-off row first. */
	lastResolved: { resolvedAt: string; pieces: readonly ComparedPiece[] } | null;
	/** The live work periods, handed-off row first. */
	current: readonly ComparedPiece[];
}

function recorded(at: string, offsetMinutes: number | null): RecordedTimeView {
	// A missing entry leaves no recorded offset: show UTC rather than the viewer's zone.
	return { at, offsetMinutes: offsetMinutes ?? 0 };
}

function distinct(references: readonly ComparedReferenceView[]): ComparedReferenceView[] {
	const seen = new Map<string | null, ComparedReferenceView>();
	for (const reference of references) {
		if (!seen.has(reference.id)) seen.set(reference.id, reference);
	}
	return [...seen.values()];
}

/** An item's values over its pieces that are not removed. */
export function comparedValues(pieces: readonly ComparedPiece[]): ComparedWorkValuesView {
	const live = pieces.filter((piece) => !piece.removed);
	const counts = { pieceCount: pieces.length, removedPieceCount: pieces.length - live.length };
	if (live.length === 0) {
		return {
			removed: true,
			...counts,
			day: null,
			start: null,
			end: null,
			durationMinutes: 0,
			hours: formatUnits(BigInt(0), 2),
			projects: [],
			customers: [],
			billability: null,
		};
	}
	const instant = (value: string): Instant => parseInstant(value);
	const first = live.reduce((earliest, piece) =>
		instant(piece.startedAt).epochMilliseconds < instant(earliest.startedAt).epochMilliseconds
			? piece
			: earliest,
	);
	const ended = live.filter((piece): piece is ComparedPiece & { endedAt: string } =>
		Boolean(piece.endedAt),
	);
	const last =
		ended.length === live.length
			? ended.reduce((latest, piece) =>
					instant(piece.endedAt).epochMilliseconds > instant(latest.endedAt).epochMilliseconds
						? piece
						: latest,
				)
			: null;
	const start = recorded(first.startedAt, first.startOffsetMinutes);
	const durationMinutes = live.reduce((sum, piece) => sum + (piece.durationMinutes ?? 0), 0);
	const billable = new Set(live.map((piece) => piece.billable));
	return {
		removed: false,
		...counts,
		day: workDayOf(instant(start.at), start.offsetMinutes).toString(),
		start,
		end: last ? recorded(last.endedAt, last.endOffsetMinutes) : null,
		durationMinutes,
		hours: formatUnits(BigInt(minutesAsHundredths(durationMinutes)), 2),
		projects: distinct(live.map((piece) => ({ id: piece.projectId, name: piece.projectName }))),
		customers: distinct(live.map((piece) => ({ id: piece.customerId, name: piece.customerName }))),
		billability: billable.size > 1 ? "mixed" : billable.has(true) ? "billable" : "non_billable",
	};
}

function sameInstant(a: RecordedTimeView | null, b: RecordedTimeView | null): boolean {
	if (a === null || b === null) return a === b;
	return parseInstant(a.at).equals(parseInstant(b.at));
}

function sameReferences(
	a: readonly ComparedReferenceView[],
	b: readonly ComparedReferenceView[],
): boolean {
	const ids = (references: readonly ComparedReferenceView[]) =>
		references
			.map((reference) => reference.id ?? "")
			.sort()
			.join(",");
	return ids(a) === ids(b);
}

/**
 * The fields whose values differ, in `COMPARED_FIELDS` order. Removed work has
 * no other values, so a removal differs only in `removed`.
 */
export function comparedFields(
	a: ComparedWorkValuesView,
	b: ComparedWorkValuesView,
): ComparedField[] {
	if (a.removed || b.removed) return a.removed === b.removed ? [] : ["removed"];
	const differs: Record<ComparedField, boolean> = {
		day: a.day !== b.day,
		start: !sameInstant(a.start, b.start),
		end: !sameInstant(a.end, b.end),
		hours: a.durationMinutes !== b.durationMinutes,
		project: !sameReferences(a.projects, b.projects),
		customer: !sameReferences(a.customers, b.customers),
		billability: a.billability !== b.billability,
		removed: a.removedPieceCount !== b.removedPieceCount,
	};
	return COMPARED_FIELDS.filter((field) => differs[field]);
}

/**
 * The three columns of an item's comparison and the fields that differ; the
 * amount difference comes from `amountDifferenceOf` (#1502).
 */
export function compareWork(input: CompareWorkInput): Omit<WorkComparisonView, "amountDifference"> {
	const handOff = comparedValues([input.handOff]);
	const current = comparedValues(input.current);
	const lastResolved = input.lastResolved ? comparedValues(input.lastResolved.pieces) : null;
	return {
		handOff,
		lastResolved:
			input.lastResolved && lastResolved
				? {
						...lastResolved,
						resolvedAt: input.lastResolved.resolvedAt,
						changedFromHandOff: comparedFields(handOff, lastResolved),
					}
				: null,
		current: {
			...current,
			changedFromHandOff: comparedFields(handOff, current),
			changedSinceResolution: lastResolved ? comparedFields(lastResolved, current) : null,
		},
	};
}
