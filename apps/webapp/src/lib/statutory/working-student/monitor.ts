/**
 * Read-only working-student monitor (#1991): loads completed work, planned shifts, lecture-free
 * periods and prior-employer weeks for the employees whose effective contract is
 * `working_student`, then judges them with `weeks.ts`. Batched for many employees (Staffing passes
 * up to ~1000 candidates); employees who never had working-student terms cost one query.
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne } from "drizzle-orm";
import {
	employeeEmploymentHistory,
	employeeStatutoryOffset,
	employeeStudyPeriod,
	shift,
	workPeriod,
} from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import {
	compareInstants,
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
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
	/** Shifts starting before `now` are expected to show up as recorded work instead. */
	readonly now: Instant;
	readonly proposedShifts?: readonly StatutoryProposedShift[];
	readonly replacesShiftId?: string | null;
	readonly preferences?: StatutoryPreferences;
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

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
	return groups;
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
	const until = judged.toExclusive;
	const { timezone } = request;

	// Which weeks each candidate is a working student in, by the canonical contract resolver.
	const dates: string[] = [];
	for (let day = from; comparePlainDates(day, until) < 0; day = day.add({ days: 1 }))
		dates.push(day.toString());
	const contracts = await loadEffectiveContractsBatch(db, {
		organizationId: request.organizationId,
		employeeIds: candidates,
		dates,
		timezoneOverride: timezone,
		organizationTimezone: timezone,
	});
	const workingStudentWeeks = new Map<string, Set<string>>();
	for (const [employeeId, byDate] of contracts) {
		const mondays = new Set<string>();
		for (const [date, contract] of byDate) {
			if (contract.isEmployedOnDay && contract.employmentProfile === "working_student") {
				mondays.add(mondayOf(parsePlainDate(date)).toString());
			}
		}
		workingStudentWeeks.set(employeeId, mondays);
	}
	const inScope = candidates.filter((employeeId) => {
		const mondays = workingStudentWeeks.get(employeeId);
		if (!mondays) return false;
		for (
			let monday = judged.from;
			comparePlainDates(monday, judged.toExclusive) < 0;
			monday = monday.add({ weeks: 1 })
		) {
			if (mondays.has(monday.toString())) return true;
		}
		return false;
	});
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

	// A shift starting the day before the range may run into it.
	const shiftBounds = shiftDateRangeBounds(from.subtract({ days: 1 }), until, timezone);
	const shiftConditions = [
		eq(shift.organizationId, request.organizationId),
		inArray(shift.employeeId, inScope),
		gte(shift.date, shiftBounds.start),
		lt(shift.date, shiftBounds.endExclusive),
	];
	if (request.replacesShiftId) shiftConditions.push(ne(shift.id, request.replacesShiftId));
	const shiftRows = await db
		.select({
			id: shift.id,
			employeeId: shift.employeeId,
			date: shift.date,
			startTime: shift.startTime,
			endTime: shift.endTime,
		})
		.from(shift)
		.where(and(...shiftConditions));

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
		intervals.set(employeeId, [...(intervals.get(employeeId) ?? []), interval]);
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
		// A shift that has started is judged by the work recorded for it.
		if (compareInstants(interval.start, request.now) < 0) continue;
		add(row.employeeId, {
			source: "shift",
			ref: row.id,
			start: interval.start,
			end: interval.end,
			netMinutes: interval.start.until(interval.end).total("minutes"),
		});
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
		add(proposed.employeeId, {
			source: "proposed",
			ref: `${proposed.date}T${proposed.startTime}-${proposed.endTime}`,
			start: interval.start,
			end: interval.end,
			netMinutes: interval.start.until(interval.end).total("minutes"),
		});
	}
	const study = groupBy(studyRows, (row) => row.employeeId);
	const offsets = groupBy(offsetRows, (row) => row.employeeId);

	return inScope.map((employeeId) => {
		const mondays = workingStudentWeeks.get(employeeId) ?? new Set<string>();
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
			judgedWeeks: { from: judged.from.toString(), toExclusive: judged.toExclusive.toString() },
			thresholds,
			preferences,
			facts: {
				employeeId,
				intervals: intervals.get(employeeId) ?? [],
				lectureFreePeriods,
				priorOver20hWeeks,
				isWorkingStudentWeek: (monday) => mondays.has(monday),
			},
		});
		return { employeeId, ...evaluation };
	});
}
