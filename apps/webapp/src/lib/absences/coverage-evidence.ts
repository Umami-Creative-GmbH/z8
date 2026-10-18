import { Temporal } from "temporal-polyfill";
import { type DayOfWeek, dayOfWeekOf } from "@/lib/coverage/domain/entities/coverage-rule";
import { localDayRange, resolveScheduledWallClock } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	comparePlainDates,
	earlierInstant,
	type Instant,
	laterInstant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { type ShiftInterval, shiftInterval } from "@/lib/scheduling/shift-occasion";
import { intervalsOverlap } from "@/lib/scheduling/staffing/staffing-blockers";
import {
	type AbsenceDurationInput,
	findAbsenceDurationIssue,
	normalizeAbsenceDurationInput,
} from "./duration";

/**
 * Coverage evidence for one previewed absence (#1341): which of the requester's published shifts
 * the absence actually overlaps, and where published colleague staffing would fall below the
 * configured coverage rules while they are away.
 *
 * Everything is judged as instants in the organization's zone: shifts and rules are wall-clock
 * times there, and explicit partial-day times, which carry no zone of their own, are read there
 * too. The viewer's zone never matters. The evidence is the published schedule only; colleagues'
 * absences are not considered.
 */

/** Why coverage evidence is incomplete. Several can apply at once. */
export type CoverageEvidenceGap =
	/** Some affected work has no applicable coverage rule. */
	| "rules_missing"
	/** Coverage rules apply to only part of some affected work. */
	| "rules_partial"
	/** Shifts or rules could not be read. */
	| "read_failed"
	/** Some request, shift or rule times could not be evaluated. */
	| "unsupported";

export interface CoverageRisk {
	/** Organization-local date of the understaffed interval. */
	date: string;
	subareaId: string;
	subareaName: string | null;
	/** Organization-local wall-clock `HH:mm`. */
	startTime: string;
	endTime: string;
	/** The highest minimum of the coverage rules applying to the interval. */
	minimumStaffCount: number;
	/** Distinct colleagues on published shifts throughout the interval, without the requester. */
	staffCountAfterAbsence: number;
}

export interface CoverageEvaluation {
	/** `complete` only when every affected interval was evaluated against applicable rules. */
	status: "complete" | "incomplete";
	gaps: CoverageEvidenceGap[];
	/** Known warnings; kept even when the evidence is incomplete. */
	risks: CoverageRisk[];
}

/** One of the requester's own published shifts that the absence overlaps. */
export interface AffectedShiftEvidence {
	id: string;
	subareaId: string;
	subareaName: string | null;
	/** Organization-local date the shift is planned on. */
	date: string;
	startTime: string;
	/** At or before `startTime` means the shift ends the next day. */
	endTime: string;
	/** The part of the shift the absence takes, organization-local `HH:mm`. */
	affectedStartTime: string;
	affectedEndTime: string;
}

export interface CoverageShiftEvidence {
	id: string;
	/** Null for an open shift, which adds no staff. */
	employeeId: string | null;
	subareaId: string;
	subareaName?: string | null;
	/** Organization-local calendar date, `YYYY-MM-DD`. */
	date: string;
	startTime: string;
	endTime: string;
}

export interface CoverageRuleEvidence {
	subareaId: string;
	subareaName: string | null;
	dayOfWeek: DayOfWeek;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
}

const NOON = "12:00";

/**
 * The absence as one instant interval in the organization's zone, or null when its dates or times
 * cannot be evaluated. Full days run from local midnight to midnight; legacy `am` ends a day at
 * noon and `pm` starts one at noon; explicit partial times are local wall-clock times.
 */
