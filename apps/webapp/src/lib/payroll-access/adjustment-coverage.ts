import "server-only";

import { type SQL, sql } from "drizzle-orm";
import { adjustmentDisplayName } from "@/lib/work-balance/adjustments/display-name";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";

/**
 * What a payroll access grant covers for balance adjustments (#995, spec #804):
 * the employees it covers anywhere else, plus covered employees who have left
 * (`employee.is_active = false`), so payroll can record a final overtime
 * payout after the last working day.
 *
 * Only balance adjustments use this, and a grant holder's payroll export for
 * the employees who left during or after its dates (#1001,
 * `listDepartedEmployeesCoveredForExport`). The payroll workspace and the
 * sidebar keep `resolvePayrollAccessibleEmployeeIds`, which drops employees
 * who have left.
 *
 * The grant is the actor's one active grant in the organization. Its holder
 * must still have access: an approved member with an active employee profile
 * whose departure does not already deny access. A grant with scope `all`
 * covers every employee of the organization; any other scope covers the
 * employees assigned directly, the employees whose team is assigned, and the
 * members (`team_membership`) of an assigned team.
 *
 * A holder never covers their own employee record (or any other profile of
 * their user), even when the grant names it: an owner, an admin or another
 * holder records their adjustments.
 */

type Reader = Pick<WorkBalanceDbClient, "execute">;

export type BalanceAdjustmentGrantEmployee = {
	id: string;
	name: string;
	employeeNumber: string | null;
	/** False for an employee who has left. */
	isActive: boolean;
};

/** The actor's active grant, as a CTE `holder_grant (id, organization_id, scope, holder_user_id)`. */
function holderGrant(input: { organizationId: string; actorUserId: string }): SQL {
	return sql`holder_grant as (
		select g.id, g.organization_id, g.scope, h.user_id as holder_user_id
		from payroll_access_grant g
		join employee h on h.id = g.payroll_employee_id and h.organization_id = g.organization_id
		join member m on m.user_id = h.user_id and m.organization_id = h.organization_id
		where g.organization_id = ${input.organizationId}
			and g.is_active = true
			and h.user_id = ${input.actorUserId}
			and h.is_active = true
			and m.status = 'approved'
			and not employee_departure_denies_access(h.organization_id, h.id, now())
		limit 1
	)`;
}

/** Whether the grant aliased `hg` covers the employee aliased `e`, departed or not. */
const grantCoversEmployee = sql`(
	e.organization_id = hg.organization_id
	and e.user_id is distinct from hg.holder_user_id
	and (
		hg.scope = 'all'
		or exists (
			select 1 from payroll_access_employee pe
			where pe.organization_id = hg.organization_id and pe.grant_id = hg.id
				and pe.employee_id = e.id
		)
		or exists (
			select 1 from payroll_access_team pt
			where pt.organization_id = hg.organization_id and pt.grant_id = hg.id
				and (
					pt.team_id = e.team_id
					or exists (
						select 1 from team_membership tm
						where tm.organization_id = hg.organization_id and tm.team_id = pt.team_id
							and tm.employee_id = e.id
					)
				)
		)
	)
)`;

/**
 * The actor's active payroll access grant when it covers the employee for
 * balance adjustments; otherwise null.
 */
export async function findBalanceAdjustmentGrant(
	client: Reader,
	input: { organizationId: string; actorUserId: string; employeeId: string },
): Promise<{ grantId: string } | null> {
	const result = await client.execute<{ grant_id: string }>(sql`
		with ${holderGrant(input)}
		select hg.id as grant_id
		from holder_grant hg
		join employee e on e.id = ${input.employeeId}
		where ${grantCoversEmployee}
		limit 1
	`);
	const row = result.rows[0];
	return row ? { grantId: row.grant_id } : null;
}

/**
 * The actor's active payroll access grant in the organization, whatever it
 * covers; null without one. For organization-wide actions such as the bulk
 * opening balance upload (#999), which then check each employee.
 */
export async function findActiveBalanceAdjustmentGrant(
	client: Reader,
	input: { organizationId: string; actorUserId: string },
): Promise<{ grantId: string } | null> {
	const result = await client.execute<{ id: string }>(sql`
		with ${holderGrant(input)}
		select id from holder_grant
	`);
	const grantId = result.rows[0]?.id;
	return grantId ? { grantId } : null;
}

/**
 * The employees the actor's active payroll access grant covers for balance
 * adjustments, including those who have left (active ones first, then by
 * name); null when the actor holds no active grant in the organization.
 * `employeeId` narrows the list to that one employee.
 */
export async function listBalanceAdjustmentGrantEmployees(
	client: Reader,
	input: { organizationId: string; actorUserId: string; employeeId?: string },
): Promise<{ grantId: string; employees: BalanceAdjustmentGrantEmployee[] } | null> {
	// One query: the grant, with each covered employee, or a single row without
	// one when it covers nobody; no row at all without an active grant.
	const result = await client.execute<{
		grant_id: string;
		id: string | null;
		user_name: string | null;
		first_name: string | null;
		last_name: string | null;
		employee_number: string | null;
		is_active: boolean | null;
	}>(sql`
		with ${holderGrant(input)}
		select hg.id as grant_id, e.id, u.name as user_name, e.first_name, e.last_name,
			e.employee_number, e.is_active
		from holder_grant hg
		left join employee e on e.organization_id = hg.organization_id
			and ${grantCoversEmployee}
			${input.employeeId ? sql`and e.id = ${input.employeeId}` : sql``}
		left join "user" u on u.id = e.user_id
		order by e.is_active desc, lower(coalesce(u.name, '')), e.employee_number, e.id
	`);
	const grantId = result.rows[0]?.grant_id;
	if (!grantId) return null;
	return {
		grantId,
		employees: result.rows.flatMap((row) =>
			row.id
				? [
						{
							id: row.id,
							name: adjustmentDisplayName(
								{ firstName: row.first_name, lastName: row.last_name, name: row.user_name },
								row.employee_number || row.id,
							),
							employeeNumber: row.employee_number,
							isActive: row.is_active === true,
						},
					]
				: [],
		),
	};
}

/**
 * The covered employees who have left with an effective departure whose
 * cutoff lies after the start of `fromDate` in the departure's frozen zone:
 * they worked on or after that day. A payroll grant holder's export (#1001)
 * adds them, so final payouts and last-month hours reach payroll; every other
 * payroll view keeps `resolvePayrollAccessibleEmployeeIds`. Empty when the
 * actor holds no active grant in the organization.
 */
export async function listDepartedEmployeesCoveredForExport(
	client: Reader,
	input: { organizationId: string; actorUserId: string; fromDate: string },
): Promise<string[]> {
	const result = await client.execute<{ id: string }>(sql`
		with ${holderGrant(input)}
		select e.id
		from holder_grant hg
		join employee e on e.organization_id = hg.organization_id and e.is_active = false
		where ${grantCoversEmployee}
			and exists (
				select 1 from employee_departure d
				where d.organization_id = e.organization_id and d.employee_id = e.id
					and d.status = 'effective'
					and d.cutoff_at > (${input.fromDate}::date::timestamp at time zone d.timezone)
			)
		order by e.id
	`);
	return result.rows.map((row) => row.id);
}