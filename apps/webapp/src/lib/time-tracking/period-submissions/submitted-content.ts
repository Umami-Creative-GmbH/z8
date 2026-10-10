import { and, asc, eq, gt, gte, lt, lte } from "drizzle-orm";
import { absenceCategory, absenceEntry, workPeriod, workPolicyViolation } from "@/db/schema";
import type {
	PeriodSubmissionAbsenceFact,
	PeriodSubmissionDayPart,
	PeriodSubmissionHolidayFact,
	PeriodSubmissionSubmittedFacts,
	PeriodSubmissionViolationFact,
} from "@/lib/approvals/evidence/period-submission-facts";
import { buildDailyCompletedMinutes } from "@/lib/calendar/work-hours-summary";
import {
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import type { PeriodSubmissionDatabase } from "./submission-store";

/**
 * What a period submission confirms (#1059, #1061): the completed work of the submitted range,
 * the approved absences and public holidays in it, the work policy's target, and the compliance
 * violations recorded in it. Read in the submission's transaction, scoped to the organization,
 * the employee and the submitted range, and captured as the submitted facts.
 */
export type PeriodSubmissionContent = Pick<
	PeriodSubmissionSubmittedFacts,
	"work" | "absences" | "holidays" | "target" | "violations"
>;

export interface PeriodSubmissionContentInput {
	organizationId: string;
	employeeId: string;
	timezone: string;
	/** Inclusive local dates of the submitted range. */
	startDate: PlainDate;
	endDate: PlainDate;
	/** The range as instants, `[start, end)`. */
	range: { start: Instant; end: Instant };
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
	return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));
}

function laterDate(a: PlainDate, b: PlainDate): PlainDate {
	return comparePlainDates(a, b) >= 0 ? a : b;
}

function earlierDate(a: PlainDate, b: PlainDate): PlainDate {
	return comparePlainDates(a, b) <= 0 ? a : b;
}

async function loadWork(
	database: PeriodSubmissionDatabase,
	input: PeriodSubmissionContentInput,
): Promise<PeriodSubmissionContent["work"]> {
	const start = dateFromInstant(input.range.start);
	const end = dateFromInstant(input.range.end);
	const rows = await database
		.select({ startTime: workPeriod.startTime, endTime: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				completedWorkPeriodCondition(),
				lt(workPeriod.startTime, end),
				gt(workPeriod.endTime, start),
			),
		);
	const dayTotals = sortedRecord(
		buildDailyCompletedMinutes(
			rows.flatMap((row) =>
				row.endTime ? [{ startedAt: row.startTime, endedAt: row.endTime }] : [],
			),
			input.timezone,
			{ start, endExclusive: end },
		),
	);
	return {
		totalMinutes: Object.values(dayTotals).reduce((total, minutes) => total + minutes, 0),
		dayTotals,
	};
}

/** Approved absences overlapping the range, clipped to it; a clipped end is a full day. */
async function loadAbsences(
	database: PeriodSubmissionDatabase,
	input: PeriodSubmissionContentInput,
): Promise<PeriodSubmissionAbsenceFact[]> {
	const rows = await database
		.select({
			categoryName: absenceCategory.name,
			startDate: absenceEntry.startDate,
			startPeriod: absenceEntry.startPeriod,
			endDate: absenceEntry.endDate,
			endPeriod: absenceEntry.endPeriod,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceCategory.id, absenceEntry.categoryId))
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.employeeId, input.employeeId),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.organizationId, input.organizationId),
				lte(absenceEntry.startDate, input.endDate.toString()),
				gte(absenceEntry.endDate, input.startDate.toString()),
			),
		)
		.orderBy(asc(absenceEntry.startDate), asc(absenceEntry.endDate), asc(absenceCategory.name));
	return rows.map((row) => {
		const start = parsePlainDate(row.startDate);
		const end = parsePlainDate(row.endDate);
		const startClipped = comparePlainDates(start, input.startDate) < 0;
		const endClipped = comparePlainDates(end, input.endDate) > 0;
		return {
			categoryName: row.categoryName,
			startDate: laterDate(start, input.startDate).toString(),
			startPeriod: startClipped ? "full_day" : (row.startPeriod as PeriodSubmissionDayPart),
			endDate: earlierDate(end, input.endDate).toString(),
			endPeriod: endClipped ? "full_day" : (row.endPeriod as PeriodSubmissionDayPart),
		};
	});
}

