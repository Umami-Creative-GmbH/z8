import { and, eq, inArray } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import {
	employee,
	employeeTrackingSettings,
	organizationTrackingSettings,
	userSettings,
} from "@/db/schema";
import {
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";

export type EmployeeTrackingProjection = {
	trackingStartDateOverride?: string | null;
	employeeTrackingStartDateOverride?: string | null;
	employeeEmploymentStartDateOverride?: string;
	employeeTimezoneOverride?: string;
};

export type EmployeeTrackingContext = { startDate: string; timezone: string };

function trackingQuery(client: Pick<WorkBalanceDbClient, "select">) {
	return client
		.select({
			employeeId: employee.id,
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
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId));
}

/** One organization-scoped read for an already authorized, bounded employee batch. */
export async function loadEmployeeTrackingContexts(
	client: Pick<WorkBalanceDbClient, "select">,
	input: { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, EmployeeTrackingContext | null>> {
	if (input.employeeIds.length === 0) return new Map();
	const rows = await trackingQuery(client).where(
		and(
			eq(employee.organizationId, input.organizationId),
			inArray(employee.id, [...input.employeeIds]),
		),
	);
	return new Map(
		rows.map((row) => [row.employeeId, resolveTrackingContext(row, {})]),
	);
}

/** Null keeps legacy organizations on their existing calculation rules. */
export async function loadEmployeeTrackingContext(
	client: Pick<WorkBalanceDbClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
	} & EmployeeTrackingProjection,
): Promise<{ startDate: string; timezone: string } | null> {
	const [row] = await trackingQuery(client)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.id, input.employeeId),
			),
		)
		.limit(1);
	return resolveTrackingContext(row, input);
}

function resolveTrackingContext(
	row: Awaited<ReturnType<typeof trackingQuery>>[number] | undefined,
	input: EmployeeTrackingProjection,
): EmployeeTrackingContext | null {
	if (!row || input.trackingStartDateOverride === null) return null;
	const selectedStart =
		input.trackingStartDateOverride ??
		(row.activatedAt ? row.trackingStartDate : null);
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
	input: {
		organizationId: string;
		employeeId: string;
	} & EmployeeTrackingProjection,
): Promise<string | null> {
	return (await loadEmployeeTrackingContext(client, input))?.startDate ?? null;
}
