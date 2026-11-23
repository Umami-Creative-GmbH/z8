import { sql } from "drizzle-orm";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";

/**
 * MVCC `xmin` revision rows for all contract & versioned work-policy tables that affect
 * analytics requirement calculations. Scoped strictly via `work_policy_version.id` (never
 * joining policy child tables on `policy_id`).
 */
export function analyticsContractRevisionSql(organizationId: string) {
	return sql`
 union all select 'team-history',th.id::text,th.xmin::text from employee_team_history th join visible v on th.employee_id=v.id where th.organization_id=${organizationId}
 union all select 'terms-day',d.id::text,d.xmin::text from employee_employment_history_day d join employee_employment_history t on t.id=d.employment_history_id join visible v on t.employee_id=v.id where d.organization_id=${organizationId}
 union all select 'contract-default',cd.id::text,cd.xmin::text from contract_default cd where cd.organization_id=${organizationId}
 union all select 'contract-template-version',tv.id::text,tv.xmin::text from contract_template_version tv where tv.organization_id=${organizationId}
 union all select 'contract-template-day',td.id::text,td.xmin::text from contract_template_version_day td where td.organization_id=${organizationId}
 union all select 'policy',p.id::text,p.xmin::text from work_policy p where p.organization_id=${organizationId}
 union all select 'policy-version',v.id::text,v.xmin::text from work_policy_version v where v.organization_id=${organizationId}
 union all select 'policy-assignment',a.id::text,a.xmin::text from work_policy_assignment a where a.organization_id=${organizationId} and (a.assignment_type='organization' or a.employee_id in (select id from visible) or a.team_id in (select team_id from visible))
 union all select 'schedule',s.id::text,s.xmin::text from work_policy_schedule s join work_policy_version v on v.id=s.policy_version_id where v.organization_id=${organizationId}
 union all select 'schedule-day',d.id::text,d.xmin::text from work_policy_schedule_day d join work_policy_schedule s on s.id=d.schedule_id join work_policy_version v on v.id=s.policy_version_id where v.organization_id=${organizationId}
`;
}

/**
 * Reads contract & versioned work-policy evidence rows for tracking-date review fingerprints.
 * Every schedule / day read joins strictly through `work_policy_version.id` (never `policy_id`).
 */
export async function loadContractTrackingReviewEvidence(
	_client: Pick<WorkBalanceDbClient, "execute">,
	organizationId: string,
	lock: boolean,
	read: (name: string, query: ReturnType<typeof sql>) => Promise<void>,
): Promise<void> {
	const guard = lock ? sql`for share of t` : sql``;
	for (const table of [
		"employee_team_history",
		"employee_employment_history_day",
		"contract_default",
		"contract_template_version",
		"contract_template_version_day",
		"work_policy",
		"work_policy_version",
		"work_policy_assignment",
	]) {
		await read(
			table,
			sql`select to_jsonb(t) as data from ${sql.identifier(table)} t where t.organization_id = ${organizationId} ${guard}`,
		);
	}
	await read(
		"work_policy_schedule",
		sql`select to_jsonb(t) as data from work_policy_schedule t where t.policy_version_id in (select id from work_policy_version where organization_id = ${organizationId}) ${guard}`,
	);
	await read(
		"work_policy_schedule_day",
		sql`select to_jsonb(t) as data from work_policy_schedule_day t where t.schedule_id in (select s.id from work_policy_schedule s join work_policy_version v on v.id = s.policy_version_id where v.organization_id = ${organizationId}) ${guard}`,
	);
}
