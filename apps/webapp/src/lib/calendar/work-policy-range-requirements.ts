import "server-only";

import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	or,
	sql,
} from "drizzle-orm";
import { Effect } from "effect";
import {
	absenceCategory,
	absenceEntry,
	employeeEmploymentHistory,
	shift,
	workPolicy,
	workPolicyAssignment,
} from "@/db/schema";
import { absenceCategoryReleasesRequiredTime } from "@/lib/absences/required-time-release";
import {
	dateFromInstant,
	instantFromDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { loadEmploymentCoverageByEmployee } from "@/lib/employee-lifecycle/employment-periods";
import {
	confirmedTermsSpans,
	termsSpansOverlapping,
} from "@/lib/employment-history/terms-in-force";
import type { EmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { getAssignedHolidaysForEmployees } from "./assigned-holidays";
import type { DailyWorkRequirements } from "./types";
import {
	type EmployeeRequirementInputs,
	loadDailyWorkRequirementsForEmployee,
	mapPolicyToEffective,
} from "./work-policy-requirements";

export type RequirementEmployee =
	EmployeeRequirementInputs["scopedEmployee"] & {
		organizationId: string;
		teamId: string | null;
	};

/** Existing requirement rules fed by one bounded, organization-scoped range read. */
export const loadDailyWorkRequirementsForEmployees = Effect.fn(
	"calendar.rangeRequirements",
)(function* (input: {
	organizationId: string;
	employees: readonly RequirementEmployee[];
	startDate: Date;
	endDate: Date;
	trackingByEmployee: ReadonlyMap<string, EmployeeTrackingContext | null>;
}) {
	const database = yield* DatabaseService;
	const people = input.employees.filter(
		(person) =>
			person.organizationId === input.organizationId &&
			input.trackingByEmployee.get(person.id),
	);
	const result = new Map<string, DailyWorkRequirements>();
	const scopedIds = people.map((row) => row.id);
	if (!scopedIds.length) return result;
	const start = instantFromDate(input.startDate),
		end = instantFromDate(input.endDate);
	const earliest = plainDateAt(start.subtract({ hours: 48 }), "UTC").toString();
	const latest = plainDateAt(end.add({ hours: 48 }), "UTC").toString();
	const terms = yield* database.query("calendar.rangeConfirmedTerms", () =>
		database.db
			.select()
			.from(employeeEmploymentHistory)
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, input.organizationId),
					inArray(employeeEmploymentHistory.employeeId, scopedIds),
					eq(employeeEmploymentHistory.reviewState, "confirmed"),
					lt(
						employeeEmploymentHistory.validFrom,
						dateFromInstant(end.add({ hours: 96 })),
					),
				),
			)
			.orderBy(
				asc(employeeEmploymentHistory.validFrom),
				asc(employeeEmploymentHistory.createdAt),
			),
	);
	const anyTerms = yield* database.query(
		"calendar.rangeConfirmedTermsPresence",
		() =>
			database.db
				.select({ employeeId: employeeEmploymentHistory.employeeId })
				.from(employeeEmploymentHistory)
				.where(
					and(
						eq(employeeEmploymentHistory.organizationId, input.organizationId),
						inArray(employeeEmploymentHistory.employeeId, scopedIds),
						eq(employeeEmploymentHistory.reviewState, "confirmed"),
					),
				)
				.groupBy(employeeEmploymentHistory.employeeId),
	);
	const hasTerms = new Set(anyTerms.map((row) => row.employeeId));
	const teams = people.flatMap((person) =>
		person.teamId ? [person.teamId] : [],
	);
	const now = dateFromInstant(systemClock.nowInstant());
	const assignments = yield* database.query(
		"calendar.rangePolicyAssignments",
		() =>
			database.db.query.workPolicyAssignment.findMany({
				where: and(
					eq(workPolicyAssignment.organizationId, input.organizationId),
					eq(workPolicyAssignment.isActive, true),
					or(
						isNull(workPolicyAssignment.effectiveFrom),
						lte(workPolicyAssignment.effectiveFrom, now),
					),
					or(
						isNull(workPolicyAssignment.effectiveUntil),
						gt(workPolicyAssignment.effectiveUntil, now),
					),
					or(
						eq(workPolicyAssignment.assignmentType, "organization"),
						and(
							eq(workPolicyAssignment.assignmentType, "team"),
							inArray(workPolicyAssignment.teamId, teams),
						),
						and(
							eq(workPolicyAssignment.assignmentType, "employee"),
							inArray(workPolicyAssignment.employeeId, scopedIds),
						),
					),
				),
				orderBy: [
					sql`${workPolicyAssignment.effectiveFrom} desc nulls last`,
					desc(workPolicyAssignment.createdAt),
					desc(workPolicyAssignment.id),
				],
			}),
	);
	const policyIds = [
		...new Set([
			...assignments.map((row) => row.policyId),
			...terms.flatMap((row) => (row.workPolicyId ? [row.workPolicyId] : [])),
		]),
	];
	const policyRows = policyIds.length
		? yield* database.query("calendar.rangePolicySchedules", () =>
				database.db.query.workPolicy.findMany({
					where: and(
						eq(workPolicy.organizationId, input.organizationId),
						inArray(workPolicy.id, policyIds),
						eq(workPolicy.isActive, true),
					),
					with: { schedule: { with: { days: true } } },
				}),
			)
		: [];
	const policies = new Map(
		policyRows.map((row) => [row.id, mapPolicyToEffective(row)]),
	);
	const absences = yield* database.query("calendar.rangeApprovedAbsences", () =>
		database.db
			.select({
				employeeId: absenceEntry.employeeId,
				startDate: absenceEntry.startDate,
				startPeriod: absenceEntry.startPeriod,
				endDate: absenceEntry.endDate,
				endPeriod: absenceEntry.endPeriod,
			})
			.from(absenceEntry)
			.innerJoin(
				absenceCategory,
				eq(absenceEntry.categoryId, absenceCategory.id),
			)
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
	);
	const shifts = yield* database.query("calendar.rangePublishedShifts", () =>
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
	);
	const coverage = yield* database.query(
		"calendar.rangeEmploymentCoverage",
		() =>
			loadEmploymentCoverageByEmployee(database.db, {
				organizationId: input.organizationId,
				employeeIds: scopedIds,
			}),
	);
	const holidays = yield* database.query("calendar.rangeAssignedHolidays", () =>
		getAssignedHolidaysForEmployees({
			database: database.db,
			organizationId: input.organizationId,
			employeeIds: scopedIds,
			employees: people,
			startDate: input.startDate,
			endDate: input.endDate,
		}),
	);
	const termsByEmployee = Map.groupBy(terms, (row) => row.employeeId);
	const absencesByEmployee = Map.groupBy(absences, (row) => row.employeeId);
	const shiftsByEmployee = Map.groupBy(shifts, (row) => row.employeeId);
	for (const person of people) {
		const tracking = input.trackingByEmployee.get(person.id);
		if (!tracking) continue;
		const range = {
			from: plainDateAt(start, tracking.timezone),
			toExclusive: plainDateAt(end, tracking.timezone).add({ days: 1 }),
		};
		// Same precedence as the scoped WorkPolicyService: employee, team, then organization;
		// the already ordered candidates skip inactive or foreign policies at each level.
		const fallback =
			["employee", "team", "organization"].flatMap((level) =>
				assignments
					.filter(
						(row) =>
							row.assignmentType === level &&
							(level === "employee"
								? row.employeeId === person.id
								: level === "team"
									? row.teamId === person.teamId
									: true),
					)
					.flatMap((row) => {
						const policy = policies.get(row.policyId);
						return policy ? [policy] : [];
					}),
			)[0] ?? null;
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
					fallbackPolicy: fallback,
					termsSpans: termsSpansOverlapping(
						confirmedTermsSpans(
							termsByEmployee.get(person.id) ?? [],
							tracking.timezone,
						),
						range,
					),
					hasConfirmedTerms: hasTerms.has(person.id),
					policies,
					shifts: {
						organizationTimezone: resolveEffectiveTimezone(
							null,
							person.organization.timezone,
						),
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
	return result;
});
