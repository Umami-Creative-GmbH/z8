import { and, eq } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import {
	employee,
	employeeTrackingSettings,
	organizationTrackingSettings,
	userSettings,
} from "@/db/schema";
import { instantFromDate, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";

export type EmployeeTrackingProjection = {
	trackingStartDateOverride?: string | null;
	employeeTrackingStartDateOverride?: string | null;
	employeeEmploymentStartDateOverride?: string;
	employeeTimezoneOverride?: string;
};

/** Null keeps legacy organizations on their existing calculation rules. */
export async function loadEmployeeTrackingContext(
	client: Pick<WorkBalanceDbClient, "select">,
	input: { organizationId: string; employeeId: string } & EmployeeTrackingProjection,
): Promise<{ startDate: string; timezone: string } | null> {
	const [row] = await client
		.select({
			trackingStartDate: organizationTrackingSettings.trackingStartDate,
			activatedAt: organizationTrackingSettings.activatedAt,
			employmentStart: employee.startDate,
			employeeTrackingStartDate: employeeTrackingSettings.trackingStartDate,
			userTimezone: userSettings.timezone,
			organizationTimezone: organization.timezone,
		})
		.from(employee)
		.leftJoin(
			organizationTrackingSettings,
			eq(organizationTrackingSettings.organizationId, employee.organizationId),
		)
		.leftJoin(
			employeeTrackingSettings,
			and(
				eq(employeeTrackingSettings.organizationId, employee.organizationId),
				eq(employeeTrackingSettings.employeeId, employee.id),
			),
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
	const timezone =
		input.employeeTimezoneOverride ??
		resolveEffectiveTimezone(row.userTimezone, row.organizationTimezone);
	const organizationStart = parsePlainDate(selectedStart);
	// Employee start is a persisted calendar date, represented at UTC midnight at the DB boundary.
	const employmentStart = input.employeeEmploymentStartDateOverride
		? parsePlainDate(input.employeeEmploymentStartDateOverride)
		: row.employmentStart
			? plainDateAt(instantFromDate(row.employmentStart), "UTC")
			: null;
	const startDate =
		employmentStart && employmentStart.toString() > organizationStart.toString()
			? employmentStart
			: organizationStart;
	const exception =
		input.employeeTrackingStartDateOverride === undefined
			? row.employeeTrackingStartDate
			: input.employeeTrackingStartDateOverride;
	return {
		startDate:
			exception && exception > startDate.toString()
				? parsePlainDate(exception).toString()
				: startDate.toString(),
		timezone,
	};
}

export async function loadEmployeeTrackingStart(
	client: Pick<WorkBalanceDbClient, "select">,
	input: { organizationId: string; employeeId: string } & EmployeeTrackingProjection,
): Promise<string | null> {
	return (await loadEmployeeTrackingContext(client, input))?.startDate ?? null;
}
