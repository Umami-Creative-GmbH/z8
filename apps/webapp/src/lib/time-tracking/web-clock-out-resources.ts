import "server-only";

import { type SQL, sql } from "drizzle-orm";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import type {
	WebClockOutTransactionInput,
	WorkTransactionClient,
} from "./web-clock-out-transaction";

export class WorkTransactionScopeChanged extends Error {
	constructor() {
		super("Work transaction resources changed; restart routing");
		this.name = "WorkTransactionScopeChanged";
	}
}

type Resource = Readonly<{
	table: string;
	id: string;
	binding: string;
	source: boolean;
}>;

/** Concrete table order for this legacy caller, not a configurable lock framework. */
function resourceQueries(input: WebClockOutTransactionInput) {
	const org = input.organizationId;
	const employeeScope = sql`select id from employee where organization_id = ${org} and id = ${input.employeeId}::uuid and user_id = ${input.userId} and is_active = true`;
	const sourceScope = sql`select id from work_period where organization_id = ${org} and employee_id = ${input.employeeId}::uuid and (clock_out_id = ${input.submissionId}::uuid or id = ${input.workPeriodId ?? null}::uuid)`;
	const teamScope = sql`select team_id from employee where organization_id = ${org} and id in (${employeeScope})`;
	const assignments = sql`organization_id = ${org} and is_active = true and (
		(assignment_type = 'employee' and employee_id in (${employeeScope})) or
		(assignment_type = 'team' and team_id in (${teamScope})) or
		(assignment_type = 'organization' and employee_id is null and team_id is null)
	)`;
	const policies = sql`select policy_id from work_policy_assignment where ${assignments}`;
	const models = sql`select model_id from surcharge_model_assignment where ${assignments}`;
	const canonical = sql`select canonical_record_id from work_period where organization_id = ${org} and id in (${sourceScope})`;
	// A conservative UTC superset of the terminal break collaborator's local day.
	// It does not assign local-day meaning or change its existing timezone rules.
	const gapWindow = input.endTime
		? sql`or (start_time >= ${dateFromInstant(input.endTime.subtract({ hours: 48 }))} and start_time <= ${dateFromInstant(input.endTime.add({ hours: 48 }))})`
		: sql``;
	const entries = sql`select clock_in_id from work_period where organization_id = ${org} and id in (${sourceScope})
		union select clock_out_id from work_period where organization_id = ${org} and id in (${sourceScope})
		union (select id from time_entry where organization_id = ${org} and employee_id = ${input.employeeId}::uuid order by created_at desc, id desc limit 2)`;
	const definitions: {
		table: string;
		column?: string;
		scope: SQL;
		source?: SQL;
	}[] = [
		{ table: "organization", scope: sql`id = ${org}` },
		{
			table: "user",
			scope: sql`id = ${input.userId} and exists (${employeeScope})`,
		},
		{
			table: "member",
			scope: sql`organization_id = ${org} and user_id = ${input.userId} and status = 'approved'`,
		},
		{
			table: "user_settings",
			scope: sql`user_id = ${input.userId} and exists (${employeeScope})`,
		},
		{
			table: "employee",
			scope: sql`organization_id = ${org} and id in (${employeeScope})`,
		},
		// Assignment candidates include expired/future rows: their IDs are protected
		// before the existing event-time snapshot resolver selects effective rows.
		{ table: "work_policy_assignment", scope: assignments },
		{
			table: "work_policy",
			scope: sql`organization_id = ${org} and id in (${policies})`,
		},
		{
			table: "work_policy_regulation",
			scope: sql`policy_id in (select id from work_policy where organization_id = ${org} and id in (${policies}))`,
		},
		{
			table: "work_policy_break_rule",
			scope: sql`regulation_id in (select id from work_policy_regulation where policy_id in (select id from work_policy where organization_id = ${org} and id in (${policies})))`,
		},
		{ table: "surcharge_model_assignment", scope: assignments },
		{
			table: "surcharge_model",
			scope: sql`organization_id = ${org} and id in (${models})`,
		},
		{
			table: "surcharge_rule",
			scope: sql`model_id in (select id from surcharge_model where organization_id = ${org} and id in (${models}))`,
		},
		{
			table: "work_period",
			scope: sql`organization_id = ${org} and employee_id = ${input.employeeId}::uuid and (id in (${sourceScope}) ${gapWindow})`,
			source: sql`id in (${sourceScope})`,
		},
		{
			table: "time_entry",
			scope: sql`organization_id = ${org} and employee_id = ${input.employeeId}::uuid and id in (${entries})`,
		},
		{
			table: "time_record",
			scope: sql`organization_id = ${org} and employee_id = ${input.employeeId}::uuid and id in (${canonical})`,
		},
		{
			table: "time_record_work",
			column: "record_id",
			scope: sql`organization_id = ${org} and record_id in (${canonical})`,
		},
		{
			table: "time_record_allocation",
			scope: sql`organization_id = ${org} and record_id in (${canonical})`,
		},
	];
	return definitions;
}

