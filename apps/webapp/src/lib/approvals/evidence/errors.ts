export type ApprovalEvidenceErrorCode =
	/** Required submitted/decision evidence could not be established; nothing is guessed. */
	| "evidence_incomplete"
	/** Capture is active but this request has no submitted revision (review/hold). */
	| "evidence_required"
	/** Live material facts differ from the reviewed revision (resubmission required). */
	| "material_change"
	/** A supplied reviewed binding does not match the exact scoped decision target. */
	| "binding_mismatch"
	/** A known provider invocation arrived with a different bound command. */
	| "invocation_mismatch"
	/** Stored evidence contradicts its lifecycle identity or scope. */
	| "invariant";

export class ApprovalEvidenceError extends Error {
	readonly code: ApprovalEvidenceErrorCode;
	readonly details: Readonly<Record<string, string>>;

	constructor(
		code: ApprovalEvidenceErrorCode,
		details: Readonly<Record<string, string>> = {},
	) {
		super(`Approval evidence: ${code}`);
		this.name = "ApprovalEvidenceError";
		this.code = code;
		this.details = details;
	}
}
