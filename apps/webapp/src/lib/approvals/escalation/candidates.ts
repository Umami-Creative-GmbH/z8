import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { employee, employeeManagers, team, teamMembership } from "@/db/schema";
import { canAccessApprovalInbox, defineAbilityFor } from "@/lib/authorization";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import { asAppSubject } from "@/lib/authorization/subjects";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type EligibleManagerEmployee,
	resolveEligibleManagers,
} from "../policies/manager-eligibility";
import type { EscalationCandidateFact } from "./transfer-evaluation";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type EscalationCandidateExecutor = typeof db | DatabaseTransaction;

/**
 * Loads the requester's eligible managers (#251 §1.2) with the facts needed
 * for deterministic ordering, and whether each one currently has an actual
 * authenticated inbox/decision path for this requester's approvals. Bot
 * linkage plays no part: it affects delivery, never authority selection.
 */
export async function loadEscalationCandidateFacts(
	executor: EscalationCandidateExecutor,
	input: { organizationId: string; requesterEmployeeId: string },
): Promise<EscalationCandidateFact[]> {
	const { organizationId, requesterEmployeeId } = input;
	const [employees, links, memberships, teams] = await Promise.all([
		executor
			.select({
				id: employee.id,
				organizationId: employee.organizationId,
				isActive: employee.isActive,
				role: employee.role,
				userId: employee.userId,
			})
			.from(employee)
			.where(eq(employee.organizationId, organizationId)),
		executor
			.select({
				employeeId: employeeManagers.employeeId,
				managerId: employeeManagers.managerId,
				isPrimary: employeeManagers.isPrimary,
				assignedAt: employeeManagers.assignedAt,
			})
			.from(employeeManagers)
			.where(eq(employeeManagers.employeeId, requesterEmployeeId)),
		executor
			.select({
				employeeId: teamMembership.employeeId,
				teamId: teamMembership.teamId,
			})
			.from(teamMembership)
			.where(
				and(
					eq(teamMembership.organizationId, organizationId),
					eq(teamMembership.employeeId, requesterEmployeeId),
				),
			),
		executor
			.select({
				id: team.id,
				organizationId: team.organizationId,
				primaryManagerId: team.primaryManagerId,
			})
			.from(team)
			.where(eq(team.organizationId, organizationId)),
	]);

	const eligible = resolveEligibleManagers({
		organizationId,
		requesterEmployeeId,
		employees: employees as EligibleManagerEmployee[],
		managerLinks: links,
		teamMemberships: memberships,
		teams,
	});
	if (!eligible.ok) return [];

	const employeeById = new Map(employees.map((row) => [row.id, row]));
	const linkByManager = new Map(links.map((link) => [link.managerId, link]));
	const facts: EscalationCandidateFact[] = [];
	for (const managerId of eligible.managerIds) {
		const manager = employeeById.get(managerId);
		const link = linkByManager.get(managerId);
		facts.push({
			employeeId: managerId,
			isPrimary: link?.isPrimary === true,
			relationshipSince: link ? instantFromDate(link.assignedAt) : null,
			hasDecisionPath: manager
				? await hasApprovalDecisionPath(executor, {
						organizationId,
						requesterEmployeeId,
						managerEmployeeId: managerId,
						managerUserId: manager.userId,
					})
				: false,
		});
	}
	return facts;
}

/**
 * The replacement must reach and decide the approval through the web inbox
 * under the existing authorization model: an active approved member whose
 * current abilities admit the inbox and this requester's approvals.
 */
async function hasApprovalDecisionPath(
	executor: EscalationCandidateExecutor,
	input: {
		organizationId: string;
		requesterEmployeeId: string;
		managerEmployeeId: string;
		managerUserId: string;
	},
): Promise<boolean> {
	const principal = await loadOrganizationPrincipalContext(executor, {
		userId: input.managerUserId,
		organizationId: input.organizationId,
	});
	const principalEmployee = principal.employee;
	if (
		!principal.orgMembership ||
		!principalEmployee ||
		principalEmployee.id !== input.managerEmployeeId ||
		principalEmployee.organizationId !== input.organizationId
	) {
		return false;
	}
	const ability = defineAbilityFor(principal);
	if (!canAccessApprovalInbox(ability, principalEmployee)) return false;
	const approval = asAppSubject("Approval", {
		organizationId: input.organizationId,
		requestedBy: input.requesterEmployeeId,
		approverId: input.managerEmployeeId,
		status: "pending",
	});
	return ability.can("approve", approval) || ability.can("manage", approval);
}