export async function routeWebClockOutResources(
	db: WorkTransactionClient,
	input: WebClockOutTransactionInput,
): Promise<readonly Resource[]> {
	const definitions = resourceQueries(input);
	const result = await db.execute(
		sql`/* web-clock-out:route */ ${sql.join(
			definitions.map(
				(definition) => sql`
		select ${definition.table}::text as "table", ${sql.identifier(definition.column ?? "id")}::text as id,
			${
				definition.table === "employee"
					? sql`json_build_array(id, user_id, team_id, is_active)::text`
					: definition.table === "work_period"
						? sql`json_build_array(id, employee_id, clock_in_id, clock_out_id, canonical_record_id, start_time, end_time, work_location_type)::text`
						: sql`${sql.identifier(definition.column ?? "id")}::text`
			} as binding,
			${definition.source ?? sql`false`} as source
		from ${sql.identifier(definition.table)} resource_row where ${definition.scope}
	`,
			),
			sql` union all `,
		)}`,
	);
	if (!result || !Array.isArray(result.rows))
		throw new Error("Work resource routing is unavailable");
	const tableOrder = definitions.map(({ table }) => table);
	const resources = result.rows
		.map((value): Resource => {
			const row = value as Record<string, unknown>;
			if (
				!row ||
				typeof row.table !== "string" ||
				!tableOrder.includes(row.table) ||
				typeof row.id !== "string" ||
				typeof row.binding !== "string" ||
				typeof row.source !== "boolean"
			) {
				throw new Error("Malformed work resource routing");
			}
			return {
				table: row.table,
				id: row.id,
				binding: row.binding,
				source: row.source,
			};
		})
		.sort(
			(a, b) =>
				tableOrder.indexOf(a.table) - tableOrder.indexOf(b.table) ||
				(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
		);
	for (const table of ["organization", "user", "member", "employee"]) {
		if (resources.filter((row) => row.table === table).length !== 1) {
			throw new Error("Active organization-scoped clocking access required");
		}
	}
	return resources;
}

export function assertSameWebClockOutResources(
	before: readonly Resource[],
	after: readonly Resource[],
) {
	if (JSON.stringify(before) !== JSON.stringify(after))
		throw new WorkTransactionScopeChanged();
}

export async function lockWebClockOutResources(
	db: WorkTransactionClient,
	input: WebClockOutTransactionInput,
	resources: readonly Resource[],
) {
	// Existing terminal-break/work-balance ownership key, not a second employee key.
	const auxiliaryKeys = [
		JSON.stringify([input.organizationId, input.employeeId]),
	];
	for (const resource of resources.filter(
		(row) => row.table === "work_period" && row.source,
	)) {
		for (const kind of ["manual_time_submission", "policy_clock_out"]) {
			auxiliaryKeys.push(
				JSON.stringify([input.organizationId, kind, "time_entry", resource.id]),
			);
		}
	}
	for (const key of [...new Set(auxiliaryKeys)].sort()) {
		await db.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
		);
	}
	for (const definition of resourceQueries(input)) {
		const ids = resources
			.filter((row) => row.table === definition.table)
			.map((row) => row.id);
		if (ids.length === 0) continue;
		const column = sql.identifier(definition.column ?? "id");
		// Only the routed IDs may be acquired. Newly discovered IDs cause a full
		// rollback/restart, never a second pass through an earlier-ranked table.
		await db.execute(sql`/* web-clock-out:lock */ select ${column} from ${sql.identifier(definition.table)}
			where ${definition.scope} and ${column} in (${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)})
			order by ${column} for update`);
	}
}