export function absenceInterval(
	request: AbsenceDurationInput,
	timezone: string,
): ShiftInterval | null {
	if (findAbsenceDurationIssue(request) !== null) return null;
	const normalized = normalizeAbsenceDurationInput(request);

	try {
		if (normalized.durationKind === "partial_day" && (normalized.startTime || normalized.endTime)) {
			const start = wallClock(normalized.startDate, normalized.startTime ?? "", timezone);
			const end = wallClock(normalized.endDate, normalized.endTime ?? "", timezone);
			return compareInstants(start, end) < 0 ? { start, end } : null;
		}

		const start =
			normalized.startPeriod === "pm"
				? wallClock(normalized.startDate, NOON, timezone)
				: localDayRange(normalized.startDate, timezone).start;
		const end =
			normalized.endPeriod === "am"
				? wallClock(normalized.endDate, NOON, timezone)
				: localDayRange(normalized.endDate, timezone).endExclusive;
		return compareInstants(start, end) < 0 ? { start, end } : null;
	} catch {
		return null;
	}
}

/**
 * The first and last shift dates whose shifts can overlap the request: a shift dated the day
 * before the absence can run past midnight into it.
 */
export function coverageShiftDateWindow(request: AbsenceDurationInput): {
	firstDate: PlainDate;
	lastDate: PlainDate;
} {
	const normalized = normalizeAbsenceDurationInput(request);
	return {
		firstDate: parsePlainDate(normalized.startDate).subtract({ days: 1 }),
		lastDate: parsePlainDate(normalized.endDate),
	};
}

interface AffectedWindow {
	shift: CoverageShiftEvidence;
	/** The absence's part of the shift. */
	window: ShiftInterval;
}

/**
 * The requester's shifts that the absence overlaps, with the overlapping part. `unsupported` is
 * set when the absence or a shift's times could not be evaluated.
 */
export function findAffectedShifts(input: {
	timezone: string;
	request: AbsenceDurationInput;
	requesterShifts: readonly CoverageShiftEvidence[];
}): { affected: AffectedShiftEvidence[]; unsupported: boolean } {
	const { windows, unsupported } = affectedWindows(input);
	return { affected: toAffectedShiftEvidence(windows, input.timezone), unsupported };
}

function toAffectedShiftEvidence(
	windows: readonly AffectedWindow[],
	timezone: string,
): AffectedShiftEvidence[] {
	return windows.map(({ shift, window }) => ({
		id: shift.id,
		subareaId: shift.subareaId,
		subareaName: shift.subareaName ?? null,
		date: shift.date,
		startTime: shift.startTime,
		endTime: shift.endTime,
		affectedStartTime: wallTime(window.start, timezone),
		affectedEndTime: wallTime(window.end, timezone),
	}));
}

function affectedWindows(input: {
	timezone: string;
	request: AbsenceDurationInput;
	requesterShifts: readonly CoverageShiftEvidence[];
}): { windows: AffectedWindow[]; unsupported: boolean } {
	const absence = absenceInterval(input.request, input.timezone);
	if (!absence) return { windows: [], unsupported: true };

	let unsupported = false;
	const windows: AffectedWindow[] = [];
	for (const shift of input.requesterShifts) {
		const interval = readShiftInterval(shift, input.timezone);
		if (!interval) {
			unsupported = true;
			continue;
		}
		const window = intersect(absence, interval);
		if (window) windows.push({ shift, window });
	}
	windows.sort((left, right) => compareInstants(left.window.start, right.window.start));
	return { windows, unsupported };
}

interface RuleInstance {
	start: Instant;
	end: Instant;
	minimumStaffCount: number;
	subareaName: string | null;
}

interface StaffedInterval {
	employeeId: string;
	start: Instant;
	end: Instant;
}

/**
 * Evaluates staffing only where the absence overlaps the requester's published work. Inside each
 * such window the requester is away; outside it they still count, so no warning arises there.
 * Within a window, staffing is segmented wherever a rule or a colleague's shift starts or ends,
 * and each segment is checked against the highest minimum of the rules applying to it.
 */
