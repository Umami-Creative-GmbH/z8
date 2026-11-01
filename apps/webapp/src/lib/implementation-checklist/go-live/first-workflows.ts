import type { ImplementationChecklistItemStatus } from "./types";

/**
 * First-workflow evidence (Organization glossary, "Going live"; ADR 0007):
 * proof that the organization really started working with Z8, noticed from
 * real records and never staged. It is informational and never affects go-live
 * readiness. Read live on each view; nothing is created to produce it.
 */

/** Who did it. `former` marks someone who has since become a former employee. */
export interface FirstWorkflowActor {
	employeeId: string;
	displayName: string;
	former: boolean;
}

/**
 * One evidence line: when it first happened (an ISO instant) and who did it,
 * not yet, or a failed lookup.
 */
export type FirstWorkflowEvidenceLine =
	| { state: "seen"; at: string; actor: FirstWorkflowActor }
	| { state: "not-yet" }
	| { state: "unavailable" };

export interface FirstWorkflowEvidence {
	/** The first clock-in by a member of the go-live group. */
	clockIn: FirstWorkflowEvidenceLine;
	/** The first approved or rejected request by a member of the go-live group. */
	decidedApproval: FirstWorkflowEvidenceLine;
	/** The organization's first successful payroll export, and who ran it. */
	payrollExport: FirstWorkflowEvidenceLine;
}

/** Evidence with every line unavailable, for when it could not even be looked up. */
export const UNAVAILABLE_FIRST_WORKFLOW_EVIDENCE: FirstWorkflowEvidence = {
	clockIn: { state: "unavailable" },
	decidedApproval: { state: "unavailable" },
	payrollExport: { state: "unavailable" },
};

/**
 * The First workflows item's status: unavailable when any line could not be
 * looked up, verified once every line was seen, configured while some were,
 * not set up before anything happened.
 */
export function firstWorkflowsItemStatus(
	evidence: FirstWorkflowEvidence,
): ImplementationChecklistItemStatus {
	const lines = [evidence.clockIn, evidence.decidedApproval, evidence.payrollExport];
	if (lines.some((line) => line.state === "unavailable")) return "unavailable";
	const seen = lines.filter((line) => line.state === "seen").length;
	if (seen === lines.length) return "verified";
	return seen > 0 ? "configured" : "not-set-up";
}
