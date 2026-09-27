/**
 * Approval authority (#474): which record decides an approval kind in an
 * organization, and whether shadow mirroring or compatibility writing
 * applies. Callers ask these questions here instead of comparing lifecycle
 * modes; `workflow/cutover.ts` keeps only the transition rules.
 */
export {
	assertReviewBindingAuthority,
	type ReviewBindingAuthority,
	readReviewBindingAuthority,
} from "./binding";
export {
	type ApprovalAuthorityScope,
	acquireApprovalWriteGate,
	acquireApprovalWriteLock,
	approvalAuthoritySql,
	approvalRolloutLockScope,
	createApprovalWriteGate,
	readApprovalAuthoritySnapshot,
	readApprovalAuthoritySnapshots,
} from "./gate";
export {
	type ApprovalAuthority,
	type ApprovalAuthorityResolution,
	type ApprovalWriteGateResult,
	approvalAuthorityOf,
	approvalWriteGateResult,
	parseApprovalLifecycleMode,
	resolveApprovalAuthority,
} from "./resolution";
