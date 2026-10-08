import { inArray, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
	travelExpenseClaim,
	travelExpenseReport,
	travelExpenseReportAdjustment,
} from "@/db/schema";
import type { AdjustmentExecutor as Executor } from "./adjustment-link";
import { readApprovalTeamIds } from "./approval-teams";
import { isInOfficerScope, type OfficerScope } from "./officer-scope";
import type { SettlementSource } from "./settlement-store";

/**
 * Officer scope (#747) applied to stored reports and legacy claims: one
 * report at a time for detail pages and actions, or as SQL for lists. A
 * report is in scope when its employee is named or one of the teams recorded
 * at its approval is a grant team; an adjustment report records none and
 * belongs to its original report's teams.
 */

/** Whether one report or legacy claim of the organization is in the scope. */
export async function isSourceInOfficerScope(
	database: Executor,
	scope: OfficerScope | null,
	subject: { organizationId: string; source: SettlementSource; employeeId: string },
): Promise<boolean> {
	if (!scope) return false;
	if (isInOfficerScope(scope, { employeeId: subject.employeeId, approvalTeamIds: [] })) return true;
	if (scope.kind === "all" || scope.teamIds.length === 0) return false;
	const approvalTeamIds = await readApprovalTeamIds(database, {
		organizationId: subject.organizationId,
		source: subject.source,
	});
	return isInOfficerScope(scope, { employeeId: subject.employeeId, approvalTeamIds });
}

function uuidArray(ids: readonly string[]): SQL {
	return sql`array[${sql.join(
		ids.map((id) => sql`${id}::uuid`),
		sql`, `,
	)}]::uuid[]`;
}

function scopeCondition(
	scope: OfficerScope,
	employeeId: PgColumn,
	approvalTeamIds: SQL | PgColumn,
): SQL | undefined {
	if (scope.kind === "all") return undefined;
	const matches: SQL[] = [];
	if (scope.employeeIds.length > 0) matches.push(inArray(employeeId, [...scope.employeeIds]));
	if (scope.teamIds.length > 0) {
		matches.push(sql`${approvalTeamIds} && ${uuidArray(scope.teamIds)}`);
	}
	return or(...matches) ?? sql`false`;
}

/**
 * Reports in the scope, as a condition on `travel_expense_report` (or an alias
 * of it); undefined for the all scope.
 */
export function reportInOfficerScope(
	scope: OfficerScope,
	report: Record<
		"id" | "organizationId" | "employeeId" | "approvalTeamIds",
		PgColumn
	> = travelExpenseReport,
): SQL | undefined {
	// An adjustment report's teams are its original report's.
	const teams = sql`coalesce(${report.approvalTeamIds}, (
		select "officer_scope_original"."approval_team_ids"
		from ${travelExpenseReportAdjustment}
		inner join ${travelExpenseReport} as "officer_scope_original"
			on "officer_scope_original"."id" = ${travelExpenseReportAdjustment.originalReportId}
			and "officer_scope_original"."organization_id" = ${travelExpenseReportAdjustment.organizationId}
		where ${travelExpenseReportAdjustment.reportId} = ${report.id}
			and ${travelExpenseReportAdjustment.organizationId} = ${report.organizationId}
	))`;
	return scopeCondition(scope, report.employeeId, teams);
}

/** Legacy claims in the scope, as a condition on `travel_expense_claim`; undefined for the all scope. */
export function claimInOfficerScope(scope: OfficerScope): SQL | undefined {
	return scopeCondition(scope, travelExpenseClaim.employeeId, travelExpenseClaim.approvalTeamIds);
}
