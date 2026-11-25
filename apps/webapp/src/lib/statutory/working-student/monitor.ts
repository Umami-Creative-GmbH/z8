/**
 * Read-only working-student monitor (#1991): loads work (completed and in progress), planned
 * shifts, lecture-free periods and prior-employer weeks for the employees whose effective contract
 * is `working_student` in a judged week, then judges them with `weeks.ts`. All their work in the
 * rolling window counts, whatever the profile it was done under (the 26-week ceiling counts every
 * week above 20 h); which days are working-student days comes from the canonical contract
 * resolution, once per employment-profile span. Batched for many employees (Staffing passes up to
 * ~1000 candidates); employees who never had working-student terms cost one query.
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import {
	employeeEmploymentHistory,
	employeeStatutoryOffset,
	employeeStudyPeriod,
	shift,
	workPeriod,
} from "@/db/schema";
import {
	type EmploymentProfileInterval,
	loadEmploymentProfileIntervals,
} from "@/lib/contracts/employment-profile-intervals";
import {
	compareInstants,
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadEmployeeTime } from "@/lib/engagement/engagement-stints";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { shiftInterval, workMatchesShift } from "@/lib/scheduling/shift-occasion";
import { employeeProposedShifts, employeeShiftRows, employeeWorkRows } from "../employee-time";
import type { StatutoryProposedShift } from "../scheduling/contributor";
import { loadOrganizationStatutoryPreferences, type StatutoryPreferences } from "../preferences";
import { loadStatutoryThresholds } from "../thresholds";
import {
	CEILING_KEY,
	evaluateWorkingStudentEmployee,
	mondayOf,
	WEEKLY_LIMIT_KEY,
	WORKING_STUDENT_ROLLING_WEEKS,
	type WorkingStudentEvaluation,
	type WorkingStudentLectureFreePeriod,
	type WorkingStudentPriorWeeks,
	type WorkingStudentWorkInterval,
} from "./weeks";

type Reader = Pick<DatabaseClient, "select">;

export interface WorkingStudentMonitorRequest {
	readonly organizationId: string;
	/** Organization calendar timezone: compliance weeks are Monday–Sunday in it. */
	readonly timezone: string;
	/** Organization-local days to judge, `[start, endExclusive)`; whole weeks touching them are judged. */
	readonly window: { readonly start: string; readonly endExclusive: string };
	readonly employeeIds: readonly string[];
	/**
	 * Completed work counts as recorded. Shifts (planned and proposed) that have not ended count in
	 * full, a running clock-in on one of them up to the shift's end, a clock-in without a shift up to
	 * `now`; an ended shift counts only by its recorded work.
	 */
	readonly now: Instant;
	readonly proposedShifts?: readonly StatutoryProposedShift[];
	readonly replacesShiftId?: string | null;
	readonly preferences?: StatutoryPreferences;
	/**
	 * Also judge later weeks for the 26-week ceiling: every week up to 51 weeks after the judged
	 * ones (or the last planned work) whose rolling window includes a judged week, as long as a
	 * judged week is itself above 20 h. Scheduling and Staffing set it, so a week newly above 20 h
	 * shows the later week it makes the 27th.
	 */
	readonly judgeCeilingForward?: boolean;
	/**
	 * Staffing's baseline run: the proposals it is compared with. Not counted; with
	 * `judgeCeilingForward` they decide whether later weeks are judged, as in the run that counts
	 * them, so both runs report the same later weeks.
	 */
	readonly ceilingForwardProposals?: readonly StatutoryProposedShift[];
}

export interface WorkingStudentEmployeeEvaluation extends WorkingStudentEvaluation {
	readonly employeeId: string;
}

/** The Mondays of the weeks touching `[start, endExclusive)`, as `[from, toExclusive)`. */
export function judgedWeeksOf(window: WorkingStudentMonitorRequest["window"]): {
	from: PlainDate;
	toExclusive: PlainDate;
} {
	const start = parsePlainDate(window.start);
	const lastDay = parsePlainDate(window.endExclusive).subtract({ days: 1 });
	return {
		from: mondayOf(start),
		toExclusive: mondayOf(comparePlainDates(lastDay, start) < 0 ? start : lastDay).add({
			weeks: 1,
		}),
	};
}