export function evaluateAbsenceCoverage(input: {
	timezone: string;
	request: AbsenceDurationInput;
	requesterEmployeeId: string;
	requesterShifts: readonly CoverageShiftEvidence[];
	/** Published shifts in the affected subareas, from the window of `coverageShiftDateWindow`. */
	publishedShifts: readonly CoverageShiftEvidence[];
	rules: readonly CoverageRuleEvidence[];
}): { affectedShifts: AffectedShiftEvidence[]; coverage: CoverageEvaluation } {
	const { timezone } = input;
	const gaps = new Set<CoverageEvidenceGap>();
	const { windows, unsupported } = affectedWindows(input);
	if (unsupported) gaps.add("unsupported");

	const colleagueIntervals = new Map<string, StaffedInterval[]>();
	for (const shift of input.publishedShifts) {
		if (!shift.employeeId || shift.employeeId === input.requesterEmployeeId) continue;
		const interval = readShiftInterval(shift, timezone);
		if (!interval) {
			gaps.add("unsupported");
			continue;
		}
		const list = colleagueIntervals.get(shift.subareaId) ?? [];
		list.push({ employeeId: shift.employeeId, ...interval });
		colleagueIntervals.set(shift.subareaId, list);
	}

	const risks: CoverageRisk[] = [];
	for (const { shift, window } of windows) {
		const instances = ruleInstancesWithin(window, shift.subareaId, input.rules, timezone, gaps);
		if (instances.length === 0) {
			gaps.add("rules_missing");
			continue;
		}
		if (!coversWindow(instances, window)) gaps.add("rules_partial");

		const subareaName =
			instances.find((instance) => instance.subareaName)?.subareaName ?? shift.subareaName ?? null;
		const colleagues = (colleagueIntervals.get(shift.subareaId) ?? []).filter((colleague) =>
			intervalsOverlap(colleague, window),
		);
		for (const segment of understaffedSegments(window, instances, colleagues)) {
			risks.push({
				date: plainDateAt(segment.start, timezone).toString(),
				subareaId: shift.subareaId,
				subareaName,
				startTime: wallTime(segment.start, timezone),
				endTime: wallTime(segment.end, timezone),
				minimumStaffCount: segment.minimumStaffCount,
				staffCountAfterAbsence: segment.staffCount,
			});
		}
	}

	return {
		affectedShifts: toAffectedShiftEvidence(windows, timezone),
		coverage: {
			status: gaps.size === 0 ? "complete" : "incomplete",
			gaps: [...gaps].sort(),
			risks: dedupeRisks(risks),
		},
	};
}

/** The rule instances of the window's dates in the subarea, cut to the window. */
function ruleInstancesWithin(
	window: ShiftInterval,
	subareaId: string,
	rules: readonly CoverageRuleEvidence[],
	timezone: string,
	gaps: Set<CoverageEvidenceGap>,
): RuleInstance[] {
	const instances: RuleInstance[] = [];
	const lastDate = plainDateAt(window.end.subtract({ nanoseconds: 1 }), timezone);
	for (
		let date = plainDateAt(window.start, timezone);
		comparePlainDates(date, lastDate) <= 0;
		date = date.add({ days: 1 })
	) {
		const dayOfWeek = dayOfWeekOf(date);
		for (const rule of rules) {
			if (rule.subareaId !== subareaId || rule.dayOfWeek !== dayOfWeek) continue;
			let interval: ShiftInterval;
			try {
				interval = {
					start: wallClock(date.toString(), rule.startTime, timezone),
					// Rule times stop at 23:59; a rule ending then runs to the end of its day.
					end: endsAtLastMinute(rule.endTime)
						? localDayRange(date.toString(), timezone).endExclusive
						: wallClock(date.toString(), rule.endTime, timezone),
				};
			} catch {
				gaps.add("unsupported");
				continue;
			}
			// Coverage rules never cross midnight.
			if (compareInstants(interval.start, interval.end) >= 0) {
				gaps.add("unsupported");
				continue;
			}
			const cut = intersect(interval, window);
			if (cut) {
				instances.push({
					...cut,
					minimumStaffCount: rule.minimumStaffCount,
					subareaName: rule.subareaName,
				});
			}
		}
	}
	return instances;
}

function coversWindow(instances: readonly ShiftInterval[], window: ShiftInterval): boolean {
	const sorted = [...instances].sort((left, right) => compareInstants(left.start, right.start));
	let coveredUntil = window.start;
	for (const instance of sorted) {
		if (compareInstants(instance.start, coveredUntil) > 0) return false;
		coveredUntil = laterInstant(coveredUntil, instance.end);
	}
	return compareInstants(coveredUntil, window.end) >= 0;
}

