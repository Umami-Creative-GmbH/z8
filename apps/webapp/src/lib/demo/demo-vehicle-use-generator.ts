import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, isNull, like, max } from "drizzle-orm";
import { db } from "@/db";
import {
	employee,
	organizationVehicle,
	organizationVehicleDriver,
	team,
	vehicleUseAssignment,
	vehicleUseSetting,
	workPeriod,
} from "@/db/schema";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type VehicleUseAssignmentRule,
	vehicleUseAssignmentRule,
	vehicleUseModeFor,
} from "@/lib/time-tracking/vehicle-use/policy";
import type { DemoDataOptions } from "./demo-data.service";
import { type DemoVehicleUsePlanEntry, planDemoVehicleUse } from "./demo-vehicle-use";
import { assignDemoVehicleUse, withDemoWorkTransaction } from "./demo-work";

/** Demo vehicles and demo teams are recognized by these markers, as the demo reset does. */
const DEMO_VEHICLE_PREFIX = "Demo - ";
const DEMO_TEAM_DESCRIPTION_PREFIX = "Demo team - ";

export type DemoVehicleUseResult = {
	/** Work periods that got vehicle use, complete or not. */
	vehicleUseRecorded: number;
	/** Work periods of employees with vehicle use expected that lack the vehicle or a reading. */
	drivingDetailsMissing: number;
};

/**
 * Demo vehicle use (#1132): records vehicle use on the demo work period of the demo vehicles'
 * team drivers, so a demo organization shows vehicle use, the distance per vehicle report and
 * some work with driving details missing.
 *
 * Unless an admin switched vehicle use off, it turns the organization switch on and expects
 * vehicle use of each demo team that drives a demo vehicle, both dated from the first demo day
 * so the demo work counts as expected work. Existing assignments are kept. A demo reset deletes
 * the demo teams, and their assignments with them.
 */
export async function assignDemoVehicleUseToPeriods(
	options: DemoDataOptions,
): Promise<DemoVehicleUseResult> {
	const none: DemoVehicleUseResult = { vehicleUseRecorded: 0, drivingDetailsMissing: 0 };
	if (!options.includeLocations || !options.includeTimeEntries) return none;
	const { organizationId } = options;

	const vehicles = (
		await db
			.select({ id: organizationVehicle.id, name: organizationVehicle.name })
			.from(organizationVehicle)
			.where(
				and(
					eq(organizationVehicle.organizationId, organizationId),
					isNull(organizationVehicle.archivedAt),
				),
			)
			.orderBy(asc(organizationVehicle.name))
	).filter((vehicle) => vehicle.name.startsWith(DEMO_VEHICLE_PREFIX));
	if (vehicles.length === 0) return none;

	const since = startOfUtcDay(options.dateRange.start);
	const configuration = await enableDemoVehicleUse({
		organizationId,
		vehicleIds: vehicles.map((vehicle) => vehicle.id),
		actorUserId: options.createdBy,
		since,
	});
	if (!configuration) return none;

	const people = await db
		.select({ employeeId: employee.id, teamId: employee.teamId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, organizationId),
				options.employeeIds?.length ? inArray(employee.id, options.employeeIds) : undefined,
			),
		);
	const modes = new Map<string, "asked" | "expected">();
	for (const person of people) {
		const mode = vehicleUseModeFor(person, { enabled: true, assignments: configuration });
		if (mode !== "off") modes.set(person.employeeId, mode);
	}
	if (modes.size === 0) return none;

	const periods = await db
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				inArray(workPeriod.employeeId, [...modes.keys()]),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
				isNull(workPeriod.vehicleKind),
				isNotNull(workPeriod.endTime),
				gte(workPeriod.startTime, since),
			),
		);

	const plan = planDemoVehicleUse({
		periods: periods.flatMap((period) =>
			period.endTime
				? [
						{
							id: period.id,
							employeeId: period.employeeId,
							startedAt: instantFromDate(period.startTime),
							endedAt: instantFromDate(period.endTime),
						},
					]
				: [],
		),
		modes,
		vehicles: await odometerStarts(organizationId, vehicles),
		random: Math.random,
	});

	const written = await writePlan(organizationId, options.createdBy, plan);
	const planned = new Set(plan.map((entry) => entry.workPeriodId));
	const leftWithout = periods.filter(
		(period) => modes.get(period.employeeId) === "expected" && !planned.has(period.id),
	).length;
	return {
		vehicleUseRecorded: written.length,
		drivingDetailsMissing:
			leftWithout +
			written.filter(
				(entry) => modes.get(entry.employeeId) === "expected" && entry.use.distanceKm === null,
			).length,
	};
}

/** Midnight UTC of the day the demo range starts, as the database boundary takes it. */
function startOfUtcDay(date: Date): Date {
	return dateFromInstant(instantFromDate(date).toZonedDateTimeISO("UTC").startOfDay().toInstant());
}

