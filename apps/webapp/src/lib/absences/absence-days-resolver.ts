import "server-only";

import { and, eq, gte, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { employee, workPolicyAssignment } from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type AbsenceDayRange,
	countAbsenceDays,
	type IsWorkingDay,
	mondayToFriday,
} from "./absence-days";
import { getVacationHolidays } from "./vacation-holidays";
import { type WorkingDayPolicyAssignment, workingDaysFrom } from "./working-days";

/** The caller's client: the global `db`, its `DatabaseService`'s, or a transaction. */
export type AbsenceDaysDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface WorkingDaysRange {
	/** First calendar day, `YYYY-MM-DD`. */
	startDate: string;
	/** Last calendar day (inclusive), `YYYY-MM-DD`. */
	endDate: string;
}

function utcDayStart(date: Temporal.PlainDate): Date {
	return new Date(date.toZonedDateTime("UTC").epochMilliseconds);
}

/**
 * The working days of each employee in the organization over a range (Absences ADR 0001).
 * It reads the employees, every work policy assignment that can reach them inside the range,
 * and each employee's assigned holidays: a bounded number of queries per employee, however
 * long the range. An employee outside the organization gets no entry.
 */
export async function loadWorkingDaysForEmployees(
	database: AbsenceDaysDatabase,
	input: WorkingDaysRange & { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, IsWorkingDay>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();

	const employees = await database
		.select({ id: employee.id, teamId: employee.teamId })
		.from(employee)
		.where(
			and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)),
		);
	if (employees.length === 0) return new Map();

	const rangeStart = utcDayStart(Temporal.PlainDate.from(input.startDate));
	const rangeEndExclusive = utcDayStart(Temporal.PlainDate.from(input.endDate).add({ days: 1 }));
	const teamIds = [...new Set(employees.flatMap((row) => (row.teamId ? [row.teamId] : [])))];
	const reachableAssignments: SQL[] = [
		eq(workPolicyAssignment.assignmentType, "organization"),
		and(
			eq(workPolicyAssignment.assignmentType, "employee"),
			inArray(
				workPolicyAssignment.employeeId,
				employees.map((row) => row.id),
			),
		) as SQL,
	];
	if (teamIds.length > 0) {
		reachableAssignments.push(
			and(
				eq(workPolicyAssignment.assignmentType, "team"),
				inArray(workPolicyAssignment.teamId, teamIds),
			) as SQL,
		);
	}

	const [assignments, holidays] = await Promise.all([
		database.query.workPolicyAssignment.findMany({
			where: and(
				eq(workPolicyAssignment.organizationId, input.organizationId),
				eq(workPolicyAssignment.isActive, true),
				or(...reachableAssignments),
				or(
					isNull(workPolicyAssignment.effectiveFrom),
					lt(workPolicyAssignment.effectiveFrom, rangeEndExclusive),
				),
				or(
					isNull(workPolicyAssignment.effectiveUntil),
					gte(workPolicyAssignment.effectiveUntil, rangeStart),
				),
			),
			columns: {
				id: true,
				assignmentType: true,
				teamId: true,
				employeeId: true,
				effectiveFrom: true,
				effectiveUntil: true,
				createdAt: true,
			},
			with: {
				policy: {
					columns: { organizationId: true, isActive: true, scheduleEnabled: true },
					with: {
						schedule: {
							columns: { scheduleType: true, workingDaysPreset: true },
							with: { days: { columns: { dayOfWeek: true, isWorkDay: true } } },
						},
					},
				},
			},
		}),
		Promise.all(
			employees.map((row) =>
				getVacationHolidays({
					database,
					organizationId: input.organizationId,
					employeeId: row.id,
					startDate: input.startDate,
					endDate: input.endDate,
				}),
			),
		),
	]);

	const policyAssignments = assignments.flatMap((assignment) => {
		const policy = assignment.policy;
		if (!policy?.isActive || policy.organizationId !== input.organizationId) return [];
		const workingDayAssignment: WorkingDayPolicyAssignment = {
			id: assignment.id,
			assignmentType: assignment.assignmentType,
			effectiveFrom: assignment.effectiveFrom ? instantFromDate(assignment.effectiveFrom) : null,
			effectiveUntil: assignment.effectiveUntil ? instantFromDate(assignment.effectiveUntil) : null,
			createdAt: instantFromDate(assignment.createdAt),
			schedule: policy.scheduleEnabled ? (policy.schedule ?? null) : null,
		};
		return [
			{ ...workingDayAssignment, teamId: assignment.teamId, employeeId: assignment.employeeId },
		];
	});

	return new Map(
		employees.map((row, index) => [
			row.id,
			workingDaysFrom({
				assignments: policyAssignments.filter(
					(assignment) =>
						assignment.assignmentType === "organization" ||
						(assignment.assignmentType === "team" && assignment.teamId === row.teamId) ||
						(assignment.assignmentType === "employee" && assignment.employeeId === row.id),
				),
				holidays: holidays[index] ?? [],
			}),
		]),
	);
}

/** One employee's working days over a range; Monday to Friday when they aren't in the organization. */
export async function loadWorkingDays(
	database: AbsenceDaysDatabase,
	input: WorkingDaysRange & { organizationId: string; employeeId: string },
): Promise<IsWorkingDay> {
	const workingDays = await loadWorkingDaysForEmployees(database, {
		...input,
		employeeIds: [input.employeeId],
	});
	return workingDays.get(input.employeeId) ?? mondayToFriday;
}

/** The absence days of one employee's absence: the one server-side source (Absences ADR 0001). */
export async function getAbsenceDays(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeId: string; absence: AbsenceDayRange },
): Promise<number> {
	const isWorkingDay = await loadWorkingDays(database, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		startDate: input.absence.startDate,
		endDate: input.absence.endDate,
	});
	return countAbsenceDays(input.absence, isWorkingDay);
}

/**
 * The absence days of many absences, possibly of many employees, by absence id. The working
 * days load once per employee, over the range all the absences span.
 */
export async function getAbsenceDaysByAbsenceId(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		absences: ReadonlyArray<AbsenceDayRange & { id: string; employeeId: string }>;
	},
): Promise<Map<string, number>> {
	const [first, ...rest] = input.absences;
	if (!first) return new Map();

	let { startDate, endDate } = first;
	for (const absence of rest) {
		if (absence.startDate < startDate) startDate = absence.startDate;
		if (absence.endDate > endDate) endDate = absence.endDate;
	}
	const workingDays = await loadWorkingDaysForEmployees(database, {
		organizationId: input.organizationId,
		employeeIds: input.absences.map((absence) => absence.employeeId),
		startDate,
		endDate,
	});

	return new Map(
		input.absences.map((absence) => [
			absence.id,
			countAbsenceDays(absence, workingDays.get(absence.employeeId) ?? mondayToFriday),
		]),
	);
}
