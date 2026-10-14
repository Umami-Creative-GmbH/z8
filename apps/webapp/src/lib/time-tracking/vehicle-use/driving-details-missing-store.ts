import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import {
	employee,
	timeEntry,
	vehicleUseAssignment,
	vehicleUseSetting,
	workPeriod,
} from "@/db/schema";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { workDayOf } from "@/lib/datetime/temporal-format";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import {
	type DrivingDetailsConfiguration,
	drivingDetailsExpectedSince,
} from "./driving-details-missing";
import { vehicleUseAssignmentRule } from "./policy";
import { vehicleUseFromColumns, type WorkVehicleUse } from "./work-vehicle-use";
import { vehicleUseSelectColumns } from "./work-vehicle-use-sql";

/**
 * Reads of "driving details missing" (#1127): the completed work of employees expected to record
 * vehicle use that lacks its vehicle or a reading (`driving-details-missing.ts`). Every query is
 * filtered by `organizationId`; callers scope the employees (the employee themselves, a
 * manager's employees, or the whole organization for admins).
 */
type Database = Pick<typeof db, "select">;

/** One flagged work period. Plain data; crosses to the client. */
export interface DrivingDetailsMissingWork {
	workPeriodId: string;
	employeeId: string;
	/** UTC instants (ISO) of the work. */
	startedAt: string;
	endedAt: string;
	/** The UTC offsets captured with the clock-in and clock-out, for display at event-local time. */
	startOffsetMinutes: number;
	endOffsetMinutes: number | null;
	/** The event-local date the work started on (`YYYY-MM-DD`), at the clock-in's offset. */
	workDay: string;
	vehicleUse: WorkVehicleUse | null;
}

export interface DrivingDetailsMissingQuery {
	organizationId: string;
	/** The employees in scope; null for every employee of the organization. */
	employeeIds: readonly string[] | null;
	/** Only these work periods. */
	workPeriodIds?: readonly string[];
	/** Only work that started in `[start, end)`. */
	startedWithin?: { start: Instant; end: Instant };
	/** Only work that ended in `[start, end)`. */
	endedWithin?: { start: Instant; end: Instant };
	limit?: number;
}

/**
 * The organization's switch and assignments with the instant each last changed. With the switch
 * off nothing else is read.
 */
export async function loadDrivingDetailsConfiguration(
	database: Database,
	organizationId: string,
): Promise<DrivingDetailsConfiguration> {
	const [setting] = await database
		.select({ enabled: vehicleUseSetting.enabled, updatedAt: vehicleUseSetting.updatedAt })
		.from(vehicleUseSetting)
		.where(eq(vehicleUseSetting.organizationId, organizationId))
		.limit(1);
	if (!setting?.enabled) {
		return {
			enabled: false,
			enabledSince: Temporal.Instant.fromEpochMilliseconds(0),
			assignments: [],
		};
	}
	const rows = await database
		.select({
			assignmentType: vehicleUseAssignment.assignmentType,
			teamId: vehicleUseAssignment.teamId,
			employeeId: vehicleUseAssignment.employeeId,
			mode: vehicleUseAssignment.mode,
			updatedAt: vehicleUseAssignment.updatedAt,
		})
		.from(vehicleUseAssignment)
		.where(eq(vehicleUseAssignment.organizationId, organizationId));
	return {
		enabled: true,
		enabledSince: instantFromDate(setting.updatedAt),
		assignments: rows.map((row) => ({
			...vehicleUseAssignmentRule(row),
			since: instantFromDate(row.updatedAt),
		})),
	};
}

/**
 * The employees whose flagged work the manager surfaces show and count (#1127): `/team/driving`
 * lists and `/today` counts only active employees, by this one predicate.
 */
export function drivingDetailsListedEmployeeCondition(): SQL {
	return eq(employee.isActive, true);
}

/**
 * Since when each employee in scope is expected to record vehicle use; employees who are not
 * expected are left out. Empty while the organization switch is off.
 */
export async function loadDrivingDetailsExpectations(
	database: Database,
	input: {
		organizationId: string;
		employeeIds: readonly string[] | null;
		/** Only active employees (`drivingDetailsListedEmployeeCondition`). */
		activeEmployeesOnly?: boolean;
	},
): Promise<Map<string, Instant>> {
	if (input.employeeIds?.length === 0) return new Map();
	const configuration = await loadDrivingDetailsConfiguration(database, input.organizationId);
	if (!configuration.enabled) return new Map();
	if (!configuration.assignments.some((rule) => rule.mode === "expected")) return new Map();
	const people = await database
		.select({ employeeId: employee.id, teamId: employee.teamId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				input.employeeIds ? inArray(employee.id, [...input.employeeIds]) : undefined,
				input.activeEmployeesOnly ? drivingDetailsListedEmployeeCondition() : undefined,
			),
		);
	const expectations = new Map<string, Instant>();
	for (const person of people) {
		const since = drivingDetailsExpectedSince(person, configuration);
		if (since) expectations.set(person.employeeId, since);
	}
	return expectations;
}