/**
 * Turns vehicle use on and expects it of the demo teams driving demo vehicles, under the settings
 * row lock every vehicle use configuration write takes. Returns the organization's assignments,
 * or null when an admin switched vehicle use off (the row is off while assignments exist).
 */
async function enableDemoVehicleUse(input: {
	organizationId: string;
	vehicleIds: string[];
	actorUserId: string;
	since: Date;
}): Promise<VehicleUseAssignmentRule[] | null> {
	const { organizationId, since } = input;
	return db.transaction(async (tx) => {
		await tx
			.insert(vehicleUseSetting)
			.values({
				organizationId,
				enabled: true,
				updatedBy: input.actorUserId,
				createdAt: since,
				updatedAt: since,
			})
			.onConflictDoNothing();
		const [setting] = await tx
			.select({ enabled: vehicleUseSetting.enabled })
			.from(vehicleUseSetting)
			.where(eq(vehicleUseSetting.organizationId, organizationId))
			.for("update");
		const assignmentScope = eq(vehicleUseAssignment.organizationId, organizationId);
		if (!setting?.enabled) {
			const [existing] = await tx
				.select({ id: vehicleUseAssignment.id })
				.from(vehicleUseAssignment)
				.where(assignmentScope)
				.limit(1);
			if (existing) return null;
			await tx
				.update(vehicleUseSetting)
				.set({ enabled: true, updatedBy: input.actorUserId, updatedAt: since })
				.where(eq(vehicleUseSetting.organizationId, organizationId));
		}

		const driverTeams = await tx
			.selectDistinct({ teamId: team.id })
			.from(organizationVehicleDriver)
			.innerJoin(
				team,
				and(
					eq(team.id, organizationVehicleDriver.teamId),
					eq(team.organizationId, organizationVehicleDriver.organizationId),
				),
			)
			.where(
				and(
					eq(organizationVehicleDriver.organizationId, organizationId),
					inArray(organizationVehicleDriver.vehicleId, input.vehicleIds),
					like(team.description, `${DEMO_TEAM_DESCRIPTION_PREFIX}%`),
				),
			);
		for (const { teamId } of driverTeams) {
			await tx
				.insert(vehicleUseAssignment)
				.values({
					organizationId,
					assignmentType: "team",
					teamId,
					priority: 1,
					mode: "expected",
					createdBy: input.actorUserId,
					createdAt: since,
					updatedAt: since,
				})
				.onConflictDoNothing();
		}

		const rows = await tx
			.select({
				assignmentType: vehicleUseAssignment.assignmentType,
				teamId: vehicleUseAssignment.teamId,
				employeeId: vehicleUseAssignment.employeeId,
				mode: vehicleUseAssignment.mode,
			})
			.from(vehicleUseAssignment)
			.where(assignmentScope);
		return rows.map(vehicleUseAssignmentRule);
	});
}

/** Each vehicle's last recorded end reading, or a plausible odometer for a fresh demo vehicle. */
async function odometerStarts(
	organizationId: string,
	vehicles: readonly { id: string }[],
): Promise<{ id: string; startKm: number }[]> {
	const recorded = await db
		.select({ vehicleId: workPeriod.vehicleId, endKm: max(workPeriod.odometerEndKm) })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				inArray(
					workPeriod.vehicleId,
					vehicles.map((vehicle) => vehicle.id),
				),
			),
		)
		.groupBy(workPeriod.vehicleId);
	const lastEnd = new Map(recorded.map((row) => [row.vehicleId, row.endKm]));
	return vehicles.map((vehicle) => ({
		id: vehicle.id,
		startKm: lastEnd.get(vehicle.id) ?? 20_000 + Math.floor(Math.random() * 60_000),
	}));
}

/** Writes the plan, one coordinated work transaction per employee; returns what was written. */
async function writePlan(
	organizationId: string,
	triggeringUserId: string,
	plan: readonly DemoVehicleUsePlanEntry[],
): Promise<DemoVehicleUsePlanEntry[]> {
	const byEmployee = new Map<string, DemoVehicleUsePlanEntry[]>();
	for (const entry of plan) {
		byEmployee.set(entry.employeeId, [...(byEmployee.get(entry.employeeId) ?? []), entry]);
	}
	const written: DemoVehicleUsePlanEntry[] = [];
	for (const [employeeId, entries] of byEmployee) {
		const recorded = await withDemoWorkTransaction(
			{ organizationId, triggeringUserId, employeeIds: [employeeId] },
			async (scope) => {
				const done: DemoVehicleUsePlanEntry[] = [];
				for (const entry of entries) {
					const changed = await assignDemoVehicleUse(scope, {
						organizationId,
						employeeId,
						workPeriodId: entry.workPeriodId,
						use: entry.use,
					});
					if (changed) done.push(entry);
				}
				return done;
			},
		);
		written.push(...recorded);
	}
	return written;
}
