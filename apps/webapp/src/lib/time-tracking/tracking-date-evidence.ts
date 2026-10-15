import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";

/** Stable serialization for reviewed source evidence, never returned to the browser. */
function canonical(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, canonical(item)]),
		);
	return value;
}
export function trackingReviewFingerprint(value: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}

/**
 * Inputs of the production requirements, ledger and vacation readers. Projection rows are
 * deliberately absent: a worker refreshing derived data does not invalidate an admin's review.
 * Every relation is routed through this organization, including legacy absence/adjustment rows.
 */
export async function loadTrackingReviewEvidence(
	client: Pick<WorkBalanceDbClient, "execute">,
	organizationId: string,
	lock = false,
): Promise<unknown> {
	const evidence: Record<string, unknown> = {};
	const read = async (name: string, query: ReturnType<typeof sql>) => {
		const result = await client.execute<{ data: unknown }>(query);
		evidence[name] = result.rows
			.map((row) => canonical(row.data))
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	};
	const guard = lock ? sql`for share of t` : sql``;
	for (const table of [
		"employee",
		"member",
		"organization_tracking_settings",
		"employee_tracking_settings",
		"employee_employment_period",
		"employee_departure",
		"employee_employment_history",
		"work_period",
		"time_entry",
		"balance_adjustment",
		"work_policy",
		"work_policy_assignment",
		"holiday",
		"holiday_category",
		"holiday_assignment",
		"holiday_category_assignment",
		"holiday_preset_assignment",
		"absence_category",
		"vacation_allowance",
		"vacation_policy_assignment",
		"shift",
		"closed_month_employee",
	]) {
		await read(
			table,
			sql`select to_jsonb(t) as data from ${sql.identifier(table)} t where t.organization_id = ${organizationId} ${guard}`,
		);
	}
	for (const table of ["employee_vacation_allowance", "vacation_adjustment", "absence_entry"]) {
		await read(
			table,
			sql`select to_jsonb(t) as data from ${sql.identifier(table)} t where t.employee_id in (select id from employee where organization_id = ${organizationId}) ${guard}`,
		);
	}
	await read(
		"users",
		sql`select jsonb_build_object('id',t.id,'name',t.name,'created_at',t.created_at,'role',t.role,'banned',t.banned) as data from "user" t where t.id in (select user_id from employee where organization_id = ${organizationId}) ${guard}`,
	);
	await read(
		"user_settings",
		sql`select jsonb_build_object('user_id',t.user_id,'timezone',t.timezone) as data from user_settings t where t.user_id in (select user_id from employee where organization_id = ${organizationId}) ${guard}`,
	);
	await read(
		"work_policy_schedule",
		sql`select to_jsonb(t) as data from work_policy_schedule t where t.policy_id in (select id from work_policy where organization_id = ${organizationId}) ${guard}`,
	);
	await read(
		"work_policy_schedule_day",
		sql`select to_jsonb(t) as data from work_policy_schedule_day t where t.schedule_id in (select s.id from work_policy_schedule s join work_policy p on p.id = s.policy_id where p.organization_id = ${organizationId}) ${guard}`,
	);
	await read(
		"holiday_preset",
		sql`select to_jsonb(t) as data from holiday_preset t where t.id in (select preset_id from holiday_preset_assignment where organization_id = ${organizationId}) ${guard}`,
	);
	await read(
		"holiday_preset_holiday",
		sql`select to_jsonb(t) as data from holiday_preset_holiday t where t.preset_id in (select preset_id from holiday_preset_assignment where organization_id = ${organizationId}) ${guard}`,
	);
	return evidence;
}
