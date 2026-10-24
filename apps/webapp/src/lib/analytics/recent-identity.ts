import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { employee, employeeManagers } from "@/db/schema";
import { getAnalyticsCalendarRange } from "@/lib/effect/services/analytics.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type {
	AnalyticsEmployeeScope,
	DateRange,
	OvertimeBurnDownParams,
} from "./types";

export type RecentAnalyticsRequest =
	| { kind: "work-hours"; dateRange: DateRange; employeeId?: string }
	| { kind: "team"; dateRange: DateRange; teamId?: string }
	| {
			kind: "overtime";
			dateRange: DateRange;
			filters?: OvertimeBurnDownParams["filters"];
	  };

export type RecentAnalyticsIdentity = {
	calculationVersion: "recent-analytics-v1";
	organizationId: string;
	userId: string;
	actorEmployeeId: string;
	scope: AnalyticsEmployeeScope;
	visibleEmployeeIds: string[];
	revision: string;
	cacheable: boolean;
};

/** Fresh visibility and committed source revisions; never cached authorization. */
export const loadRecentAnalyticsIdentity = Effect.fn(
	"analytics.recentIdentity",
)(function* (
	actor: {
		id: string;
		userId: string;
		organizationId: string;
		role: "admin" | "manager";
	},
	request: RecentAnalyticsRequest,
) {
	const database = yield* DatabaseService;
	// Retain the production reader's strict calendar/epoch validation before lookup.
	const calendar = getAnalyticsCalendarRange(request.dateRange);
	const scope: AnalyticsEmployeeScope =
		actor.role === "admin"
			? { role: "admin" }
			: { role: "manager", managerEmployeeId: actor.id };
	const manager =
		request.kind === "overtime" ? request.filters?.managerId : undefined;
	const teamId =
		request.kind === "team"
			? request.teamId
			: request.kind === "overtime"
				? request.filters?.teamId
				: undefined;
	const employeeId =
		request.kind === "work-hours" ? request.employeeId : undefined;
	const managedBy = (id: string) =>
		inArray(
			employee.id,
			database.db
				.select({ id: employeeManagers.employeeId })
				.from(employeeManagers)
				.where(eq(employeeManagers.managerId, id)),
		);
	const visible = yield* database.query("analytics.recentVisibility", () =>
		database.db
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					eq(employee.isActive, true),
					scope.role === "manager"
						? managedBy(scope.managerEmployeeId)
						: undefined,
					manager ? managedBy(manager) : undefined,
					teamId ? eq(employee.teamId, teamId) : undefined,
					employeeId ? eq(employee.id, employeeId) : undefined,
				),
			)
			.orderBy(employee.id),
	);
	const visibleEmployeeIds = visible.map((person) => person.id);
	const ids = JSON.stringify(visibleEmployeeIds);
	const organizationId = actor.organizationId;
	// Only identities and MVCC revisions leave PostgreSQL, not source values.
	// Include membership of each set, so removals and same-timestamp updates change
	// the key. This is deliberately an analytics dependency list, not a generic DAL.
	const versions = yield* database.query(
		"analytics.recentDependencyVersions",
		() =>
			database.db.execute<{
				revision: string;
				marker_count: number;
			}>(sql`
with visible as materialized (
 select e.id,e.user_id,e.team_id from employee e
 where e.organization_id=${organizationId}
 and e.id in (select value::uuid from jsonb_array_elements_text(${ids}::jsonb))
), managers as materialized (
 select distinct m.manager_id from employee_managers m join visible v on m.employee_id=v.id
), revisions as (
 select 'employee' f,e.id::text id,e.xmin::text r from employee e join visible v on v.id=e.id
 union all select 'actor',e.id::text,e.xmin::text from employee e where e.organization_id=${organizationId} and e.id=${actor.id}
 union all select 'user',u.id,u.xmin::text from "user" u where u.id=${actor.userId} or u.id in (select user_id from visible) or u.id in (select e.user_id from employee e join managers m on m.manager_id=e.id where e.organization_id=${organizationId})
 union all select 'settings',s.user_id,s.xmin::text from user_settings s where s.user_id in (select user_id from visible)
 union all select 'organization',o.id,o.xmin::text from organization o where o.id=${organizationId}
 union all select 'membership',m.id,m.xmin::text from member m where m.organization_id=${organizationId} and m.user_id=${actor.userId}
 union all select 'managers',m.id::text,m.xmin::text from employee_managers m join visible v on v.id=m.employee_id
 union all select 'manager',e.id::text,e.xmin::text from employee e join managers m on m.manager_id=e.id where e.organization_id=${organizationId}
 union all select 'team',t.id::text,t.xmin::text from team t where t.organization_id=${organizationId} and t.id in (select team_id from visible)
 union all select 'work-marker',b.id::text,b.xmin::text from employee_work_balance b join visible v on b.employee_id=v.id where b.organization_id=${organizationId}
 union all select 'tracking',t.organization_id,t.xmin::text from organization_tracking_settings t where t.organization_id=${organizationId}
 union all select 'tracking-employee',t.employee_id::text,t.xmin::text from employee_tracking_settings t join visible v on t.employee_id=v.id where t.organization_id=${organizationId}
 union all select 'employment',t.id::text,t.xmin::text from employee_employment_period t join visible v on t.employee_id=v.id where t.organization_id=${organizationId}
 union all select 'terms',t.id::text,t.xmin::text from employee_employment_history t join visible v on t.employee_id=v.id where t.organization_id=${organizationId}
 union all select 'absence',a.id::text,a.xmin::text from absence_entry a join visible v on a.employee_id=v.id where a.organization_id=${organizationId}
 union all select 'absence-category',c.id::text,c.xmin::text from absence_category c where c.organization_id=${organizationId}
 union all select 'policy',p.id::text,p.xmin::text from work_policy p where p.organization_id=${organizationId}
 union all select 'policy-assignment',a.id::text,a.xmin::text from work_policy_assignment a where a.organization_id=${organizationId} and (a.assignment_type='organization' or a.employee_id in (select id from visible) or a.team_id in (select team_id from visible))
 union all select 'schedule',s.id::text,s.xmin::text from work_policy_schedule s join work_policy p on p.id=s.policy_id where p.organization_id=${organizationId}
 union all select 'schedule-day',d.id::text,d.xmin::text from work_policy_schedule_day d join work_policy_schedule s on s.id=d.schedule_id join work_policy p on p.id=s.policy_id where p.organization_id=${organizationId}
 union all select 'shift',s.id::text,s.xmin::text from shift s join visible v on v.id=s.employee_id where s.organization_id=${organizationId}
 union all select 'holiday',h.id::text,h.xmin::text from holiday h where h.organization_id=${organizationId}
 union all select 'holiday-category',h.id::text,h.xmin::text from holiday_category h where h.organization_id=${organizationId}
 union all select 'holiday-assignment',a.id::text,a.xmin::text from holiday_assignment a where a.organization_id=${organizationId} and (a.assignment_type='organization' or a.employee_id in (select id from visible) or a.team_id in (select team_id from visible))
 union all select 'holiday-category-assignment',a.id::text,a.xmin::text from holiday_category_assignment a where a.organization_id=${organizationId} and (a.assignment_type='organization' or a.employee_id in (select id from visible) or a.team_id in (select team_id from visible))
 union all select 'holiday-preset',p.id::text,p.xmin::text from holiday_preset p where p.organization_id=${organizationId}
 union all select 'holiday-preset-day',d.id::text,d.xmin::text from holiday_preset_holiday d join holiday_preset p on p.id=d.preset_id where p.organization_id=${organizationId}
 union all select 'holiday-preset-assignment',a.id::text,a.xmin::text from holiday_preset_assignment a where a.organization_id=${organizationId} and (a.assignment_type='organization' or a.employee_id in (select id from visible) or a.team_id in (select team_id from visible))
 union all select 'cost-assignment',a.id::text,a.xmin::text from employee_cost_center_assignment a join visible v on a.employee_id=v.id where a.organization_id=${organizationId}
 union all select 'cost-center',c.id::text,c.xmin::text from cost_center c where c.organization_id=${organizationId}
 union all select 'custom-role',r.id::text,r.xmin::text from custom_role r where r.organization_id=${organizationId}
 union all select 'custom-permission',p.id::text,p.xmin::text from custom_role_permission p join custom_role r on r.id=p.custom_role_id where r.organization_id=${organizationId}
 union all select 'custom-assignment',a.id::text,a.xmin::text from employee_custom_role a where a.employee_id=${actor.id}
)
select md5(coalesce(string_agg(f||':'||id||':'||r,'|' order by f,id),'')) revision,
 (select count(*)::integer from employee_work_balance b join visible v on b.employee_id=v.id where b.organization_id=${organizationId}) marker_count
from revisions
`),
	);
	const revision = versions.rows[0];
	if (!revision) throw new Error("Analytics dependency revisions are missing");
	return {
		identity: {
			calculationVersion: "recent-analytics-v1",
			organizationId,
			userId: actor.userId,
			actorEmployeeId: actor.id,
			scope,
			visibleEmployeeIds,
			revision: revision.revision,
			// A deleted/missing marker never shares an old unversioned cache entry.
			cacheable:
				visibleEmployeeIds.length > 0 &&
				visibleEmployeeIds.length === revision.marker_count,
		} satisfies RecentAnalyticsIdentity,
		request: { ...request, dateRange: { ...request.dateRange, ...calendar } },
	};
});
