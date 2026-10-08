import { and, eq, sql } from "drizzle-orm";
import {
	employee,
	team,
	teamMembership,
	travelExpenseClaim,
	travelExpenseReport,
} from "@/db/schema";
import { type AdjustmentExecutor as Executor, loadAdjustmentLink } from "./adjustment-link";
import type { SettlementSource } from "./settlement-store";

/**
 * Teams recorded on approved expense reports (#746, ADR 0002). Scoped expense
 * officers handle a report of an employee named in their grant or of one of
 * these teams. They are the employee's teams when the report was approved and
 * never follow a later team move. Legacy claims record theirs the same way;
 * those approved before migration 0135 got them from its backfill.
 */

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
 * Records the employee's teams on a legacy claim the caller's transaction has
 * just approved. A claim submitted before migration 0135 and decided after it
 * gets its teams here; one decided before it got them from the backfill.
 */
export async function recordClaimApprovalTeams(
	database: Executor,
	scope: { organizationId: string; claimId: string },
): Promise<void> {
	const [claim] = await database
		.select({ employeeId: travelExpenseClaim.employeeId })
		.from(travelExpenseClaim)
		.where(
			and(
				eq(travelExpenseClaim.id, scope.claimId),
				eq(travelExpenseClaim.organizationId, scope.organizationId),
				eq(travelExpenseClaim.status, "approved"),
			),
		)
		.limit(1);
	if (!claim) throw new Error("Only an approved legacy claim records its teams");
	const approvalTeamIds = await loadEmployeeTeamIds(database, {
		organizationId: scope.organizationId,
		employeeId: claim.employeeId,
	});
	await database
		.update(travelExpenseClaim)
		// Kept: the decision already stamped `updated_at`; `$onUpdate` would move it.
		.set({ approvalTeamIds, updatedAt: sql`${travelExpenseClaim.updatedAt}` })
		.where(
			and(
				eq(travelExpenseClaim.id, scope.claimId),
				eq(travelExpenseClaim.organizationId, scope.organizationId),
			),
		);
}

/**
 * The teams an expense report or legacy claim belongs to within the
 * organization: those recorded at its last approval, an adjustment report's
 * being its original report's. Empty when none were recorded. The status is
 * not checked: a reopened report keeps its last approval's teams until it is
 * approved again, so callers that need an approved report check that first.
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
