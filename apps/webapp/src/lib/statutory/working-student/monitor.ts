/**
 * Read-only working-student monitor (#1991): loads work (completed and in progress), planned
 * shifts, lecture-free periods and prior-employer weeks for the employees whose effective contract
 * is `working_student` in a judged week, then judges them with `weeks.ts`. All their work in the
 * rolling window counts, whatever the profile it was done under (the 26-week ceiling counts every
 * week above 20 h); which days are working-student days comes from the canonical contract
 * resolution, once per employment-profile span. Batched for many employees (Staffing passes up to
 * ~1000 candidates); employees who never had working-student terms cost one query.
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne } from "drizzle-orm";
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
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { shiftCalendarDate, shiftDateRangeBounds } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
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
	 * Recorded work counts up to `now` (a running clock-in up to `now` itself), planned and proposed
	 * shifts from `now` on: a shift in progress counts with its remaining part, an ended one not at all.
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

	const workRows = await db
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
		);
	// Running clock-ins count up to `now`.
	const openRows =
		compareInstants(request.now, rangeStart) > 0
			? await db
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
			: [];

	// Only shifts still running at `now` count, and a shift ends within a day of its date: one
	// starting the day before the range (or before today) may still run into it.
	const yesterday = plainDateAt(request.now, timezone).subtract({ days: 1 });
	const dayBeforeRange = from.subtract({ days: 1 });
	const shiftsFrom = comparePlainDates(yesterday, dayBeforeRange) > 0 ? yesterday : dayBeforeRange;
	const loadShifts = async () => {
		const shiftBounds = shiftDateRangeBounds(shiftsFrom, until, timezone);
		const shiftConditions = [
			eq(shift.organizationId, request.organizationId),
			inArray(shift.employeeId, inScope),
			gte(shift.date, shiftBounds.start),
			lt(shift.date, shiftBounds.endExclusive),
		];
		if (request.replacesShiftId) shiftConditions.push(ne(shift.id, request.replacesShiftId));
		return db
			.select({
				id: shift.id,
				employeeId: shift.employeeId,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
			})
			.from(shift)
			.where(and(...shiftConditions));
	};
	// Once the whole range is over, no shift in it can still count.
	const shiftRows = comparePlainDates(shiftsFrom, until) < 0 ? await loadShifts() : [];

	const studyRows = await db
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
		);

	const offsetRows = await db
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
		);

	const thresholds = await loadStatutoryThresholds(db, {
		keys: [WEEKLY_LIMIT_KEY, CEILING_KEY],
		from: from.toString(),
		until: until.toString(),
	});
	const preferences =
		request.preferences ?? (await loadOrganizationStatutoryPreferences(db, request.organizationId));

	const intervals = new Map<string, WorkingStudentWorkInterval[]>();
	const add = (employeeId: string, interval: WorkingStudentWorkInterval) =>
		push(intervals, employeeId, interval);
	/**
	 * A planned or proposed shift counts from `now` on: its past is judged by the work recorded for
	 * it (a running clock-in counts up to `now`, so nothing is counted twice), its future by the plan.
	 */
	const addPlanned = (
		employeeId: string,
		source: "shift" | "proposed",
		ref: string,
		interval: { readonly start: Instant; readonly end: Instant },
	) => {
		if (compareInstants(interval.end, request.now) <= 0) return;
		const start = compareInstants(interval.start, request.now) < 0 ? request.now : interval.start;
		add(employeeId, {
			source,
			ref,
			start,
			end: interval.end,
			netMinutes: start.until(interval.end).total("minutes"),
		});
	};
	for (const row of openRows) {
		const start = instantFromDate(row.startTime);
		add(row.employeeId, {
			source: "work",
			ref: row.id,
			start,
			end: request.now,
			netMinutes: start.until(request.now).total("minutes"),
		});
	}
	for (const row of workRows) {
		if (!row.endTime) continue;
		const start = instantFromDate(row.startTime);
		const end = instantFromDate(row.endTime);
		add(row.employeeId, {
			source: "work",
			ref: row.id,
			start,
			end,
			netMinutes: row.durationMinutes ?? start.until(end).total("minutes"),
		});
	}
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
		addPlanned(row.employeeId, "shift", row.id, interval);
	}
	for (const proposed of request.proposedShifts ?? []) {
		const interval = shiftInterval(
			{
				date: parsePlainDate(proposed.date),
				startTime: proposed.startTime,
				endTime: proposed.endTime,
			},
			timezone,
		);
		const ref = `${proposed.date}T${proposed.startTime}-${proposed.endTime}`;
		addPlanned(proposed.employeeId, "proposed", ref, interval);
	}
	const study = groupBy(studyRows, (row) => row.employeeId);
	const offsets = groupBy(offsetRows, (row) => row.employeeId);
	/** The forward range for the ceiling, ending after the last week with work: no work, no finding. */
	const ceilingUntil = (own: readonly WorkingStudentWorkInterval[]): string | undefined => {
		if (!request.judgeCeilingForward) return undefined;
		let last = judged.toExclusive;
		for (const interval of own) {
			const next = mondayOf(plainDateAt(interval.end, timezone)).add({ weeks: 1 });
			if (comparePlainDates(next, last) > 0) last = next;
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
		const evaluation = evaluateWorkingStudentEmployee({
			organizationId: request.organizationId,
			timezone,
			judgedWeeks: {
				from: judged.from.toString(),
				toExclusive: judged.toExclusive.toString(),
				ceilingToExclusive: ceilingUntil(intervals.get(employeeId) ?? []),
			},
			thresholds,
			preferences,
			facts: {
				employeeId,
				intervals: intervals.get(employeeId) ?? [],
				lectureFreePeriods,
				priorOver20hWeeks,
				isWorkingStudentDay: (date) => inWorkingStudentSpan(spans, date),
			},
		});
		return { employeeId, ...evaluation };
	});
}
