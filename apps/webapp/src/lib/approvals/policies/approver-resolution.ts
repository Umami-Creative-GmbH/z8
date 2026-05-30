import {
	type EligibleTeam,
	type EligibleTeamMembership,
	resolvePrimaryEligibleManager,
} from "./manager-eligibility";
import type { ApprovalPolicyStageDraft } from "./types";

export interface ApproverDirectoryEmployee {
	id: string;
	organizationId: string;
	isActive: boolean;
	role: "admin" | "manager" | "employee";
}

export interface ApproverDirectoryManagerLink {
	employeeId: string;
	managerId: string;
	isPrimary?: boolean;
}

export type ApproverResolutionResult =
	| { ok: true; approverEmployeeId: string }
	| { ok: false; reason: string };

interface ResolveApproverFromDirectoryInput {
	organizationId: string;
	requesterEmployeeId: string;
	stage: ApprovalPolicyStageDraft;
	employees: ApproverDirectoryEmployee[];
	managerLinks: ApproverDirectoryManagerLink[];
	teamMemberships?: EligibleTeamMembership[];
	teams?: EligibleTeam[];
}

function activeEmployeeInOrg(
	employees: ApproverDirectoryEmployee[],
	organizationId: string,
	employeeId: string | undefined,
) {
	return employees.find(
		(employee) =>
			employee.id === employeeId && employee.organizationId === organizationId && employee.isActive,
	);
}

function directManagerId(managerLinks: ApproverDirectoryManagerLink[], employeeId: string) {
	const links = managerLinks.filter((link) => link.employeeId === employeeId);
	const candidates = links.some((link) => link.isPrimary === true)
		? links.filter((link) => link.isPrimary === true)
		: links;

	return candidates.map((link) => link.managerId).toSorted()[0];
}

function unreachableApproverType(value: never): ApproverResolutionResult {
	return { ok: false, reason: `Unsupported approver type: ${value}` };
}

export function resolveApproverFromDirectory(
	input: ResolveApproverFromDirectoryInput,
): ApproverResolutionResult {
	const { organizationId, requesterEmployeeId, stage, employees, managerLinks } = input;
	const requester = activeEmployeeInOrg(employees, organizationId, requesterEmployeeId);

	if (!requester) {
		return { ok: false, reason: "Requester is not active in this organization." };
	}

	switch (stage.approverType) {
		case "direct_manager": {
			const manager = resolvePrimaryEligibleManager({
				organizationId,
				requesterEmployeeId: requester.id,
				employees,
				managerLinks,
				teamMemberships: input.teamMemberships ?? [],
				teams: input.teams ?? [],
			});

			return manager.ok
				? { ok: true, approverEmployeeId: manager.managerId }
				: { ok: false, reason: manager.reason };
		}

		case "manager_manager": {
			const manager = activeEmployeeInOrg(
				employees,
				organizationId,
				directManagerId(managerLinks, requester.id),
			);
			if (!manager) {
				return {
					ok: false,
					reason: "Requester has no active direct manager in this organization.",
				};
			}

			const secondManager = activeEmployeeInOrg(
				employees,
				organizationId,
				directManagerId(managerLinks, manager.id),
			);
			return secondManager
				? { ok: true, approverEmployeeId: secondManager.id }
				: { ok: false, reason: "Requester manager has no active manager in this organization." };
		}

		case "org_admin": {
			const admin = employees
				.filter(
					(employee) =>
						employee.organizationId === organizationId &&
						employee.isActive &&
						employee.role === "admin",
				)
				.toSorted((left, right) => left.id.localeCompare(right.id))[0];
			return admin
				? { ok: true, approverEmployeeId: admin.id }
				: { ok: false, reason: "Organization has no active admin approver." };
		}

		case "specific_employee": {
			const approver = activeEmployeeInOrg(employees, organizationId, stage.approverEmployeeId);
			return approver
				? { ok: true, approverEmployeeId: approver.id }
				: { ok: false, reason: "Specific approver is not active in this organization." };
		}

		case "team_lead":
			return { ok: false, reason: "Team lead approver stages are not available." };

		default:
			return unreachableApproverType(stage.approverType);
	}
}
