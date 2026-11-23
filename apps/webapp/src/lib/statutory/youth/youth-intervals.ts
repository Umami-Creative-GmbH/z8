/**
 * The work the JArbSchG rules judge (#1993), pure: recorded work and planned shifts merged so
 * that every piece of work counts once.
 *
 * - Completed work counts as recorded, whatever day it is on, today included.
 * - An open clock-in counts from its start until now, or until the end of its shift when that is
 *   later: it is still being worked. Within its shift it works the rest of the shift, which still
 *   owes the part of the shift's break not taken before the clock-in.
 * - A shift counts while it is not over and no work belongs to it. A shift whose completed work
 *   ended before the shift does still counts for its remaining time. A shift that ended without
 *   any work was not worked.
 *
 * Work belongs to the shift it matches (`workMatchesShift`), not to whatever shift shares its day,
 * so a second shift on the same day and a night shift past midnight keep their own work.
 */
import {
	compareInstants,
	type Instant,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { workMatchesShift } from "@/lib/scheduling/shift-occasion";
import {
	type JarbschgLimits,
	plannedShiftWorkMinutes,
	type YouthWorkInterval,
} from "./jarbschg-rules";

/** A persisted, assigned shift with its instants in the organization zone. */
export interface YouthShiftRecord {
	readonly id: string;
	readonly employeeId: string;
	/** Organization-local shift date. */
	readonly date: PlainDate;
	readonly start: Instant;
	readonly end: Instant;
}

/** A not deleted work period; `end` is null while the clock-in is open. */
export interface YouthWorkRecord {
	readonly id: string;
	readonly employeeId: string;
	readonly start: Instant;
	readonly end: Instant | null;
	readonly durationMinutes: number | null;
}

type LimitsOn = (day: PlainDate) => JarbschgLimits | null;

const minutesBetween = (from: Instant, to: Instant) =>
	Math.max(0, Math.round(from.until(to).total({ unit: "minutes" })));

const later = (left: Instant, right: Instant) => (compareInstants(left, right) >= 0 ? left : right);

/**
 * Planned work between `start` and `end`. Shifts carry wall times only, so the minimum youth
 * break in force on `day` is assumed to be taken.
 */
export function plannedYouthInterval(
	ref: string,
	bounds: { readonly start: Instant; readonly end: Instant },
	limits: JarbschgLimits | null,
): YouthWorkInterval {
	const gross = minutesBetween(bounds.start, bounds.end);
	return {
		ref,
		start: bounds.start,
		end: bounds.end,
		workMinutes: limits
			? plannedShiftWorkMinutes(gross, {
					first: limits.breakAfter270Minutes,
					second: limits.breakAfter360Minutes,
				})
			: gross,
		recorded: false,
	};
}

/** Completed work as recorded youth work. */
export function completedYouthInterval(
	record: YouthWorkRecord & { readonly end: Instant },
): YouthWorkInterval {
	return {
		ref: `work:${record.id}`,
		start: record.start,
		end: record.end,
		workMinutes: record.durationMinutes ?? minutesBetween(record.start, record.end),
		recorded: true,
	};
}

/** The shift a piece of work belongs to: of the shifts it matches, the one starting nearest. */
function belongingShift<S extends { readonly start: Instant; readonly end: Instant }>(
	shifts: readonly S[],
	work: { readonly start: Instant; readonly end: Instant | null },
): S | undefined {
	let best: S | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of shifts) {
		if (!workMatchesShift(candidate, work)) continue;
		const distance = Math.abs(candidate.start.until(work.start).total({ unit: "minutes" }));
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

const plannedShiftOf = (
	ref: string,
	shift: { readonly start: Instant; readonly end: Instant },
) => ({
	ref,
	start: shift.start,
	end: shift.end,
});

/** Links each piece of recorded work to the planned shift it belongs to, if any. */
export function withPlannedShifts(
	work: readonly YouthWorkInterval[],
	shifts: readonly Pick<YouthShiftRecord, "id" | "start" | "end">[],
): YouthWorkInterval[] {
	return work.map((interval) => {
		const match = belongingShift(shifts, interval);
		return match
			? { ...interval, plannedShift: plannedShiftOf(`shift:${match.id}`, match) }
			: interval;
	});
}

const earlier = (left: Instant, right: Instant) =>
	compareInstants(left, right) <= 0 ? left : right;

/**
 * The work still planned in a shift from `restStart` until `restEnd` (the shift's end, or later
 * while an open clock-in overruns it), after completed work ended early. The break the whole
 * shift owes comes off the remaining time, less any break already taken within the shift before
 * `restStart`, so a minor clocked out for lunch, or clocked back in after it, keeps the shift's
 * planned work steady.
 */
function restOfShiftMinutes(
	shift: { readonly start: Instant; readonly end: Instant },
	restStart: Instant,
	pieces: readonly { readonly start: Instant; readonly end: Instant }[],
	limits: JarbschgLimits | null,
	restEnd: Instant = shift.end,
): number {
	const owedBreak =
		minutesBetween(shift.start, shift.end) - plannedYouthInterval("", shift, limits).workMinutes;
	const workedBefore = pieces.reduce(
		(total, piece) =>
			total + minutesBetween(later(piece.start, shift.start), earlier(piece.end, restStart)),
		0,
	);
	const breakTaken = Math.max(0, minutesBetween(shift.start, restStart) - workedBefore);
	return Math.max(0, minutesBetween(restStart, restEnd) - Math.max(0, owedBreak - breakTaken));
}

/** One employee's work to judge, as of `now`. */
export function youthIntervalsOf(input: {
	readonly work: readonly YouthWorkRecord[];
	readonly shifts: readonly YouthShiftRecord[];
	readonly now: Instant;
	readonly timezone: string;
	readonly limitsOn: LimitsOn;
}): YouthWorkInterval[] {
	const intervals: YouthWorkInterval[] = [];
	const limitsAt = (instant: Instant) => input.limitsOn(plainDateAt(instant, input.timezone));
	/** Per shift id: whether open work belongs to it, and its completed work. */
	const worked = new Map<
		string,
		{ open: boolean; lastEnd: Instant | null; pieces: { start: Instant; end: Instant }[] }
	>();

	const stateOf = (shiftId: string) => {
		let state = worked.get(shiftId);
		if (!state) {
			state = { open: false, lastEnd: null, pieces: [] };
			worked.set(shiftId, state);
		}
		return state;
	};

	// Completed work first, so an open clock-in knows the breaks already taken in its shift.
	const open: { record: YouthWorkRecord; shift: YouthShiftRecord | undefined }[] = [];
	for (const record of input.work) {
		const shift = belongingShift(input.shifts, record);
		if (!record.end) {
			open.push({ record, shift });
			continue;
		}
		const plannedShift = shift ? plannedShiftOf(`shift:${shift.id}`, shift) : undefined;
		intervals.push({ ...completedYouthInterval({ ...record, end: record.end }), plannedShift });
		if (shift) {
			const state = stateOf(shift.id);
			state.lastEnd = state.lastEnd ? later(state.lastEnd, record.end) : record.end;
			state.pieces.push({ start: record.start, end: record.end });
		}
	}

	for (const { record, shift } of open) {
		const ref = `work:${record.id}`;
		if (!shift) {
			intervals.push({
				...plannedYouthInterval(
					ref,
					{ start: record.start, end: later(input.now, record.start) },
					limitsAt(record.start),
				),
				inProgress: true,
			});
			continue;
		}
		// The clock-in works the rest of its shift: the break the shift still owes is planned in it,
		// as for a shift the minor clocked out of. Fixed until the shift ends, then it overruns.
		const state = stateOf(shift.id);
		const end = later(later(input.now, shift.end), record.start);
		intervals.push({
			ref,
			start: record.start,
			end,
			workMinutes: restOfShiftMinutes(
				shift,
				record.start,
				state.pieces,
				input.limitsOn(shift.date),
				end,
			),
			recorded: false,
			inProgress: true,
			plannedShift: plannedShiftOf(`shift:${shift.id}`, shift),
		});
		state.open = true;
	}

	for (const shift of input.shifts) {
		if (compareInstants(shift.end, input.now) <= 0) continue;
		const state = worked.get(shift.id);
		if (state?.open) continue;
		const ref = `shift:${shift.id}`;
		const limits = input.limitsOn(shift.date);
		if (!state) {
			intervals.push(plannedYouthInterval(ref, shift, limits));
			continue;
		}
		// Completed work ended before the shift does: the rest of the shift is still planned.
		const restStart = later(input.now, state.lastEnd ?? shift.start);
		if (compareInstants(restStart, shift.end) < 0) {
			intervals.push({
				ref,
				start: restStart,
				end: shift.end,
				workMinutes: restOfShiftMinutes(shift, restStart, state.pieces, limits),
				recorded: false,
				plannedShift: plannedShiftOf(ref, shift),
			});
		}
	}
	return intervals;
}
