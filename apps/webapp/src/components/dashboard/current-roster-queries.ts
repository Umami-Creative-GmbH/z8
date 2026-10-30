import { desc, eq, sql } from "drizzle-orm";
import { employee, workPolicyAssignment } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";

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
 * The current roster's average weekly hours, from each employee's latest
 * active simple schedule. 40 when nobody has one.
 */
export async function currentRosterAverageWeeklyHours(
	db: DatabaseClient,
	organizationId: string,
): Promise<number> {
	const employeesWithSchedules = await db.query.employee.findMany({
		where: onCurrentRoster(organizationId),
		columns: { id: true },
		with: {
			workPolicyAssignments: {
				where: eq(workPolicyAssignment.isActive, true),
				orderBy: [desc(workPolicyAssignment.effectiveFrom)],
				limit: 1,
				with: { policy: { with: { schedule: true } } },
			},
		},
	});

	let totalHours = 0;
	let countWithSchedule = 0;
	for (const entry of employeesWithSchedules) {
		const schedule = entry.workPolicyAssignments[0]?.policy?.schedule;
		if (schedule?.scheduleType !== "simple" || !schedule.hoursPerCycle) continue;

		// Convert hoursPerCycle to weekly hours based on scheduleCycle
		const hoursPerCycle = Number.parseFloat(schedule.hoursPerCycle);
		let weeklyHours = hoursPerCycle;
		if (schedule.scheduleCycle === "biweekly") {
			weeklyHours = hoursPerCycle / 2;
		} else if (schedule.scheduleCycle === "monthly") {
			weeklyHours = (hoursPerCycle * 12) / 52;
		}
		totalHours += weeklyHours;
		countWithSchedule++;
	}

	return countWithSchedule > 0 ? totalHours / countWithSchedule : 40;
}
