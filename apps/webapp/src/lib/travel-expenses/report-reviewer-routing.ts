import {
	type ResolveEligibleManagersInput,
	resolveDirectEligibleManagers,
	resolveEligibleManagers,
} from "@/lib/approvals/policies/manager-eligibility";

/**
 * The one eligible reviewer of a submitted expense report (#602): the direct
 * manager, then the team manager, then the organization's configured expense
 * approver. The requester never reviews their own report, at any level; when
 * nobody else is eligible the report is not routed, never approved silently.
 */

export type ReportReviewerSource = "direct_manager" | "team_manager" | "expense_approver";

export type ReportReviewerResult =
	| { ok: true; reviewerId: string; source: ReportReviewerSource }
	| { ok: false; reason: "requester_inactive" | "no_eligible_reviewer" };

export interface ResolveReportReviewerInput
	extends Omit<ResolveEligibleManagersInput, "requesterMode"> {
	/** Organization setting; an active manager or admin of the organization. */
	expenseApproverEmployeeId: string | null;
}

function primaryFirst(
	managerIds: readonly string[],
	input: ResolveReportReviewerInput,
): string | undefined {
	const eligible = new Set(managerIds);
	const primary = input.managerLinks.find(
		(link) =>
			link.employeeId === input.requesterEmployeeId &&
			link.isPrimary &&
			eligible.has(link.managerId),
	);
	return primary?.managerId ?? managerIds[0];
}

export function resolveReportReviewer(input: ResolveReportReviewerInput): ReportReviewerResult {
	const requester = input.employees.find(
		(candidate) =>
			candidate.id === input.requesterEmployeeId &&
			candidate.organizationId === input.organizationId,
	);
	if (!requester?.isActive) return { ok: false, reason: "requester_inactive" };
	const notRequester = (id: string) => id !== input.requesterEmployeeId;

	const direct = resolveDirectEligibleManagers(input);
	const directIds = direct.ok ? direct.managerIds.filter(notRequester) : [];
	const directReviewer = primaryFirst(directIds, input);
	if (directReviewer) return { ok: true, reviewerId: directReviewer, source: "direct_manager" };

	// Without manager links the shared resolver falls through to team managers.
	const team = resolveEligibleManagers({ ...input, managerLinks: [] });
	const teamReviewer = team.ok ? team.managerIds.find(notRequester) : undefined;
	if (teamReviewer) return { ok: true, reviewerId: teamReviewer, source: "team_manager" };

	const approverId = input.expenseApproverEmployeeId;
	const approver = approverId
		? input.employees.find(
				(candidate) =>
					candidate.id === approverId &&
					candidate.organizationId === input.organizationId &&
					candidate.isActive &&
					// Only managers and admins can open the Approvals inbox.
					(candidate.role === "manager" || candidate.role === "admin"),
			)
		: undefined;
	if (approver && notRequester(approver.id)) {
		return { ok: true, reviewerId: approver.id, source: "expense_approver" };
	}
	return { ok: false, reason: "no_eligible_reviewer" };
}
