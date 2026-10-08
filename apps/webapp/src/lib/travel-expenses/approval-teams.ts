import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	employee,
	team,
	teamMembership,
	travelExpenseClaim,
	travelExpenseReport,
} from "@/db/schema";
import { loadAdjustmentLink } from "./adjustment-link";
import type { SettlementSource } from "./settlement-store";

/**
 * Teams recorded on approved expense reports (#746, ADR 0002). Scoped expense
 * officers handle a report of an employee named in their grant or of one of
 * these teams. They are the employee's teams when the report was approved and
 * never follow a later team move. Legacy claims got theirs once, from the
 * backfill in migration 0135.
 */

type Database = typeof appDb;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The employee's teams now, as payroll access resolves them: their `team_id`
 * and their team memberships, within the organization. Sorted and distinct.
 */
async function loadEmployeeTeamIds(
	database: Executor,
	scope: { organizationId: string; employeeId: string },
): Promise<string[]> {
	const [primary, memberships] = await Promise.all([
		database
			.select({ teamId: team.id })
			.from(employee)
			.innerJoin(
				team,
				and(eq(team.id, employee.teamId), eq(team.organizationId, employee.organizationId)),
			)
			.where(
				and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
			),
		database
			.select({ teamId: teamMembership.teamId })
			.from(teamMembership)
			.where(
				and(
					eq(teamMembership.employeeId, scope.employeeId),
					eq(teamMembership.organizationId, scope.organizationId),
				),
			),
	]);
	return [...new Set([...primary, ...memberships].map((row) => row.teamId))].toSorted();
}

/**
 * Records the employee's teams on a report the caller's transaction has just
 * approved, replacing those of an earlier approval that was reopened. An
 * adjustment report records nothing: it belongs to its original report's teams.
 */
export async function recordReportApprovalTeams(
	database: Executor,
	scope: { organizationId: string; reportId: string },
): Promise<void> {
	if (await loadAdjustmentLink(database, scope)) return;
	const [report] = await database
		.select({ employeeId: travelExpenseReport.employeeId })
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, scope.reportId),
				eq(travelExpenseReport.organizationId, scope.organizationId),
				eq(travelExpenseReport.status, "approved"),
			),
		)
		.limit(1);
	if (!report) throw new Error("Only an approved expense report records its teams");
	const approvalTeamIds = await loadEmployeeTeamIds(database, {
		organizationId: scope.organizationId,
		employeeId: report.employeeId,
	});
	await database
		.update(travelExpenseReport)
		.set({ approvalTeamIds })
		.where(
			and(
				eq(travelExpenseReport.id, scope.reportId),
				eq(travelExpenseReport.organizationId, scope.organizationId),
			),
		);
}

/**
 * The teams an expense report or legacy claim belongs to within the
 * organization: those recorded at its approval, an adjustment report's being
 * its original report's. Empty when none were recorded.
 */
export async function readApprovalTeamIds(
	database: Executor,
	input: { organizationId: string; source: SettlementSource },
): Promise<string[]> {
	const { organizationId, source } = input;
	if (source.type === "legacy_claim") {
		const [claim] = await database
			.select({ approvalTeamIds: travelExpenseClaim.approvalTeamIds })
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.id, source.id),
					eq(travelExpenseClaim.organizationId, organizationId),
				),
			)
			.limit(1);
		return claim?.approvalTeamIds ?? [];
	}
	const link = await loadAdjustmentLink(database, { organizationId, reportId: source.id });
	const [report] = await database
		.select({ approvalTeamIds: travelExpenseReport.approvalTeamIds })
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, link?.originalReportId ?? source.id),
				eq(travelExpenseReport.organizationId, organizationId),
			),
		)
		.limit(1);
	return report?.approvalTeamIds ?? [];
}