const clockOutEntry = alias(timeEntry, "driving_clock_out_entry");

/**
 * The condition of flagged work of the employees in scope, or null when nobody in scope is
 * expected to record vehicle use. Employees expected since different instants are grouped by that
 * instant, so the condition stays bounded by the number of assignments.
 */
async function drivingDetailsMissingCondition(
	database: Database,
	input: DrivingDetailsMissingQuery & { activeEmployeesOnly?: boolean },
): Promise<SQL | null> {
	if (input.workPeriodIds?.length === 0) return null;
	const expectations = await loadDrivingDetailsExpectations(database, input);
	if (expectations.size === 0) return null;
	const groups = new Map<string, { since: Instant; employeeIds: string[] }>();
	for (const [employeeId, since] of expectations) {
		const key = since.toString();
		const group = groups.get(key) ?? { since, employeeIds: [] };
		group.employeeIds.push(employeeId);
		groups.set(key, group);
	}
	const expected = or(
		...[...groups.values()].map((group) =>
			and(
				inArray(workPeriod.employeeId, group.employeeIds),
				gte(workPeriod.startTime, dateFromInstant(group.since)),
			),
		),
	) as SQL;
	return and(
		eq(workPeriod.organizationId, input.organizationId),
		completedWorkPeriodCondition(),
		isNotNull(workPeriod.endTime),
		or(isNull(workPeriod.vehicleKind), isNull(workPeriod.drivenDistanceKm)),
		expected,
		input.workPeriodIds ? inArray(workPeriod.id, [...input.workPeriodIds]) : undefined,
		input.startedWithin
			? and(
					gte(workPeriod.startTime, dateFromInstant(input.startedWithin.start)),
					lt(workPeriod.startTime, dateFromInstant(input.startedWithin.end)),
				)
			: undefined,
		input.endedWithin
			? and(
					gte(workPeriod.endTime, dateFromInstant(input.endedWithin.start)),
					lt(workPeriod.endTime, dateFromInstant(input.endedWithin.end)),
				)
			: undefined,
	) as SQL;
}

/**
 * How many work periods of the active employees in scope show "driving details missing", counted
 * in SQL (the manager's `/today` item). It counts what `/team/driving` lists.
 */
export async function countDrivingDetailsMissing(
	database: Database,
	input: Omit<DrivingDetailsMissingQuery, "limit">,
): Promise<number> {
	const condition = await drivingDetailsMissingCondition(database, {
		...input,
		activeEmployeesOnly: true,
	});
	if (!condition) return 0;
	const [row] = await database.select({ count: count() }).from(workPeriod).where(condition);
	return Number(row?.count ?? 0);
}

/** The flagged work of the employees in scope, newest first. */
export async function listDrivingDetailsMissing(
	database: Database,
	input: DrivingDetailsMissingQuery,
): Promise<DrivingDetailsMissingWork[]> {
	const condition = await drivingDetailsMissingCondition(database, input);
	if (!condition) return [];
	const query = database
		.select({
			workPeriodId: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			startOffsetMinutes: timeEntry.utcOffsetMinutes,
			endOffsetMinutes: clockOutEntry.utcOffsetMinutes,
			...vehicleUseSelectColumns(workPeriod),
		})
		.from(workPeriod)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, input.organizationId),
			),
		)
		.leftJoin(
			clockOutEntry,
			and(
				eq(clockOutEntry.id, workPeriod.clockOutId),
				eq(clockOutEntry.organizationId, input.organizationId),
			),
		)
		.where(condition)
		.orderBy(desc(workPeriod.startTime), desc(workPeriod.id))
		.$dynamic();
	const rows = await (input.limit ? query.limit(input.limit) : query);
	return rows.flatMap((row) => {
		if (!row.endTime) return [];
		const startedAt = instantFromDate(row.startTime);
		return [
			{
				workPeriodId: row.workPeriodId,
				employeeId: row.employeeId,
				startedAt: startedAt.toString(),
				endedAt: instantFromDate(row.endTime).toString(),
				startOffsetMinutes: row.startOffsetMinutes,
				endOffsetMinutes: row.endOffsetMinutes,
				workDay: workDayOf(startedAt, row.startOffsetMinutes).toString(),
				vehicleUse: vehicleUseFromColumns(row),
			},
		];
	});
}
