import { and, eq } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import { employee, organizationTrackingSettings, userSettings } from "@/db/schema";
import { instantFromDate, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";

/** Null keeps legacy organizations on their existing calculation rules. */
export async function loadEmployeeTrackingContext(
	client: Pick<WorkBalanceDbClient, "select">,
	input: { organizationId: string; employeeId: string; trackingStartDateOverride?: string | null },
): Promise<{ startDate: string; timezone: string } | null> {
	const [row] = await client
		.select({
			trackingStartDate: organizationTrackingSettings.trackingStartDate,
			activatedAt: organizationTrackingSettings.activatedAt,
			employmentStart: employee.startDate,
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
		})
		.from(employee)
		.leftJoin(
			organizationTrackingSettings,
			eq(organizationTrackingSettings.organizationId, employee.organizationId),
		)
		.innerJoin(organization, eq(organization.id, employee.organizationId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.id, input.employeeId)),
		)
		.limit(1);
	if (!row || input.trackingStartDateOverride === null) return null;
	const selectedStart =
		input.trackingStartDateOverride ?? (row.activatedAt ? row.trackingStartDate : null);
	if (!selectedStart) return null;
	const timezone = resolveEffectiveTimezone(row.userTimezone, row.organizationTimezone);
	const organizationStart = parsePlainDate(selectedStart);
	// Employee start is a persisted calendar date, represented at UTC midnight at the DB boundary.
	const employmentStart = row.employmentStart
		? plainDateAt(instantFromDate(row.employmentStart), "UTC")
		: null;
	const startDate =
		employmentStart && employmentStart.toString() > organizationStart.toString()
			? employmentStart
			: organizationStart;
	return { startDate: startDate.toString(), timezone };
}

export async function loadEmployeeTrackingStart(
	client: Pick<WorkBalanceDbClient, "select">,
	input: { organizationId: string; employeeId: string; trackingStartDateOverride?: string | null },
): Promise<string | null> {
	return (await loadEmployeeTrackingContext(client, input))?.startDate ?? null;
}
