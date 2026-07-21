import {
	type EligibleManagerEmployee,
	type EligibleManagerLink,
	type EligibleTeam,
	type EligibleTeamMembership,
	resolveDirectEligibleManagers,
	resolveEligibleManagers,
	resolvePrimaryEligibleManager,
} from "../policies/manager-eligibility";
import type { ApprovalRoutingContext } from "./types";

export interface ApprovalStageResolverSnapshot {
	approverType: string;
	approverEmployeeId?: string;
	fallbackBehavior: string;
}

export interface ApprovalStageReviewerDirectory {
	employees: EligibleManagerEmployee[];
	managerLinks: EligibleManagerLink[];
	teamMemberships: EligibleTeamMembership[];
	teams: EligibleTeam[];
}

export type ApprovalStageReviewerResolution =
	| { activationMode: "human"; approverEmployeeIds: string[] }
	| {
			activationMode: "requester_auto_approve";
			reason: "requester_is_approver";
	  };

export class ApprovalStageActivationError extends Error {
	constructor(
		readonly code: "no_eligible_reviewer" | "invalid_stage_resolver",
		message: string,
	) {
		super(message);
		this.name = "ApprovalStageActivationError";
	}
}

function activeEmployeeInOrganization(
	employees: EligibleManagerEmployee[],
	organizationId: string,
	employeeId: string,
) {
	return employees.find(
		(employee) =>
			employee.id === employeeId &&
			employee.organizationId === organizationId &&
			employee.isActive,
	);
}

function activeOrganizationAdminIds(
	directory: ApprovalStageReviewerDirectory,
	organizationId: string,
) {
	return directory.employees.flatMap((employee) =>
		employee.organizationId === organizationId &&
		employee.isActive &&
		employee.role === "admin"
			? [employee.id]
			: [],
	);
}

function resolveDisposition(
	candidateIds: string[],
	context: ApprovalRoutingContext,
): ApprovalStageReviewerResolution {
	const approverEmployeeIds = Array.from(new Set(candidateIds)).toSorted(
		(left, right) => left.localeCompare(right),
	);
	if (approverEmployeeIds.length === 0) {
		throw new ApprovalStageActivationError(
			"no_eligible_reviewer",
			"No eligible reviewer.",
		);
	}

	if (approverEmployeeIds.includes(context.requesterEmployeeId)) {
		return {
			activationMode: "requester_auto_approve",
			reason: "requester_is_approver",
		};
	}

	return { activationMode: "human", approverEmployeeIds };
}

export function resolveApprovalStageReviewers({
	context,
	stage,
	directory,
}: {
	context: ApprovalRoutingContext;
	stage: ApprovalStageResolverSnapshot;
	directory: ApprovalStageReviewerDirectory;
}): ApprovalStageReviewerResolution {
	if (
		stage.approverType !== "direct_manager" &&
		stage.approverType !== "manager_manager" &&
		stage.approverType !== "org_admin" &&
		stage.approverType !== "specific_employee"
	) {
		throw new ApprovalStageActivationError(
			"invalid_stage_resolver",
			"Unsupported approver type.",
		);
	}

	if (
		stage.approverType === "specific_employee" &&
		(typeof stage.approverEmployeeId !== "string" ||
			stage.approverEmployeeId.trim().length === 0)
	) {
		throw new ApprovalStageActivationError(
			"invalid_stage_resolver",
			"Unsupported specific employee.",
		);
	}

	if (
		stage.fallbackBehavior !== "fail" &&
		stage.fallbackBehavior !== "default_manager" &&
		stage.fallbackBehavior !== "organization_admin"
	) {
		throw new ApprovalStageActivationError(
			"invalid_stage_resolver",
			"Unsupported fallback behavior.",
		);
	}

	const requesterIsActive = Boolean(
		activeEmployeeInOrganization(
			directory.employees,
			context.organizationId,
			context.requesterEmployeeId,
		),
	);

	const managerInput = {
		...directory,
		organizationId: context.organizationId,
		requesterEmployeeId: context.requesterEmployeeId,
	};

	const primaryCandidateIds = requesterIsActive
		? (() => {
				switch (stage.approverType) {
					case "direct_manager": {
						const result = resolveEligibleManagers(managerInput);
						return result.ok ? result.managerIds : [];
					}
					case "manager_manager": {
						const primary = resolvePrimaryEligibleManager(managerInput);
						if (!primary.ok) {
							return [];
						}

						const result = resolveDirectEligibleManagers({
							...managerInput,
							requesterEmployeeId: primary.managerId,
						});
						return result.ok ? result.managerIds : [];
					}
					case "org_admin":
						return activeOrganizationAdminIds(
							directory,
							context.organizationId,
						);
					case "specific_employee":
						return stage.approverEmployeeId &&
							activeEmployeeInOrganization(
								directory.employees,
								context.organizationId,
								stage.approverEmployeeId,
							)
							? [stage.approverEmployeeId]
							: [];
				}
			})()
		: [];

	if (primaryCandidateIds.length > 0) {
		return resolveDisposition(primaryCandidateIds, context);
	}

	switch (stage.fallbackBehavior) {
		case "fail":
			return resolveDisposition([], context);
		case "default_manager": {
			const result = resolveEligibleManagers(managerInput);
			return resolveDisposition(result.ok ? result.managerIds : [], context);
		}
		case "organization_admin":
			return resolveDisposition(
				activeOrganizationAdminIds(directory, context.organizationId),
				context,
			);
		default:
			throw new ApprovalStageActivationError(
				"invalid_stage_resolver",
				"Unsupported fallback behavior.",
			);
	}
}
