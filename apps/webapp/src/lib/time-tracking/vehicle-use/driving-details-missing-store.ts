import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db } from "@/db";
import {
	employee,
	timeEntry,
	vehicleUseAssignment,
	vehicleUseSetting,
	workPeriod,
} from "@/db/schema";
import { workDayOf } from "@/lib/billable-time/applicable-rate";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import {
	type DrivingDetailsConfiguration,
	drivingDetailsExpectedSince,
} from "./driving-details-missing";
import type { VehicleUseAssignmentRule, VehicleUseMode } from "./policy";
import { vehicleUseFromColumns, type WorkVehicleUse } from "./work-vehicle-use";

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
		return { enabled: false, enabledSince: instantFromDate(new Date(0)), assignments: [] };
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
			...assignmentRule(row),
			since: instantFromDate(row.updatedAt),
		})),
	};
}

function assignmentRule(row: {
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	mode: VehicleUseMode;
}): VehicleUseAssignmentRule {
	if (row.assignmentType === "team" && row.teamId) {
		return { assignmentType: "team", teamId: row.teamId, mode: row.mode };
	}
	if (row.assignmentType === "employee" && row.employeeId) {
		return { assignmentType: "employee", employeeId: row.employeeId, mode: row.mode };
	}
	return { assignmentType: "organization", mode: row.mode };
}

/**
 * Since when each employee in scope is expected to record vehicle use; employees who are not
 * expected are left out. Empty while the organization switch is off.
 */
export async function loadDrivingDetailsExpectations(
	database: Database,
	input: { organizationId: string; employeeIds: readonly string[] | null },
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
 * The flagged work of the employees in scope, newest first. Employees expected since different
 * instants are grouped by that instant, so the query stays bounded by the number of assignments.
 */
export async function listDrivingDetailsMissing(
	database: Database,
	input: DrivingDetailsMissingQuery,
): Promise<DrivingDetailsMissingWork[]> {
	if (input.workPeriodIds?.length === 0) return [];
	const expectations = await loadDrivingDetailsExpectations(database, input);
	if (expectations.size === 0) return [];
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
	const query = database
		.select({
			workPeriodId: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			startOffsetMinutes: timeEntry.utcOffsetMinutes,
			endOffsetMinutes: clockOutEntry.utcOffsetMinutes,
			vehicleKind: workPeriod.vehicleKind,
			vehicleId: workPeriod.vehicleId,
			odometerStartKm: workPeriod.odometerStartKm,
			odometerEndKm: workPeriod.odometerEndKm,
			drivenDistanceKm: workPeriod.drivenDistanceKm,
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
		.where(
			and(
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
			),
		)
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
