export interface ApprovalTriagePolicy {
	/** Whole elapsed UTC hours, inclusive 1–720. */
	staleAfterHours: number;
	/** Whole minutes, inclusive 0–60. Zero disables the lane even for zero-delta edits. */
	smallCorrectionMinutes: number;
}

export const DEFAULT_APPROVAL_TRIAGE_POLICY: Readonly<ApprovalTriagePolicy> =
	Object.freeze({
		staleAfterHours: 72,
		smallCorrectionMinutes: 15,
	});
