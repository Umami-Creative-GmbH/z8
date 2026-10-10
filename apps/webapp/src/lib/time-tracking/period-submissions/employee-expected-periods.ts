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
import { loadEmploymentCoverage } from "@/lib/employee-lifecycle/employment-periods";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import { isUuid } from "@/lib/validations/uuid";
import { scheduledSubmissionPeriods } from "./cadence";
import {
	type AbsenceDayPart,
	deriveExpectedSubmissionPeriods,
	type ExpectedSubmissionPeriod,
	type ExpectedSubmissionPeriodFacts,
} from "./expected-periods";
import { loadSubmissionCadenceHistory } from "./settings";

type Database = typeof db;

/** Departures that will end the current employment unless cancelled. */
const UPCOMING_DEPARTURE_STATUSES = ["pending", "blocked"] as const;

function eachDayKey(startDate: PlainDate, endDate: PlainDate): string[] {
	const keys: string[] = [];
	for (let day = startDate; comparePlainDates(day, endDate) <= 0; day = day.add({ days: 1 })) {
		keys.push(day.toString());
	}
	return keys;
}

/**
 * Days in [startDate, endDate] on which the employee's schedule expects no work. Without any
 * scheduled working day in the range (no work policy schedule, or an hourly contract without
 * published shifts) no day is treated as non-working.
 */
async function loadNonWorkingDays(input: {
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

async function loadPublicHolidays(
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
 * Employment as lifecycle evidence records it. A stint without a recorded start falls back to the
 * legacy employee start date; a pending or blocked departure ends the open stint at its cutoff.
 */
async function loadEmployment(
	database: Database,
	input: {
		organizationId: string;
		employeeId: string;
		timezone: string;
		legacyStartDate: Date | null;
	},
): Promise<EmploymentInterval[]> {
	const [coverage, [upcomingDeparture]] = await Promise.all([
		loadEmploymentCoverage(database, input),
		database
			.select({ cutoffAt: employeeDeparture.cutoffAt })
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, input.organizationId),
					eq(employeeDeparture.employeeId, input.employeeId),
					inArray(employeeDeparture.status, [...UPCOMING_DEPARTURE_STATUSES]),
				),
			)
			.limit(1),
	]);
	const legacyStart = input.legacyStartDate
		? parsePlainDate(input.legacyStartDate.toISOString().slice(0, 10))
				.toZonedDateTime(input.timezone)
				.toInstant()
		: null;
	const intervals = (coverage ?? [{ startedAt: null, endedAt: null }]).map((interval) => ({
		startedAt: interval.startedAt ?? legacyStart,
		endedAt: interval.endedAt,
	}));
	if (!upcomingDeparture) return intervals;
	const cutoff = instantFromDate(upcomingDeparture.cutoffAt);
	return intervals.map((interval) =>
		interval.endedAt === null ? { ...interval, endedAt: cutoff } : interval,
	);
}

/**
 * Reads, scoped to the organization, every fact `deriveExpectedSubmissionPeriods` needs about one
 * employee for the periods overlapping `window`. Null when the employee is not in the
 * organization. Non-working days and holidays are read through the shared calendar readers, which
 * use the application database.
 */
export async function loadExpectedSubmissionPeriodFacts(
	database: Database,
	input: { organizationId: string; employeeId: string; window: { from: PlainDate; to: PlainDate } },
): Promise<ExpectedSubmissionPeriodFacts | null> {
	if (!isUuid(input.employeeId)) return null;
	const [target] = await database
		.select({
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
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		)
		.limit(1);
	if (!target) return null;

	const timezone = resolvePersonalTimezone({
		userTimezone: target.userTimezone ?? undefined,
		organizationTimezone: target.organizationTimezone ?? undefined,
	}).timezone;
	const facts: ExpectedSubmissionPeriodFacts = {
		cadenceHistory: [],
		timezone,
		employment: [],
		kioskOnly: isReservedEmail(target.email),
		approvedAbsences: [],
		publicHolidays: new Set(),
		nonWorkingDays: new Set(),
	};
	if (facts.kioskOnly) return facts;

	facts.cadenceHistory = await loadSubmissionCadenceHistory(database, input.organizationId);
	const scheduled = scheduledSubmissionPeriods(facts.cadenceHistory, timezone, input.window);
	const startDate = scheduled.at(0)?.startDate;
	const endDate = scheduled.at(-1)?.endDate;
	if (!startDate || !endDate) return facts;

	const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
	const [employment, absences, publicHolidays, nonWorkingDays] = await Promise.all([
		loadEmployment(database, { ...scope, timezone, legacyStartDate: target.startDate }),
		database
			.select({
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
					// No work is expected on the day: time off in lieu included.
					eq(absenceCategory.requiresWorkTime, false),
					lte(absenceEntry.startDate, endDate.toString()),
					gte(absenceEntry.endDate, startDate.toString()),
				),
			),
		loadPublicHolidays(database, { ...scope, startDate, endDate }),
		loadNonWorkingDays({ ...scope, timezone, startDate, endDate }),
	]);
	return {
		...facts,
		employment,
		approvedAbsences: absences.map((absence) => ({
			startDate: parsePlainDate(absence.startDate),
			startPeriod: absence.startPeriod as AbsenceDayPart,
			endDate: parsePlainDate(absence.endDate),
			endPeriod: absence.endPeriod as AbsenceDayPart,
		})),
		publicHolidays,
		nonWorkingDays,
	};
}

/**
 * The submission periods one employee of the organization is expected to submit that overlap
 * `window`, in their timezone. Empty for an employee outside the organization.
 */
export async function loadExpectedSubmissionPeriods(
	database: Database,
	input: { organizationId: string; employeeId: string; window: { from: PlainDate; to: PlainDate } },
): Promise<ExpectedSubmissionPeriod[]> {
	const facts = await loadExpectedSubmissionPeriodFacts(database, input);
	return facts ? deriveExpectedSubmissionPeriods(facts, input.window) : [];
}
