import "server-only";

import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { Effect } from "effect";
import {
	absenceCategory,
	absenceEntry,
	employeeDeparture,
	employeeEmploymentPeriod,
	shift,
} from "@/db/schema";
import { absenceCategoryReleasesRequiredTime } from "@/lib/absences/required-time-release";
import { type EmploymentPeriodSnapshot, loadEffectiveContractsBatch } from "@/lib/contracts";
import {
	comparePlainDates,
	dateFromInstant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";
import type { EmploymentInterval } from "@/lib/employee-lifecycle/employment-coverage";
import type { EmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { resolvedPolicyVersionToEffectiveWorkPolicy } from "@/lib/work-policy/effective-work-policies";
import { getAssignedHolidaysForEmployees } from "./assigned-holidays";
import type { DailyWorkRequirements } from "./types";
import {
	type EmployeeRequirementInputs,
	loadDailyWorkRequirementsForEmployee,
} from "./work-policy-requirements";

export type RequirementEmployee = EmployeeRequirementInputs["scopedEmployee"] & {
	organizationId: string;
	teamId: string | null;
};

function enumeratePlainDates(start: PlainDate, end: PlainDate): PlainDate[] {
	if (comparePlainDates(start, end) > 0) return [];
	const dates: PlainDate[] = [];
	for (let cursor = start; comparePlainDates(cursor, end) <= 0; cursor = cursor.add({ days: 1 })) {
		dates.push(cursor);
	}
	return dates;
}

/** Existing requirement rules fed by one bounded, organization-scoped unified contract read. */
export const loadDailyWorkRequirementsForEmployees = Effect.fn("calendar.rangeRequirements")(
	function* (input: {
		organizationId: string;
		employees: readonly RequirementEmployee[];
		startDate: Date;
		endDate: Date;
		trackingByEmployee: ReadonlyMap<string, EmployeeTrackingContext | null>;
		includeLegacy?: boolean;
	}) {
		const database = yield* DatabaseService;
		const people = input.employees.filter(
			(person) =>
				person.organizationId === input.organizationId &&
				(input.includeLegacy || input.trackingByEmployee.get(person.id)),
		);
		const result = new Map<string, DailyWorkRequirements>();
		const policyByEmployee = new Map<string, EffectiveWorkPolicy | null>();
		const scopedIds = people.map((row) => row.id);
		if (!scopedIds.length) return { requirements: result, policyByEmployee };

		const start = instantFromDate(input.startDate);
		const end = instantFromDate(input.endDate);
		const earliestDate = plainDateAt(start.subtract({ hours: 48 }), "UTC");
		const latestDate = plainDateAt(end.add({ hours: 48 }), "UTC");
		const earliest = earliestDate.toString();
		const latest = latestDate.toString();

		const orgTimezone = resolveEffectiveTimezone(null, people[0]?.organization.timezone);
		const nowInstant = systemClock.nowInstant();
		const todayDate = plainDateAt(nowInstant, orgTimezone);
		const datesToResolve = enumeratePlainDates(earliestDate, latestDate);
		if (!datesToResolve.some((d) => comparePlainDates(d, todayDate) === 0)) {
			datesToResolve.push(todayDate);
		}

		// Load employment periods + effective departures once and share across both
		// employment coverage clipping and the unified contract batch resolver.
		const periodCoverageRows = yield* database.query("calendar.rangeEmploymentCoverage", () =>
			database.db
				.select({
					id: employeeEmploymentPeriod.id,
					employeeId: employeeEmploymentPeriod.employeeId,
					status: employeeEmploymentPeriod.status,
					startedAt: employeeEmploymentPeriod.startedAt,
					startProvenance: employeeEmploymentPeriod.startProvenance,
					endedAt: employeeEmploymentPeriod.endedAt,
					createdAt: employeeEmploymentPeriod.createdAt,
					departureId: employeeDeparture.id,
				})
				.from(employeeEmploymentPeriod)
				.leftJoin(
					employeeDeparture,
					and(
						eq(employeeDeparture.organizationId, employeeEmploymentPeriod.organizationId),
						eq(employeeDeparture.employmentPeriodId, employeeEmploymentPeriod.id),
						eq(employeeDeparture.status, "effective"),
					),
				)
				.where(
					and(
						eq(employeeEmploymentPeriod.organizationId, input.organizationId),
						inArray(employeeEmploymentPeriod.employeeId, scopedIds),
					),
				),
		);

		const coverage = new Map<string, EmploymentInterval[] | null>();
		const periodsByEmployee = Map.groupBy(periodCoverageRows, (row) => row.employeeId);
		const preloadedPeriods: EmploymentPeriodSnapshot[] = [];
		const seenPeriodIds = new Set<string>();
		for (const row of periodCoverageRows) {
			if (seenPeriodIds.has(row.id)) continue;
			seenPeriodIds.add(row.id);
			preloadedPeriods.push({
				id: row.id,
				employeeId: row.employeeId,
				status: row.status,
				startedAt: row.startedAt ? instantFromDate(row.startedAt) : null,
				startProvenance: row.startProvenance,
				endedAt: row.endedAt ? instantFromDate(row.endedAt) : null,
				createdAt: instantFromDate(row.createdAt),
			});
		}
		for (const employeeId of scopedIds) {
			const rows = periodsByEmployee.get(employeeId) ?? [];
			const intervals = rows.map((period) => ({
				startedAt:
					period.startProvenance === "recorded" && period.startedAt
						? instantFromDate(period.startedAt)
						: null,
				endedAt: period.departureId && period.endedAt ? instantFromDate(period.endedAt) : null,
			}));
			const hasLifecycleEvidence = intervals.some(
				(interval) => interval.startedAt !== null || interval.endedAt !== null,
			);
			coverage.set(employeeId, hasLifecycleEvidence ? intervals : null);
		}

		const [contractsByEmployee, absences, shifts, holidays] = yield* Effect.all([
			database.query("calendar.rangeContracts", () =>
				loadEffectiveContractsBatch(database.db, {
					organizationId: input.organizationId,
					employeeIds: scopedIds,
					dates: datesToResolve,
					organizationTimezone: orgTimezone,
					preloadedEmployees: people.map((person) => ({
						id: person.id,
						contractType: person.contractType,
						teamId: person.teamId,
						userTimezone: person.userSettings?.timezone ?? null,
					})),
					preloadedPeriods,
				}),
			),
			database.query("calendar.rangeApprovedAbsences", () =>
				database.db
					.select({
						employeeId: absenceEntry.employeeId,
						startDate: absenceEntry.startDate,
						startPeriod: absenceEntry.startPeriod,
						endDate: absenceEntry.endDate,
						endPeriod: absenceEntry.endPeriod,
					})
					.from(absenceEntry)
					.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
					.where(
						and(
							eq(absenceEntry.organizationId, input.organizationId),
							inArray(absenceEntry.employeeId, scopedIds),
							eq(absenceEntry.status, "approved"),
							eq(absenceCategory.organizationId, input.organizationId),
							absenceCategoryReleasesRequiredTime(),
							lte(absenceEntry.startDate, latest),
							gte(absenceEntry.endDate, earliest),
						),
					),
			),
			database.query("calendar.rangePublishedShifts", () =>
				database.db
					.select({
						employeeId: shift.employeeId,
						date: shift.date,
						startTime: shift.startTime,
						endTime: shift.endTime,
					})
					.from(shift)
					.where(
						and(
							eq(shift.organizationId, input.organizationId),
							inArray(shift.employeeId, scopedIds),
							eq(shift.status, "published"),
							gte(shift.date, dateFromInstant(start.subtract({ hours: 48 }))),
							lt(shift.date, dateFromInstant(end.add({ hours: 48 }))),
						),
					),
			),
			database.query("calendar.rangeAssignedHolidays", () =>
				getAssignedHolidaysForEmployees({
					database: database.db,
					organizationId: input.organizationId,
					employeeIds: scopedIds,
					employees: people,
					startDate: input.startDate,
					endDate: input.endDate,
				}),
			),
		]);

		const absencesByEmployee = Map.groupBy(absences, (row) => row.employeeId);
		const shiftsByEmployee = Map.groupBy(shifts, (row) => row.employeeId);
		const todayKey = todayDate.toString();

		for (const person of people) {
			const tracking = input.trackingByEmployee.get(person.id);
			const personContracts = contractsByEmployee.get(person.id);
			const todayContract = personContracts?.get(todayKey);
			policyByEmployee.set(
				person.id,
				todayContract?.workPolicy
					? resolvedPolicyVersionToEffectiveWorkPolicy(todayContract.workPolicy)
					: null,
			);
			if (!tracking) continue;

			const requirements = yield* loadDailyWorkRequirementsForEmployee(
				{
					organizationId: input.organizationId,
					employeeId: person.id,
					startDate: input.startDate,
					endDate: input.endDate,
				},
				{
					tracking,
					inputs: {
						scopedEmployee: person,
						contracts: personContracts,
						shifts: {
							organizationTimezone: resolveEffectiveTimezone(null, person.organization.timezone),
							shifts: shiftsByEmployee.get(person.id) ?? [],
						},
						absences: absencesByEmployee.get(person.id) ?? [],
						employmentCoverage: coverage.get(person.id) ?? null,
						holidays: holidays.get(person.id) ?? [],
					},
				},
			);
			result.set(person.id, requirements);
		}
		return { requirements: result, policyByEmployee };
	},
);
