import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, employee, userSettings } from "@/db/schema";
import { employeeDeparture } from "@/db/schema/employee-lifecycle";
import { isReservedEmail } from "@/lib/auth/reserved-email";
import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { loadEmploymentCoverageByEmployee } from "@/lib/employee-lifecycle/employment-periods";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import { isUuid } from "@/lib/validations/uuid";
import { scheduledSubmissionPeriods } from "./cadence";
import {
	loadNonWorkingDays,
	loadPublicHolidays,
	submissionEmployment,
} from "./employee-expected-periods";
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

interface Candidate {
	employeeId: string;
	timezone: string;
	legacyStartDate: Date | null;
	startDate: PlainDate;
	endDate: PlainDate;
}

const minDate = (left: PlainDate, right: PlainDate) =>
	comparePlainDates(left, right) <= 0 ? left : right;
const maxDate = (left: PlainDate, right: PlainDate) =>
	comparePlainDates(left, right) >= 0 ? left : right;

/**
 * `loadExpectedSubmissionPeriods` for several employees of one organization (#1063): each
 * employee's expected submission periods overlapping `window`, in their own timezone, keyed by
 * employee id. Employees outside the organization are left out of the map.
 *
 * Employees, the cadence history, employment, departures and absences are read in one query each.
 * Holidays and work schedules are read per employee, and only for employees with a period the
 * other facts still expect: more covered days can only remove a period.
 */
export async function loadExpectedSubmissionPeriodsByEmployee(
	database: Database,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		window: { from: PlainDate; to: PlainDate };
	},
): Promise<Map<string, ExpectedSubmissionPeriod[]>> {
	const expected = new Map<string, ExpectedSubmissionPeriod[]>();
	const employeeIds = [...new Set(input.employeeIds)].filter(isUuid);
	if (employeeIds.length === 0) return expected;

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
		expected.set(target.employeeId, []);
		if (isReservedEmail(target.email)) continue;
		const timezone = resolvePersonalTimezone({
			userTimezone: target.userTimezone ?? undefined,
			organizationTimezone: target.organizationTimezone ?? undefined,
		}).timezone;
		const scheduled = scheduledSubmissionPeriods(cadenceHistory, timezone, input.window);
		const startDate = scheduled.at(0)?.startDate;
		const endDate = scheduled.at(-1)?.endDate;
		if (!startDate || !endDate) continue;
		candidates.push({
			employeeId: target.employeeId,
			timezone,
			legacyStartDate: target.startDate,
			startDate,
			endDate,
		});
	}
	const [first] = candidates;
	if (!first) return expected;

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

	const survivors: Array<{ candidate: Candidate; facts: ExpectedSubmissionPeriodFacts }> = [];
	for (const candidate of candidates) {
		const facts: ExpectedSubmissionPeriodFacts = {
			cadenceHistory,
			timezone: candidate.timezone,
			employment: submissionEmployment({
				coverage: coverage.get(candidate.employeeId) ?? null,
				legacyStartDate: candidate.legacyStartDate,
				timezone: candidate.timezone,
				upcomingCutoff: cutoffs.get(candidate.employeeId) ?? null,
			}),
			kioskOnly: false,
			approvedAbsences: absencesByEmployee.get(candidate.employeeId) ?? [],
			publicHolidays: new Set(),
			nonWorkingDays: new Set(),
		};
		if (deriveExpectedSubmissionPeriods(facts, input.window).length > 0) {
			survivors.push({ candidate, facts });
		}
	}

	for (let index = 0; index < survivors.length; index += SCHEDULE_READ_CONCURRENCY) {
		await Promise.all(
			survivors
				.slice(index, index + SCHEDULE_READ_CONCURRENCY)
				.map(async ({ candidate, facts }) => {
					const scope = {
						organizationId: input.organizationId,
						employeeId: candidate.employeeId,
						startDate: candidate.startDate,
						endDate: candidate.endDate,
					};
					const [publicHolidays, nonWorkingDays] = await Promise.all([
						loadPublicHolidays(database, scope),
						loadNonWorkingDays({ ...scope, timezone: candidate.timezone }),
					]);
					expected.set(
						candidate.employeeId,
						deriveExpectedSubmissionPeriods(
							{ ...facts, publicHolidays, nonWorkingDays },
							input.window,
						),
					);
				}),
		);
	}
	return expected;
}