function push<V>(groups: Map<string, V[]>, key: string, value: V): void {
	const list = groups.get(key);
	if (list) list.push(value);
	else groups.set(key, [value]);
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) push(groups, key(row), row);
	return groups;
}

const WORKING_STUDENT = "working_student";

/** Whether `date` falls in a working-student span; spans are sorted and contiguous. */
function inWorkingStudentSpan(spans: readonly EmploymentProfileInterval[], date: string): boolean {
	let lo = 0;
	let hi = spans.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const span = spans[mid];
		if (!span) return false;
		if (date < span.from) hi = mid - 1;
		else if (date >= span.untilExclusive) lo = mid + 1;
		else return span.employmentProfile === WORKING_STUDENT;
	}
	return false;
}

/** A persisted or proposed shift; one that has ended counts only through a clock-in still open on it. */
interface PlannedShift {
	readonly source: "shift" | "proposed";
	readonly ref: string;
	readonly start: Instant;
	readonly end: Instant;
}

/**
 * One employee's work in progress and planned work, figured so a day going as planned leaves the
 * totals (and the fingerprints made of them) as they are from one minute to the next:
 *
 * - a running clock-in counts on the whole-minute grid, from the minute it was made in, so its
 *   seconds never tip the rounded totals;
 * - a running clock-in that belongs to a shift (it matches the shift, or runs into it) stands in
 *   for the shift: its time inside the shift counts to the shift's end, a fixed figure, also once
 *   the shift has ended;
 * - its minutes outside its shifts (clocked in early, between two shifts, past the last one's end)
 *   count up to `now` and grow once a minute, whether or not the clock has reached the shift yet,
 *   so the figure does not jump when it does; a clock-in that belongs to no shift grows whole;
 * - every other shift that has not ended counts in full, even one that started without a
 *   clock-in, less the part completed work matched to it already covers (a clocked-out break
 *   keeps the rest of the shift until the shift ends). An ended shift counts by its work.
 */
function inProgressContributions(input: {
	readonly now: Instant;
	readonly planned: readonly PlannedShift[];
	readonly open: readonly { readonly ref: string; readonly start: Instant }[];
	readonly closed: readonly { readonly start: Instant; readonly end: Instant }[];
}): WorkingStudentWorkInterval[] {
	const contributions: WorkingStudentWorkInterval[] = [];
	const covered = new Set<PlannedShift>();
	const nowMinute = input.now.round({ smallestUnit: "minute", roundingMode: "floor" });
	const push = (
		ref: string,
		start: Instant,
		end: Instant,
		runningUntil: WorkingStudentWorkInterval["runningUntil"],
	) => {
		if (compareInstants(end, start) <= 0) return;
		contributions.push({
			source: "work",
			ref,
			start,
			end,
			netMinutes: start.until(end).total("minutes"),
			runningUntil,
		});
	};
	for (const clockIn of input.open) {
		// Counted from the clock-in's whole minute: 08:00:42 on an 08:00 shift is the shift as planned.
		const start = clockIn.start.round({ smallestUnit: "minute", roundingMode: "floor" });
		// Its shifts' time from the clock-in on, as disjoint intervals in start order.
		const inShifts: { start: Instant; end: Instant }[] = [];
		for (const planned of input.planned
			.filter(
				(planned) =>
					workMatchesShift(planned, { start: clockIn.start, end: null }) ||
					(compareInstants(clockIn.start, planned.end) < 0 &&
						compareInstants(planned.start, input.now) < 0),
			)
			.toSorted((a, b) => compareInstants(a.start, b.start))) {
			covered.add(planned);
			const from = compareInstants(planned.start, start) > 0 ? planned.start : start;
			const last = inShifts.at(-1);
			if (last && compareInstants(from, last.end) <= 0) {
				if (compareInstants(planned.end, last.end) > 0) last.end = planned.end;
			} else if (compareInstants(from, planned.end) < 0) {
				inShifts.push({ start: from, end: planned.end });
			}
		}
		// Inside its shifts it counts to their end, a fixed figure. Every minute outside them (clocked
		// in early, between shifts, past the last one's end) grows with the clock, whether or not the
		// clock has reached the shift yet, so the figure does not jump when it does.
		let cursor = start;
		for (const interval of inShifts) {
			const gapEnd = compareInstants(interval.start, nowMinute) < 0 ? interval.start : nowMinute;
			push(clockIn.ref, cursor, gapEnd, "now");
			push(clockIn.ref, interval.start, interval.end, "shift_end");
			cursor = interval.end;
		}
		push(clockIn.ref, cursor, nowMinute, "now");
	}
	for (const planned of input.planned) {
		if (covered.has(planned) || compareInstants(planned.end, input.now) <= 0) continue;
		let start = planned.start;
		for (const work of input.closed) {
			if (workMatchesShift(planned, work) && compareInstants(work.end, start) > 0) start = work.end;
		}
		if (compareInstants(start, planned.end) >= 0) continue;
		contributions.push({
			source: planned.source,
			ref: planned.ref,
			start,
			end: planned.end,
			netMinutes: start.until(planned.end).total("minutes"),
		});
	}
	return contributions;
}