/** Holidays assigned to the employee in the range, clipped to it. */
async function loadHolidays(
	database: PeriodSubmissionDatabase,
	input: PeriodSubmissionContentInput,
): Promise<PeriodSubmissionHolidayFact[]> {
	const { getAssignedHolidaysForEmployee } = await import("@/lib/calendar/assigned-holidays");
	const holidays = await getAssignedHolidaysForEmployee({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		// Holiday dates are calendar dates stored as UTC midnights.
		startDate: new Date(`${input.startDate}T00:00:00.000Z`),
		endDate: new Date(`${input.endDate}T23:59:59.999Z`),
		database,
	});
	const facts = new Map<string, PeriodSubmissionHolidayFact>();
	for (const holiday of holidays) {
		const start = laterDate(
			parsePlainDate(holiday.startDate.toISOString().slice(0, 10)),
			input.startDate,
		);
		const end = earlierDate(
			parsePlainDate(holiday.endDate.toISOString().slice(0, 10)),
			input.endDate,
		);
		if (comparePlainDates(start, end) > 0) continue;
		const fact = { name: holiday.name, startDate: start.toString(), endDate: end.toString() };
		facts.set(`${fact.startDate}/${fact.endDate}/${fact.name}`, fact);
	}
	return [...facts.values()].toSorted(
		(a, b) =>
			a.startDate.localeCompare(b.startDate) ||
			a.endDate.localeCompare(b.endDate) ||
			a.name.localeCompare(b.name),
	);
}

/**
 * The work policy's target per local date after absences and holidays. Null when no work policy
 * gives the employee a requirement in the range. Read through the shared calendar reader, which
 * uses the application database.
 */
async function loadTarget(
	input: PeriodSubmissionContentInput,
): Promise<PeriodSubmissionContent["target"]> {
	const { getDailyWorkRequirementsForEmployee } = await import(
		"@/lib/calendar/work-policy-requirements"
	);
	const requirements = await getDailyWorkRequirementsForEmployee({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		startDate: dateFromInstant(input.startDate.toZonedDateTime(input.timezone).toInstant()),
		endDate: dateFromInstant(input.endDate.toZonedDateTime(input.timezone).toInstant()),
		timezone: input.timezone,
	});
	const start = input.startDate.toString();
	const end = input.endDate.toString();
	const inRange = Object.entries(requirements).filter(([date]) => date >= start && date <= end);
	if (inRange.length === 0) return null;
	const dayTargets = sortedRecord(
		Object.fromEntries(
			inRange
				.map(([date, requirement]) => [date, requirement.requiredMinutes] as const)
				.filter(([, minutes]) => minutes > 0),
		),
	);
	return {
		totalMinutes: Object.values(dayTargets).reduce((total, minutes) => total + minutes, 0),
		dayTargets,
	};
}

/** Compliance violations recorded in the range, on their local date in the period's zone. */
async function loadViolations(
	database: PeriodSubmissionDatabase,
	input: PeriodSubmissionContentInput,
): Promise<PeriodSubmissionViolationFact[]> {
	const rows = await database
		.select({
			violationDate: workPolicyViolation.violationDate,
			violationType: workPolicyViolation.violationType,
		})
		.from(workPolicyViolation)
		.where(
			and(
				eq(workPolicyViolation.organizationId, input.organizationId),
				eq(workPolicyViolation.employeeId, input.employeeId),
				gte(workPolicyViolation.violationDate, dateFromInstant(input.range.start)),
				lt(workPolicyViolation.violationDate, dateFromInstant(input.range.end)),
			),
		)
		.orderBy(asc(workPolicyViolation.violationDate), asc(workPolicyViolation.violationType));
	return rows.map((row) => ({
		date: plainDateAt(instantFromDate(row.violationDate), input.timezone).toString(),
		type: row.violationType,
	}));
}

export async function loadPeriodSubmissionContent(
	database: PeriodSubmissionDatabase,
	input: PeriodSubmissionContentInput,
): Promise<PeriodSubmissionContent> {
	// One query at a time: the caller's client may be a transaction's single connection.
	const work = await loadWork(database, input);
	const absences = await loadAbsences(database, input);
	const holidays = await loadHolidays(database, input);
	const target = await loadTarget(input);
	const violations = await loadViolations(database, input);
	return { work, absences, holidays, target, violations };
}
