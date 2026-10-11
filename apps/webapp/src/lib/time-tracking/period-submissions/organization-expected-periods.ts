import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, employee, userSettings } from "@/db/schema";
import { employeeDeparture } from "@/db/schema/employee-lifecycle";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import {
	comparePlainDates,
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type { EmploymentInterval } from "@/lib/employee-lifecycle/employment-coverage";
import { loadEmploymentCoverageByEmployee } from "@/lib/employee-lifecycle/employment-periods";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import { isUuid } from "@/lib/validations/uuid";
import { scheduledSubmissionPeriods } from "./cadence";
import {
	type AbsenceDayPart,
	type ApprovedAbsenceSpan,
	deriveExpectedSubmissionPeriods,
	type ExpectedSubmissionPeriod,
	type ExpectedSubmissionPeriodFacts,
} from "./expected-periods";
import { loadSubmissionCadenceHistory } from "./settings";

type Database = typeof db;

/** Departures that will end the current employment unless cancelled. */
const UPCOMING_DEPARTURE_STATUSES = ["pending", "blocked"] as const;

/** How many employees' holidays and work schedules are read at the same time. */
const SCHEDULE_READ_CONCURRENCY = 4;

function eachDayKey(startDate: PlainDate, endDate: PlainDate): string[] {
	const keys: string[] = [];
	for (let day = startDate; comparePlainDates(day, endDate) <= 0; day = day.add({ days: 1 })) {
		keys.push(day.toString());
	}
	return keys;
}

const minDate = (left: PlainDate, right: PlainDate) =>
	comparePlainDates(left, right) <= 0 ? left : right;
const maxDate = (left: PlainDate, right: PlainDate) =>
	comparePlainDates(left, right) >= 0 ? left : right;

/**
 * Days in [startDate, endDate] on which the employee's schedule expects no work. Without any
 * scheduled working day in the range (no work policy schedule, or an hourly contract without
 * published shifts) no day is treated as non-working.
 */
export async function loadNonWorkingDays(input: {
	organizationId: string;
	employeeId: string;
	timezone: string;
	startDate: PlainDate;
	endDate: PlainDate;
}): Promise<Set<string>> {
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
	// Days with a requirement stay keyed after absences and holidays release it.
	if (Object.keys(requirements).length === 0) return new Set();
	return new Set(eachDayKey(input.startDate, input.endDate).filter((key) => !requirements[key]));
}

export async function loadPublicHolidays(
	database: Database,
	input: { organizationId: string; employeeId: string; startDate: PlainDate; endDate: PlainDate },
): Promise<Set<string>> {
	const { getAssignedHolidayDateKeys, getAssignedHolidaysForEmployee } = await import(
		"@/lib/calendar/assigned-holidays"
	);
	const holidays = await getAssignedHolidaysForEmployee({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		// Holiday dates are calendar dates stored as UTC midnights.
		startDate: new Date(`${input.startDate}T00:00:00.000Z`),
		endDate: new Date(`${input.endDate}T23:59:59.999Z`),
		database,
	});
	return getAssignedHolidayDateKeys(holidays);
}

/**
 * Employment intervals from lifecycle coverage (null: no evidence), the legacy employee start
 * date for a stint without a recorded start, and the cutoff of a pending or blocked departure,
 * which ends the open stint.
 */
export function submissionEmployment(input: {
	coverage: readonly EmploymentInterval[] | null;
	legacyStartDate: Date | null;
	timezone: string;
	upcomingCutoff: Date | null;
}): EmploymentInterval[] {
	const legacyStart = input.legacyStartDate
		? parsePlainDate(input.legacyStartDate.toISOString().slice(0, 10))
				.toZonedDateTime(input.timezone)
				.toInstant()
		: null;
	const intervals = (input.coverage ?? [{ startedAt: null, endedAt: null }]).map((interval) => ({
		startedAt: interval.startedAt ?? legacyStart,
		endedAt: interval.endedAt,
	}));
	if (!input.upcomingCutoff) return intervals;
	const cutoff = instantFromDate(input.upcomingCutoff);
	return intervals.map((interval) =>
		interval.endedAt === null ? { ...interval, endedAt: cutoff } : interval,
	);
}

interface Candidate {
	employeeId: string;
	facts: ExpectedSubmissionPeriodFacts;
	legacyStartDate: Date | null;
	startDate: PlainDate;
	endDate: PlainDate;
}

/**
 * The one reader of expected-period facts (#1057, #1063): for each employee of the organization
 * among `employeeIds`, every fact `deriveExpectedSubmissionPeriods` needs for the periods
 * overlapping `window`, keyed by employee id. Employees outside the organization are left out.
 *
 * Employees, the cadence history, employment, departures and absences are read in one query each.
 * Holidays and work schedules are read per employee, and only for an employee with a period the
 * other facts still expect: more covered days can only remove a period, so an employee without
 * one keeps empty holiday and non-working sets. Holidays and schedules use the shared calendar
 * readers, whose schedule read uses the application database (not transaction-consistent).
 */
export async function loadExpectedSubmissionFactsByEmployee(
	database: Database,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		window: { from: PlainDate; to: PlainDate };
	},
): Promise<Map<string, ExpectedSubmissionPeriodFacts>> {
	const factsByEmployee = new Map<string, ExpectedSubmissionPeriodFacts>();
	const employeeIds = [...new Set(input.employeeIds)].filter(isUuid);
	if (employeeIds.length === 0) return factsByEmployee;

	const [targets, cadenceHistory] = await Promise.all([
		database
			.select({
				employeeId: employee.id,
				startDate: employee.startDate,
				email: user.email,
				userTimezone: userSettings.timezone,
				organizationTimezone: organization.timezone,
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.innerJoin(organization, eq(organization.id, employee.organizationId))
			.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
			.where(
				and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
			),
		loadSubmissionCadenceHistory(database, input.organizationId),
	]);

	const candidates: Candidate[] = [];
	for (const target of targets) {
		const timezone = resolvePersonalTimezone({
			userTimezone: target.userTimezone ?? undefined,
			organizationTimezone: target.organizationTimezone ?? undefined,
		}).timezone;
		const kioskOnly = isReservedEmail(target.email);
		const facts: ExpectedSubmissionPeriodFacts = {
			cadenceHistory: kioskOnly ? [] : cadenceHistory,
			timezone,
			employment: [],
			kioskOnly,
			approvedAbsences: [],
			publicHolidays: new Set(),
			nonWorkingDays: new Set(),
		};
		factsByEmployee.set(target.employeeId, facts);
		if (kioskOnly) continue;
		const scheduled = scheduledSubmissionPeriods(cadenceHistory, timezone, input.window);
		const startDate = scheduled.at(0)?.startDate;
		const endDate = scheduled.at(-1)?.endDate;
		if (!startDate || !endDate) continue;
		candidates.push({
			employeeId: target.employeeId,
			facts,
			legacyStartDate: target.startDate,
			startDate,
			endDate,
		});
	}
	const [first] = candidates;
	if (!first) return factsByEmployee;

	const candidateIds = candidates.map((candidate) => candidate.employeeId);
	const rangeStart = candidates.reduce(
		(date, item) => minDate(date, item.startDate),
		first.startDate,
	);
	const rangeEnd = candidates.reduce((date, item) => maxDate(date, item.endDate), first.endDate);
	const [coverage, departures, absences] = await Promise.all([
		loadEmploymentCoverageByEmployee(database, {
			organizationId: input.organizationId,
			employeeIds: candidateIds,
		}),
		database
			.select({ employeeId: employeeDeparture.employeeId, cutoffAt: employeeDeparture.cutoffAt })
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, input.organizationId),
					inArray(employeeDeparture.employeeId, candidateIds),
					inArray(employeeDeparture.status, [...UPCOMING_DEPARTURE_STATUSES]),
				),
			),
		database
			.select({
				employeeId: absenceEntry.employeeId,
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
					inArray(absenceEntry.employeeId, candidateIds),
					eq(absenceEntry.status, "approved"),
					eq(absenceCategory.organizationId, input.organizationId),
					// No work is expected on the day: time off in lieu included.
					eq(absenceCategory.requiresWorkTime, false),
					lte(absenceEntry.startDate, rangeEnd.toString()),
					gte(absenceEntry.endDate, rangeStart.toString()),
				),
			),
	]);
	const cutoffs = new Map(departures.map((row) => [row.employeeId, row.cutoffAt]));
	const absencesByEmployee = new Map<string, ApprovedAbsenceSpan[]>();
	for (const absence of absences) {
		const spans = absencesByEmployee.get(absence.employeeId) ?? [];
		spans.push({
			startDate: parsePlainDate(absence.startDate),
			startPeriod: absence.startPeriod as AbsenceDayPart,
			endDate: parsePlainDate(absence.endDate),
			endPeriod: absence.endPeriod as AbsenceDayPart,
		});
		absencesByEmployee.set(absence.employeeId, spans);
	}

	const survivors: Candidate[] = [];
	for (const candidate of candidates) {
		const facts: ExpectedSubmissionPeriodFacts = {
			...candidate.facts,
			employment: submissionEmployment({
				coverage: coverage.get(candidate.employeeId) ?? null,
				legacyStartDate: candidate.legacyStartDate,
				timezone: candidate.facts.timezone,
				upcomingCutoff: cutoffs.get(candidate.employeeId) ?? null,
			}),
			approvedAbsences: absencesByEmployee.get(candidate.employeeId) ?? [],
		};
		factsByEmployee.set(candidate.employeeId, facts);
		if (deriveExpectedSubmissionPeriods(facts, input.window).length > 0) {
			survivors.push({ ...candidate, facts });
		}
	}

	for (let index = 0; index < survivors.length; index += SCHEDULE_READ_CONCURRENCY) {
		await Promise.all(
			survivors.slice(index, index + SCHEDULE_READ_CONCURRENCY).map(async (candidate) => {
				const scope = {
					organizationId: input.organizationId,
					employeeId: candidate.employeeId,
					startDate: candidate.startDate,
					endDate: candidate.endDate,
				};
				const [publicHolidays, nonWorkingDays] = await Promise.all([
					loadPublicHolidays(database, scope),
					loadNonWorkingDays({ ...scope, timezone: candidate.facts.timezone }),
				]);
				factsByEmployee.set(candidate.employeeId, {
					...candidate.facts,
					publicHolidays,
					nonWorkingDays,
				});
			}),
		);
	}
	return factsByEmployee;
}

/**
 * Each employee's expected submission periods overlapping `window`, in their own timezone, keyed
 * by employee id (#1063). Employees outside the organization are left out of the map.
 */
export async function loadExpectedSubmissionPeriodsByEmployee(
	database: Database,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		window: { from: PlainDate; to: PlainDate };
	},
): Promise<Map<string, ExpectedSubmissionPeriod[]>> {
	const facts = await loadExpectedSubmissionFactsByEmployee(database, input);
	return new Map(
		[...facts].map(([employeeId, employeeFacts]) => [
			employeeId,
			deriveExpectedSubmissionPeriods(employeeFacts, input.window),
		]),
	);
}