/** Employees among `employeeIds` (all when null) who ever had confirmed working-student terms. */
export async function loadWorkingStudentCandidates(
	db: Reader,
	input: { readonly organizationId: string; readonly employeeIds: readonly string[] | null },
): Promise<string[]> {
	if (input.employeeIds?.length === 0) return [];
	const conditions = [
		eq(employeeEmploymentHistory.organizationId, input.organizationId),
		eq(employeeEmploymentHistory.reviewState, "confirmed"),
		eq(employeeEmploymentHistory.employmentProfile, "working_student"),
	];
	if (input.employeeIds) {
		conditions.push(inArray(employeeEmploymentHistory.employeeId, [...input.employeeIds]));
	}
	const rows = await db
		.select({ employeeId: employeeEmploymentHistory.employeeId })
		.from(employeeEmploymentHistory)
		.where(and(...conditions))
		.groupBy(employeeEmploymentHistory.employeeId);
	return rows.map((row) => row.employeeId).sort();
}

/**
 * Judges the weeks touching `window` for every employee who is a working student in one of them.
 * Returns one evaluation per such employee (weeks of the rolling window included), in id order.
 */
export async function evaluateWorkingStudents(
	db: Reader,
	request: WorkingStudentMonitorRequest,
): Promise<WorkingStudentEmployeeEvaluation[]> {
	const candidates = await loadWorkingStudentCandidates(db, {
		organizationId: request.organizationId,
		employeeIds: request.employeeIds,
	});
	if (candidates.length === 0) return [];

	const judged = judgedWeeksOf(request.window);
	const from = judged.from.subtract({ weeks: WORKING_STUDENT_ROLLING_WEEKS - 1 });
	// The last judged week stays in the rolling window of the 51 weeks after it.
	const until = request.judgeCeilingForward
		? judged.toExclusive.add({ weeks: WORKING_STUDENT_ROLLING_WEEKS - 1 })
		: judged.toExclusive;
	const { timezone } = request;

	// Which days each candidate is a working student on, by the canonical contract resolution.
	const profiles = await loadEmploymentProfileIntervals(db, {
		organizationId: request.organizationId,
		employeeIds: candidates,
		from,
		untilExclusive: until,
		timezone,
	});
	const judgedFrom = judged.from.toString();
	const scopeUntil = until.toString();
	const inScope = candidates.filter((employeeId) =>
		(profiles.get(employeeId) ?? []).some(
			(span) =>
				span.employmentProfile === WORKING_STUDENT &&
				span.from < scopeUntil &&
				span.untilExclusive > judgedFrom,
		),
	);
	if (inScope.length === 0) return [];

	const rangeStart = from.toZonedDateTime(timezone).toInstant();
	const rangeEnd = until.toZonedDateTime(timezone).toInstant();

	// Independent reads on a pool-backed client (views, the review inbox, Scheduling's compliance
	// window and Staffing): never a transaction, since working students block no publication.
	const [
		employeeTime,
		storedWorkRows,
		storedOpenRows,
		studyRows,
		offsetRows,
		thresholds,
		preferences,
	] = await Promise.all([
		// Employee time only (#2010): an External Contractor stint is no working-student work, to
		// the instant on a conversion day, and no other profile's work either.
		loadEmployeeTime(db, request.organizationId, inScope),
		db
			.select({
				id: workPeriod.id,
				employeeId: workPeriod.employeeId,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
				durationMinutes: workPeriod.durationMinutes,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, request.organizationId),
					inArray(workPeriod.employeeId, inScope),
					completedWorkPeriodCondition(),
					isNotNull(workPeriod.endTime),
					lt(workPeriod.startTime, dateFromInstant(rangeEnd)),
					gt(workPeriod.endTime, dateFromInstant(rangeStart)),
				),
			),
		// Running clock-ins count up to `now`.
		compareInstants(request.now, rangeStart) > 0
			? db
					.select({
						id: workPeriod.id,
						employeeId: workPeriod.employeeId,
						startTime: workPeriod.startTime,
					})
					.from(workPeriod)
					.where(
						and(
							eq(workPeriod.organizationId, request.organizationId),
							inArray(workPeriod.employeeId, inScope),
							eq(workPeriod.isActive, true),
							isNull(workPeriod.deletedAt),
							isNull(workPeriod.endTime),
							lt(workPeriod.startTime, dateFromInstant(request.now)),
							lt(workPeriod.startTime, dateFromInstant(rangeEnd)),
						),
					)
			: [],
		db
			.select({
				id: employeeStudyPeriod.id,
				employeeId: employeeStudyPeriod.employeeId,
				startsOn: employeeStudyPeriod.startsOn,
				endsOn: employeeStudyPeriod.endsOn,
			})
			.from(employeeStudyPeriod)
			.where(
				and(
					eq(employeeStudyPeriod.organizationId, request.organizationId),
					inArray(employeeStudyPeriod.employeeId, inScope),
					isNull(employeeStudyPeriod.voidedAt),
					lt(employeeStudyPeriod.startsOn, until.toString()),
					gte(employeeStudyPeriod.endsOn, from.toString()),
				),
			),
		db
			.select({
				id: employeeStatutoryOffset.id,
				employeeId: employeeStatutoryOffset.employeeId,
				validFromDate: employeeStatutoryOffset.validFromDate,
				validUntilDate: employeeStatutoryOffset.validUntilDate,
			})
			.from(employeeStatutoryOffset)
			.where(
				and(
					eq(employeeStatutoryOffset.organizationId, request.organizationId),
					inArray(employeeStatutoryOffset.employeeId, inScope),
					eq(employeeStatutoryOffset.offsetKind, "prior_working_student_over_20h_weeks"),
					isNull(employeeStatutoryOffset.voidedAt),
					lt(employeeStatutoryOffset.validFromDate, until.toString()),
					gt(employeeStatutoryOffset.validUntilDate, from.toString()),
				),
			),
		loadStatutoryThresholds(db, {
			keys: [WEEKLY_LIMIT_KEY, CEILING_KEY],
			from: from.toString(),
			until: until.toString(),
		}),
		request.preferences ?? loadOrganizationStatutoryPreferences(db, request.organizationId),
	]);
	const workRows = employeeWorkRows(employeeTime, storedWorkRows);
	const openRows = employeeWorkRows(
		employeeTime,
		storedOpenRows.map((row) => ({ ...row, endTime: null, durationMinutes: null })),
	);

	// Only shifts still running at `now` count, and a shift ends within a day of its date: one
	// starting the day before the range (or before today) may still run into it.
	const yesterday = plainDateAt(request.now, timezone).subtract({ days: 1 });
	const dayBeforeRange = from.subtract({ days: 1 });
	const later = (a: PlainDate, b: PlainDate) => (comparePlainDates(a, b) > 0 ? a : b);
	const shiftsFrom = later(yesterday, dayBeforeRange);
	// An open clock-in stands in for every shift it has run through (`inProgressContributions`),
	// however long ago it started: its employee's shifts load from the day before it, so a shift it
	// covers keeps counting to its end when its date falls behind yesterday at midnight.
	const openShiftsFrom = new Map<string, PlainDate>();
	for (const row of openRows) {
		const day = later(
			plainDateAt(instantFromDate(row.startTime), timezone).subtract({ days: 1 }),
			dayBeforeRange,
		);
		const known = openShiftsFrom.get(row.employeeId);
		if (comparePlainDates(day, shiftsFrom) < 0 && (!known || comparePlainDates(day, known) < 0)) {
			openShiftsFrom.set(row.employeeId, day);
		}
	}
	const earliestShiftsFrom = [...openShiftsFrom.values()].reduce(
		(a, b) => (comparePlainDates(a, b) <= 0 ? a : b),
		shiftsFrom,
	);
	const loadShifts = async () => {
		const shiftBounds = shiftDateRangeBounds(shiftsFrom, until, timezone);
		const shiftConditions = [
			eq(shift.organizationId, request.organizationId),
			inArray(shift.employeeId, inScope),
			or(
				gte(shift.date, shiftBounds.start),
				...[...openShiftsFrom].map(([employeeId, day]) =>
					and(
						eq(shift.employeeId, employeeId),
						gte(shift.date, shiftDateRangeBounds(day, until, timezone).start),
					),
				),
			),
			lt(shift.date, shiftBounds.endExclusive),
		];
		if (request.replacesShiftId) shiftConditions.push(ne(shift.id, request.replacesShiftId));
		return employeeShiftRows(
			employeeTime,
			await db
				.select({
					id: shift.id,
					employeeId: shift.employeeId,
					date: shift.date,
					startTime: shift.startTime,
					endTime: shift.endTime,
				})
				.from(shift)
				.where(and(...shiftConditions)),
			timezone,
		);
	};
	// Once the whole range is over, no shift in it can still count.
	const shiftRows = comparePlainDates(earliestShiftsFrom, until) < 0 ? await loadShifts() : [];

	// Shifts (persisted and proposed) that may still count: one that has not ended, or an ended one a
	// clock-in still open on it stands in for (`inProgressContributions`). Only an open clock-in can
	// reach back to an ended shift; otherwise an ended shift is judged by its work.
	const openEmployees = new Set(openRows.map((row) => row.employeeId));
	const notEnded = (planned: PlannedShift, employeeId: string) =>
		openEmployees.has(employeeId) || compareInstants(planned.end, request.now) > 0;
	const persistedShifts = new Map<string, PlannedShift[]>();
	for (const row of shiftRows) {
		if (!row.employeeId) continue;
		const interval = shiftInterval(
			{
				date: shiftCalendarDate(row.date, timezone),
				startTime: row.startTime,
				endTime: row.endTime,
			},
			timezone,
		);
		const planned: PlannedShift = { source: "shift", ref: row.id, ...interval };
		if (notEnded(planned, row.employeeId)) push(persistedShifts, row.employeeId, planned);
	}
	const proposedShiftsOf = (proposals: readonly StatutoryProposedShift[]) => {
		const byEmployee = new Map<string, PlannedShift[]>();
		for (const proposed of employeeProposedShifts(employeeTime, proposals, timezone)) {
			const interval = shiftInterval(
				{
					date: parsePlainDate(proposed.date),
					startTime: proposed.startTime,
					endTime: proposed.endTime,
				},
				timezone,
			);
			const ref = `${proposed.date}T${proposed.startTime}-${proposed.endTime}`;
			const planned: PlannedShift = { source: "proposed", ref, ...interval };
			if (notEnded(planned, proposed.employeeId)) push(byEmployee, proposed.employeeId, planned);
		}
		return byEmployee;
	};

	const completedWork = new Map<string, WorkingStudentWorkInterval[]>();
	// Only recent work can belong to a shift that has not ended (a shift lasts less than a day).
	const recentFrom = request.now.subtract({ hours: 48 });
	const recentWork = new Map<string, { start: Instant; end: Instant }[]>();
	for (const row of workRows) {
		if (!row.endTime) continue;
		const start = instantFromDate(row.startTime);
		const end = instantFromDate(row.endTime);
		push(completedWork, row.employeeId, {
			source: "work",
			ref: row.id,
			start,
			end,
			netMinutes: row.durationMinutes ?? start.until(end).total("minutes"),
		});
		if (compareInstants(end, recentFrom) > 0) push(recentWork, row.employeeId, { start, end });
	}
	const openByEmployee = groupBy(openRows, (row) => row.employeeId);
	/** An employee's completed work, work in progress and planned work, with `proposed` shifts. */
	const intervalsOf = (
		employeeId: string,
		proposed: ReadonlyMap<string, readonly PlannedShift[]>,
	): WorkingStudentWorkInterval[] => [
		...(completedWork.get(employeeId) ?? []),
		...inProgressContributions({
			now: request.now,
			planned: [...(persistedShifts.get(employeeId) ?? []), ...(proposed.get(employeeId) ?? [])],
			open: (openByEmployee.get(employeeId) ?? []).map((row) => ({
				ref: row.id,
				start: instantFromDate(row.startTime),
			})),
			closed: recentWork.get(employeeId) ?? [],
		}),
	];
	const counted = proposedShiftsOf(request.proposedShifts ?? []);
	const compared =
		request.judgeCeilingForward && request.ceilingForwardProposals
			? proposedShiftsOf(request.ceilingForwardProposals)
			: null;

	const study = groupBy(studyRows, (row) => row.employeeId);
	const offsets = groupBy(offsetRows, (row) => row.employeeId);
	/** The forward range for the ceiling, ending after the last week with work: no work, no finding. */
	const ceilingUntil = (
		...lists: readonly (readonly WorkingStudentWorkInterval[])[]
	): string | undefined => {
		if (!request.judgeCeilingForward) return undefined;
		let last = judged.toExclusive;
		for (const own of lists) {
			for (const interval of own) {
				const next = mondayOf(plainDateAt(interval.end, timezone)).add({ weeks: 1 });
				if (comparePlainDates(next, last) > 0) last = next;
			}
		}
		return (comparePlainDates(last, until) < 0 ? last : until).toString();
	};

	return inScope.map((employeeId) => {
		const spans = profiles.get(employeeId) ?? [];
		const lectureFreePeriods: WorkingStudentLectureFreePeriod[] = (study.get(employeeId) ?? []).map(
			(row) => ({ id: row.id, startsOn: row.startsOn, endsOn: row.endsOn }),
		);
		const priorOver20hWeeks: WorkingStudentPriorWeeks[] = (offsets.get(employeeId) ?? []).flatMap(
			(row) =>
				row.validUntilDate
					? [{ id: row.id, from: row.validFromDate, until: row.validUntilDate }]
					: [],
		);
		const intervals = intervalsOf(employeeId, counted);
		const facts = {
			employeeId,
			intervals,
			lectureFreePeriods,
			priorOver20hWeeks,
			isWorkingStudentDay: (date: string) => inWorkingStudentSpan(spans, date),
		};
		const judgedWeeks = {
			from: judged.from.toString(),
			toExclusive: judged.toExclusive.toString(),
		};
		const evaluate = (
			weeks: Parameters<typeof evaluateWorkingStudentEmployee>[0]["judgedWeeks"],
			own: readonly WorkingStudentWorkInterval[],
		) =>
			evaluateWorkingStudentEmployee({
				organizationId: request.organizationId,
				timezone,
				judgedWeeks: weeks,
				thresholds,
				preferences,
				facts: { ...facts, intervals: own },
			});

		if (!compared) {
			const ceilingToExclusive = ceilingUntil(intervals);
			return { employeeId, ...evaluate({ ...judgedWeeks, ceilingToExclusive }, intervals) };
		}
		// Staffing's baseline: judge the later weeks the run with the proposal judges, so a later
		// week the proposal leaves at its tier is not reported as added.
		const withProposal = intervalsOf(employeeId, compared);
		const ceilingForwardOpen = evaluate(judgedWeeks, withProposal).weeks.some(
			(week) =>
				week.overLimit &&
				week.weekStart >= judgedWeeks.from &&
				week.weekStart < judgedWeeks.toExclusive,
		);
		const ceilingToExclusive = ceilingUntil(intervals, withProposal);
		const evaluation = evaluate(
			{ ...judgedWeeks, ceilingToExclusive, ceilingForwardOpen },
			intervals,
		);
		return { employeeId, ...evaluation };
	});
}
