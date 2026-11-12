import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { LegacyRouteFailure } from "../policies/legacy-route-decision";
import {
	classifyLegacyStage,
	type LegacyStageDisposition,
} from "../policies/requester-auto-approval";
import type { ApprovalPolicyDraft } from "../policies/types";
import type { ApprovalDirectChange, ApprovalRouteNote, ApprovalRouteSkipReason } from "./types";

/**
 * The built-in approval rules of each kind, as pure functions over loaded facts. The approval
 * route preview applies them; each kind's submit path adopts the same function (#1601-#1604), so
 * the two can't drift.
 */

/** The change-policy fields the built-in rules read. */
export type ChangePolicyTerms = {
	noApprovalRequired: boolean;
	selfServiceDays: number;
	approvalDays: number;
};

// --- Absence ---------------------------------------------------------------------------------

/**
 * Only an absence of a category that requires approval starts a route; any other is approved on
 * submission. The submit path asks this of the requested category, the snapshot of every active one.
 */
export function absenceCategoryNeedsApproval(category: { requiresApproval: boolean }): boolean {
	return category.requiresApproval;
}

/** Absence requests need an approver only when an active category requires approval. */
export function absenceNeedsApproval(approvalCategoryIds: readonly string[]): boolean {
	return approvalCategoryIds.length > 0;
}

export type AbsenceRouteFallback =
	| {
			kind: "default_approver";
			approverEmployeeId: string;
			disposition: LegacyStageDisposition;
	  }
	/** Submitting fails with "No manager assigned to approve absence requests". */
	| { kind: "no_default_approver" };

/**
 * Under legacy authority an absence whose policy routing fails goes to the requester's default
 * approver instead, completing on submission when that is the requester themselves; with no
 * default approver it can't be submitted. Every route failure falls back (no default approver,
 * an unresolvable stage, a policy without stages) except malformed policies: submitting throws
 * on them (`null`).
 */
export function absenceRouteFallback(input: {
	failure: LegacyRouteFailure;
	requesterEmployeeId: string;
	defaultApproverId: string | null;
}): AbsenceRouteFallback | null {
	if (input.failure.reason === "invalid_policies") return null;
	if (input.defaultApproverId === null) return { kind: "no_default_approver" };
	return {
		kind: "default_approver",
		approverEmployeeId: input.defaultApproverId,
		disposition: classifyLegacyStage({
			requesterEmployeeId: input.requesterEmployeeId,
			approverEmployeeId: input.defaultApproverId,
		}),
	};
}

/**
 * The absence categories worth previewing: each requiring category a policy condition names, and
 * one other (they all route alike). Empty when no category requires approval.
 */
export function absenceCategoryVariants(
	categoryIds: readonly string[],
	policies: readonly ApprovalPolicyDraft[],
): string[] {
	const named = new Set(
		policies.flatMap((policy) =>
			policy.conditions.flatMap((condition) =>
				condition.conditionType === "absence_category"
					? [condition.value, ...(condition.values ?? [])].filter(
							(value): value is string => typeof value === "string",
						)
					: [],
			),
		),
	);
	const checked = categoryIds.filter((id) => named.has(id));
	const other = categoryIds.find((id) => !named.has(id));
	return other ? [...checked, other] : checked;
}

// --- Manual work -----------------------------------------------------------------------------

/** Owners and admins record their own manual work directly, without approval. */
export function isOwnerOrAdminSelfRecording(organizationRole: string | null | undefined): boolean {
	return (
		hasOrganizationRole(organizationRole, "owner") || hasOrganizationRole(organizationRole, "admin")
	);
}

/**
 * Whether manual work needs approval under the change policy in effect. Without an entry (the
 * preview) a policy that requires approval is routed, with a note when entries within its
 * self-service days skip approval.
 */
export function manualWorkChangePolicyRule(
	policy: ChangePolicyTerms | null,
): { skip: ApprovalRouteSkipReason } | { skip: null; notes: ApprovalRouteNote[] } {
	if (!policy) return { skip: "change_policy_no_policy" };
	if (policy.noApprovalRequired) return { skip: "change_policy_trust_mode" };
	return {
		skip: null,
		notes:
			policy.selfServiceDays > 0
				? [{ code: "within_self_service_skips", selfServiceDays: policy.selfServiceDays }]
				: [],
	};
}

// --- Time correction -------------------------------------------------------------------------

/**
 * Why a requester edits their own entries directly under the change policy in effect, if they
 * do. Only a note: deletion requests and date-changing edits always go to approval (U1).
 */
export function timeCorrectionDirectChange(
	policy: ChangePolicyTerms | null,
): ApprovalDirectChange | null {
	if (!policy) return "change_policy_no_policy";
	if (policy.noApprovalRequired) return "change_policy_trust_mode";
	if (policy.approvalDays === 0) return "change_policy_within_self_service";
	return null;
}

// --- Expense report --------------------------------------------------------------------------

/**
 * A route that reaches the requester themselves is refused, unless the requester is the owner
 * and nobody else can review (#679): then the report completes on submission.
 */
export function expenseSelfApprovalRule(input: {
	requesterEmployeeId: string;
	autoCompleted: boolean;
	stageApproverIds: readonly string[];
	ownerAlone: boolean;
}): "allowed" | "owner_self_approval" | "refused" {
	if (input.autoCompleted) return input.ownerAlone ? "owner_self_approval" : "refused";
	return input.stageApproverIds.includes(input.requesterEmployeeId) ? "refused" : "allowed";
}

/**
 * Report totals worth previewing: zero, every amount threshold of an active policy, a value
 * between neighbouring thresholds and one above the highest, so each amount band is routed once.
 */
export function expenseAmountVariants(policies: readonly ApprovalPolicyDraft[]): number[] {
	const thresholds = [
		...new Set(
			policies.flatMap((policy) =>
				policy.conditions.flatMap((condition) =>
					condition.conditionType === "travel_expense_amount"
						? [condition.amountMin, condition.amountMax].filter(
								(value): value is number => typeof value === "number" && value > 0,
							)
						: [],
				),
			),
		),
	].toSorted((left, right) => left - right);
	const amounts = [0];
	for (const [index, threshold] of thresholds.entries()) {
		const previous = index === 0 ? 0 : (thresholds[index - 1] ?? 0);
		amounts.push((previous + threshold) / 2, threshold);
	}
	const highest = thresholds.at(-1);
	if (highest !== undefined) amounts.push(highest + 1);
	return [...new Set(amounts)];
}

// --- Shift request ---------------------------------------------------------------------------

/** Shared with the shift request decision check (#1604). */
export { shiftRequestDeciders } from "../shift-request-deciders";
