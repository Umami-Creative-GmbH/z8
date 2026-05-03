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
}

function activeEmployeeInOrg(
	employees: ApproverDirectoryEmployee[],
	organizationId: string,
	employeeId: string | undefined,
) {
	return employees.find(
		(employee) =>
			employee.id === employeeId &&
			employee.organizationId === organizationId &&
			employee.isActive,
	);
}

function directManagerId(managerLinks: ApproverDirectoryManagerLink[], employeeId: string) {
	return managerLinks.find((link) => link.employeeId === employeeId)?.managerId;
}

export function resolveApproverFromDirectory(
	input: ResolveApproverFromDirectoryInput,
): ApproverResolutionResult {
	const { organizationId, requesterEmployeeId, stage, employees, managerLinks } = input;

	if (stage.approverType === "direct_manager") {
		const manager = activeEmployeeInOrg(
			employees,
			organizationId,
			directManagerId(managerLinks, requesterEmployeeId),
		);
		return manager
			? { ok: true, approverEmployeeId: manager.id }
			: { ok: false, reason: "Requester has no active direct manager in this organization." };
	}

	if (stage.approverType === "manager_manager") {
		const manager = activeEmployeeInOrg(
			employees,
			organizationId,
			directManagerId(managerLinks, requesterEmployeeId),
		);
		if (!manager) {
			return { ok: false, reason: "Requester has no active direct manager in this organization." };
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

	if (stage.approverType === "org_admin") {
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

	if (stage.approverType === "specific_employee") {
		const approver = activeEmployeeInOrg(employees, organizationId, stage.approverEmployeeId);
		return approver
			? { ok: true, approverEmployeeId: approver.id }
			: { ok: false, reason: "Specific approver is not active in this organization." };
	}

	return { ok: false, reason: "Team lead approver stages are not available." };
}
