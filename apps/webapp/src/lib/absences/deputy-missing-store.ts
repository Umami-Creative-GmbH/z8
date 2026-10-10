import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, userSettings } from "@/db/schema";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { absentEmployeeTimezone, isDeputyMissing } from "./deputy-missing";

/**
 * The absences that show "Deputy missing" at `at` (#1014): deputy-required,
 * without a deputy, pending or approved and not ended on the absent
 * employee's own day (user timezone, then organization, then UTC).
 */
export async function findDeputyMissingAbsenceIds(
	database: Pick<typeof db, "select">,
	input: {
		organizationId: string;
		at: Instant;
		absences: ReadonlyArray<{
			id: string;
			employeeId: string;
			endDate: string;
			status: string;
			deputyEmployeeId: string | null;
			deputyRequired: boolean;
		}>;
	},
): Promise<Set<string>> {
	// No zone's day is more than one day behind UTC; this only narrows the loading.
	const earliest = plainDateAt(input.at, "UTC").subtract({ days: 1 }).toString();
	const candidates = input.absences.filter((absence) => isDeputyMissing(absence, earliest));
	if (candidates.length === 0) return new Set();
	const todays = await loadAbsentEmployeeTodays(database, {
		organizationId: input.organizationId,
		employeeIds: candidates.map((absence) => absence.employeeId),
		at: input.at,
	});
	return new Set(
		candidates
			.filter((absence) =>
				isDeputyMissing(
					absence,
					todays.get(absence.employeeId) ?? plainDateAt(input.at, "UTC").toString(),
				),
			)
			.map((absence) => absence.id),
	);
}

/**
 * Each employee's plain date (`YYYY-MM-DD`) at the instant, in their
 * timezone (`absentEmployeeTimezone`): the day deputy rules end an absence on.
 * Organization-scoped; unknown employees are left out.
 */
export async function loadAbsentEmployeeTodays(
	database: Pick<typeof db, "select">,
	input: { organizationId: string; employeeIds: readonly string[]; at: Instant },
): Promise<Map<string, string>> {
	const employeeIds = [...new Set(input.employeeIds)];
	if (employeeIds.length === 0) return new Map();
	const zones = await database
		.select({
			employeeId: employee.id,
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
		})
		.from(employee)
		.innerJoin(organization, eq(organization.id, employee.organizationId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(and(eq(employee.organizationId, input.organizationId), inArray(employee.id, employeeIds)));
	return new Map(
		zones.map((zone) => [
			zone.employeeId,
			plainDateAt(input.at, absentEmployeeTimezone(zone)).toString(),
		]),
	);
}