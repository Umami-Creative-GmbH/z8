import {
	type EligibleManagerEmployee,
	type EligibleManagerLink,
	type EligibleTeam,
	type EligibleTeamMembership,
	type RequesterEligibilityMode,
	requesterMayBeResolved,
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
	/** Replacements captured by effective departures, keyed by departed employee. */
	departureReplacements?: Array<{ employeeId: string; replacementEmployeeId: string }>;
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

/**
 * An explicit approver who has departed is replaced by the replacement their
 * effective departure captured, if that person is active and is not the
 * requester (which would silently auto-approve). Otherwise the stage has no
 * primary candidate and its configured fallback decides, visibly failing
 * with `fail` rather than waiting on a departed person.
 */
function specificApproverIds(
	directory: ApprovalStageReviewerDirectory,
	context: ApprovalRoutingContext,
	approverEmployeeId: string | undefined,
): string[] {
	if (!approverEmployeeId) return [];
	if (
		activeEmployeeInOrganization(
			directory.employees,
			context.organizationId,
			approverEmployeeId,
		)
	) {
		return [approverEmployeeId];
	}
	const replacementId = directory.departureReplacements?.find(
		(replacement) => replacement.employeeId === approverEmployeeId,
	)?.replacementEmployeeId;
	return replacementId &&
		replacementId !== context.requesterEmployeeId &&
		activeEmployeeInOrganization(
			directory.employees,
			context.organizationId,
			replacementId,
		)
		? [replacementId]
		: [];
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

/**
 * Kinds a requester never completes by being their own approver (#1059). A stage that resolves
 * to the requester among others goes to the others; one that resolves to the requester alone
 * goes to the organization's admins other than the requester, and is refused without one.
 */
const REQUESTER_NEVER_AUTO_APPROVES: ReadonlySet<string> = new Set(["period_submission"]);

function resolveWithoutRequester(
	candidateIds: string[],
	context: ApprovalRoutingContext,
	directory: ApprovalStageReviewerDirectory,
): ApprovalStageReviewerResolution {
	const others = candidateIds.filter((id) => id !== context.requesterEmployeeId);
	if (others.length > 0 || candidateIds.length === 0) {
		return resolveDisposition(others, context);
	}
	return resolveDisposition(
		activeOrganizationAdminIds(directory, context.organizationId).filter(
			(id) => id !== context.requesterEmployeeId,
		),
		context,
	);
}

export function resolveApprovalStageReviewers({
	context,
	stage,
	directory,
	requesterMode = "new_submission",
}: {
	context: ApprovalRoutingContext;
	stage: ApprovalStageResolverSnapshot;
	directory: ApprovalStageReviewerDirectory;
	/** `existing_workflow` only for a stage of an already persisted workflow. */
	requesterMode?: RequesterEligibilityMode;
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

	const requester = directory.employees.find(
		(employee) =>
			employee.id === context.requesterEmployeeId &&
			employee.organizationId === context.organizationId,
	);
	const requesterResolvable = requesterMayBeResolved({
		requesterExistsInOrganization: requester !== undefined,
		requesterIsActive: requester?.isActive === true,
		mode: requesterMode,
	});

	const managerInput = {
		...directory,
		organizationId: context.organizationId,
		requesterEmployeeId: context.requesterEmployeeId,
		requesterMode,
	};

	const primaryCandidateIds = requesterResolvable
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

						// The intermediate manager is a current approver, never historical.
						const result = resolveDirectEligibleManagers({
							...managerInput,
							requesterEmployeeId: primary.managerId,
							requesterMode: "new_submission",
						});
						return result.ok ? result.managerIds : [];
					}
					case "org_admin":
						return activeOrganizationAdminIds(
							directory,
							context.organizationId,
						);
					case "specific_employee":
						return specificApproverIds(
							directory,
							context,
							stage.approverEmployeeId,
						);
				}
			})()
		: [];

	const dispose = (candidateIds: string[]) =>
		REQUESTER_NEVER_AUTO_APPROVES.has(context.workflowType)
			? resolveWithoutRequester(candidateIds, context, directory)
			: resolveDisposition(candidateIds, context);

	if (primaryCandidateIds.length > 0) {
		return dispose(primaryCandidateIds);
	}

	switch (stage.fallbackBehavior) {
		case "fail":
			return dispose([]);
		case "default_manager": {
			const result = resolveEligibleManagers(managerInput);
			return dispose(result.ok ? result.managerIds : []);
		}
		case "organization_admin":
			return dispose(activeOrganizationAdminIds(directory, context.organizationId));
		default:
			throw new ApprovalStageActivationError(
				"invalid_stage_resolver",
				"Unsupported fallback behavior.",
			);
	}
}
