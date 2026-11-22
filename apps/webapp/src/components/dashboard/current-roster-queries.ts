import { sql } from "drizzle-orm";
import { employee } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

/**
 * The dashboard's reads of who works here now (#1438): the organization's
 * current roster, never former employees.
 */

/** The ids of the organization's current roster. */
export async function currentRosterEmployeeIds(
	db: DatabaseClient,
	organizationId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(onCurrentRoster(organizationId));
	return rows.map((row) => row.id);
}

/** How many employees are on the organization's current roster. */
export async function currentRosterCount(
	db: DatabaseClient,
	organizationId: string,
): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(employee)
		.where(onCurrentRoster(organizationId));
	return row?.count ?? 0;
}

/**
 * The current roster's average weekly hours, resolved through the unified contract
 * resolver (honoring org/team defaults, custom working days, and versioned policies).
 * Returns 40 when nobody has a configured schedule or weekly hours.
 */
export async function currentRosterAverageWeeklyHours(
	db: DatabaseClient,
	organizationId: string,
): Promise<number> {
	const employeeIds = await currentRosterEmployeeIds(db, organizationId);
	if (employeeIds.length === 0) return 40;

	const orgTimezone = await loadOrganizationTimezone(db, organizationId);
	const today = plainDateAt(systemClock.nowInstant(), orgTimezone);
	const todayKey = today.toString();
	const contractsByEmployee = await loadEffectiveContractsBatch(db, {
		organizationId,
		employeeIds,
		dates: [today],
	});

	let totalHours = 0;
	let countWithSchedule = 0;
	for (const employeeId of employeeIds) {
		const contract = contractsByEmployee.get(employeeId)?.get(todayKey);
		if (!contract) continue;

		const weeklyMinutesFromDays = contract.weeklyScheduleDays.reduce(
			(sum, day) => sum + (day.isWorkDay ? day.minutesPerDay : 0),
			0,
		);
		if (weeklyMinutesFromDays > 0) {
			totalHours += weeklyMinutesFromDays / 60;
			countWithSchedule++;
			continue;
		}

		const schedule = contract.workPolicy?.scheduleEnabled ? contract.workPolicy.schedule : null;
		if (schedule?.scheduleType === "simple" && schedule.hoursPerCycle) {
			const hoursPerCycle = Number.parseFloat(schedule.hoursPerCycle);
			if (!Number.isFinite(hoursPerCycle) || hoursPerCycle <= 0) continue;
			let weeklyHours = hoursPerCycle;
			if (schedule.scheduleCycle === "biweekly") {
				weeklyHours = hoursPerCycle / 2;
			} else if (schedule.scheduleCycle === "monthly") {
				weeklyHours = (hoursPerCycle * 12) / 52;
			} else if (schedule.scheduleCycle === "yearly") {
				weeklyHours = hoursPerCycle / 52;
			}
			totalHours += weeklyHours;
			countWithSchedule++;
		}
	}

	return countWithSchedule > 0 ? totalHours / countWithSchedule : 40;
}
