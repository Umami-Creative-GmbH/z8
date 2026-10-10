import type { ApprovalWorkflowType } from "./types";

/**
 * How an approval kind starts in every organization.
 *
 * - `legacy`: legacy requests decide first. The kind's lifecycle mode starts
 *   at `legacy` and moves forward only through cutover.
 * - `canonical_only`: canonical workflows decide from the first day
 *   (Approvals ADR-0002). The lifecycle mode starts at `complete`, never
 *   changes, and no legacy request is ever written for the kind.
 */
export type ApprovalKindStart = "legacy" | "canonical_only";

/**
 * Every kind's start, declared explicitly. A new kind must choose one here;
 * the authority module derives the initial lifecycle mode from it.
 */
export const APPROVAL_KIND_START: Readonly<Record<ApprovalWorkflowType, ApprovalKindStart>> = {
	absence: "legacy",
	time_correction: "legacy",
	manual_time_submission: "legacy",
	policy_clock_out: "legacy",
	travel_expense: "legacy",
	shift_request: "legacy",
	compliance_exception: "legacy",
	period_submission: "canonical_only",
};
