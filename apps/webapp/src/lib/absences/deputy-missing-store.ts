import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, userSettings } from "@/db/schema";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import { isDeputyMissing } from "./deputy-missing";

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
	const zones = await database
		.select({
			employeeId: employee.id,
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
		})
		.from(employee)
		.innerJoin(organization, eq(organization.id, employee.organizationId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, [...new Set(candidates.map((absence) => absence.employeeId))]),
			),
		);
	const timezoneOf = new Map(
		zones.map((zone) => [
			zone.employeeId,
			resolvePersonalTimezone({
				userTimezone: zone.userTimezone ?? undefined,
				organizationTimezone: zone.organizationTimezone ?? undefined,
			}).timezone,
		]),
	);
	return new Set(
		candidates
			.filter((absence) =>
				isDeputyMissing(
					absence,
					plainDateAt(input.at, timezoneOf.get(absence.employeeId) ?? "UTC").toString(),
				),
			)
			.map((absence) => absence.id),
	);
}