interface UnderstaffedSegment {
	start: Instant;
	end: Instant;
	minimumStaffCount: number;
	staffCount: number;
}

function understaffedSegments(
	window: ShiftInterval,
	instances: readonly RuleInstance[],
	colleagues: readonly StaffedInterval[],
): UnderstaffedSegment[] {
	const boundaries = uniqueSortedInstants([
		window.start,
		window.end,
		...instances.flatMap((instance) => [instance.start, instance.end]),
		...colleagues.flatMap((colleague) => [
			clamp(colleague.start, window),
			clamp(colleague.end, window),
		]),
	]);

	const segments: UnderstaffedSegment[] = [];
	for (let index = 0; index < boundaries.length - 1; index++) {
		const start = boundaries[index] as Instant;
		const end = boundaries[index + 1] as Instant;
		const applicable = instances.filter((instance) => spans(instance, start, end));
		if (applicable.length === 0) continue;

		const minimumStaffCount = Math.max(...applicable.map((instance) => instance.minimumStaffCount));
		const staffCount = new Set(
			colleagues
				.filter((colleague) => spans(colleague, start, end))
				.map((colleague) => colleague.employeeId),
		).size;
		if (staffCount >= minimumStaffCount) continue;

		const previous = segments.at(-1);
		if (
			previous &&
			compareInstants(previous.end, start) === 0 &&
			previous.minimumStaffCount === minimumStaffCount &&
			previous.staffCount === staffCount
		) {
			previous.end = end;
			continue;
		}
		segments.push({ start, end, minimumStaffCount, staffCount });
	}
	return segments;
}

function dedupeRisks(risks: readonly CoverageRisk[]): CoverageRisk[] {
	const byKey = new Map<string, CoverageRisk>();
	for (const risk of risks) {
		byKey.set([risk.date, risk.startTime, risk.endTime, risk.subareaId].join("|"), risk);
	}
	return [...byKey.values()].sort(
		(left, right) =>
			left.date.localeCompare(right.date) ||
			left.startTime.localeCompare(right.startTime) ||
			left.subareaId.localeCompare(right.subareaId),
	);
}

function readShiftInterval(shift: CoverageShiftEvidence, timezone: string): ShiftInterval | null {
	try {
		return shiftInterval(
			{ date: parsePlainDate(shift.date), startTime: shift.startTime, endTime: shift.endTime },
			timezone,
		);
	} catch {
		return null;
	}
}

function intersect(left: ShiftInterval, right: ShiftInterval): ShiftInterval | null {
	if (!intervalsOverlap(left, right)) return null;
	return { start: laterInstant(left.start, right.start), end: earlierInstant(left.end, right.end) };
}

function spans(interval: ShiftInterval, start: Instant, end: Instant): boolean {
	return compareInstants(interval.start, start) <= 0 && compareInstants(interval.end, end) >= 0;
}

function clamp(instant: Instant, window: ShiftInterval): Instant {
	return earlierInstant(laterInstant(instant, window.start), window.end);
}

function uniqueSortedInstants(instants: readonly Instant[]): Instant[] {
	const sorted = [...instants].sort(compareInstants);
	return sorted.filter(
		(instant, index) => index === 0 || compareInstants(instant, sorted[index - 1] as Instant) !== 0,
	);
}

/** Whether a wall-clock time is 23:59, the latest end a coverage rule can name. */
function endsAtLastMinute(time: string): boolean {
	const plainTime = Temporal.PlainTime.from(time);
	return plainTime.hour === 23 && plainTime.minute === 59;
}

function wallClock(date: string, time: string, timezone: string): Instant {
	return resolveScheduledWallClock({ date, time, timezone }).toInstant();
}

function wallTime(instant: Instant, timezone: string): string {
	return instant.toZonedDateTimeISO(timezone).toPlainTime().toString({ smallestUnit: "minute" });
}
