import {
	APPROVAL_WORKFLOW_LIFECYCLE_MODES,
	type ApprovalWorkflowLifecycleMode,
} from "../workflow/ports";

/**
 * Which record decides an approval (see `approvals/CONTEXT.md`): legacy
 * requests, or canonical workflows.
 */
export type ApprovalAuthority = "legacy" | "canonical";

/**
 * What one lifecycle mode means for an approval kind. `mode` stays for
 * diagnostics and recorded evidence; business logic asks the other fields.
 */
export interface ApprovalAuthorityResolution {
	readonly mode: ApprovalWorkflowLifecycleMode;
	readonly authority: ApprovalAuthority;
	/** Each legacy write is copied into a canonical workflow (`shadow`, `ready`). */
	readonly shadowMirroring: boolean;
	/** Legacy requests are kept in step with canonical workflows (`canonical`). */
	readonly compatibilityWriting: boolean;
}

declare const gated: unique symbol;

/**
 * A resolution read under the shared rollout lock. Only this may back a
 * decision or a write; a snapshot cannot stand in for it.
 */
export interface ApprovalWriteGateResult extends ApprovalAuthorityResolution {
	readonly [gated]: true;
}

const LIFECYCLE: Record<
	ApprovalWorkflowLifecycleMode,
	Omit<ApprovalAuthorityResolution, "mode">
> = {
	legacy: { authority: "legacy", shadowMirroring: false, compatibilityWriting: false },
	shadow: { authority: "legacy", shadowMirroring: true, compatibilityWriting: false },
	ready: { authority: "legacy", shadowMirroring: true, compatibilityWriting: false },
	canonical: { authority: "canonical", shadowMirroring: false, compatibilityWriting: true },
	complete: { authority: "canonical", shadowMirroring: false, compatibilityWriting: false },
};

/** The lifecycle modes under which an approval authority decides, in rollout order. */
export function lifecycleModesWithAuthority(
	authority: ApprovalAuthority,
): readonly ApprovalWorkflowLifecycleMode[] {
	return APPROVAL_WORKFLOW_LIFECYCLE_MODES.filter(
		(mode) => LIFECYCLE[mode].authority === authority,
	);
}

/**
 * Narrows a stored lifecycle mode. A missing row (null or undefined) is
 * `legacy`; any other unknown value is refused.
 */
export function parseApprovalLifecycleMode(value: unknown): ApprovalWorkflowLifecycleMode {
	if (value === null || value === undefined) return "legacy";
	if (typeof value !== "string" || !Object.hasOwn(LIFECYCLE, value)) {
		throw new Error("Approval workflow rollout mode is unavailable");
	}
	return value as ApprovalWorkflowLifecycleMode;
}

/**
 * What a lifecycle mode means, for presentation, reports, planners,
 * self-service and escalation context. No row (null) is `legacy`. Advisory
 * only: a decision or write needs the gated read.
 */
export function resolveApprovalAuthority(
	mode: ApprovalWorkflowLifecycleMode | null | undefined,
): ApprovalAuthorityResolution {
	const parsed = parseApprovalLifecycleMode(mode);
	return Object.freeze({ mode: parsed, ...LIFECYCLE[parsed] });
}

/** The approval authority of a lifecycle mode; no row (null) is `legacy`. */
export function approvalAuthorityOf(
	mode: ApprovalWorkflowLifecycleMode | null | undefined,
): ApprovalAuthority {
	return resolveApprovalAuthority(mode).authority;
}

/**
 * The only constructor of a gate result: the gated read and test fakes build
 * it from a mode, so no caller can pair a mode with another mode's answers.
 */
export function approvalWriteGateResult(
	mode: ApprovalWorkflowLifecycleMode,
): ApprovalWriteGateResult {
	if (mode === null || mode === undefined) {
		throw new Error("Approval workflow rollout mode is unavailable");
	}
	return resolveApprovalAuthority(mode) as ApprovalWriteGateResult;
}
