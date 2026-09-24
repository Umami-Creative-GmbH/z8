import { Temporal } from "temporal-polyfill";

export interface EscalationPolicySnapshot {
	enabled: boolean;
	responseWindowHours: number;
	revision: number;
}

export type EscalationDeadlineEvaluation =
	| { kind: "disabled"; policyRevision: number }
	| { kind: "not_due"; deadline: Temporal.Instant; policyRevision: number }
	| { kind: "due"; deadline: Temporal.Instant; policyRevision: number };

/**
 * Exact elapsed-time deadline for one assignment (#251 §2.2, #255 §4).
 *
 * The deadline is the assignment's evidenced actionable instant plus the
 * *current* policy window, measured in absolute hours with no zone or DST
 * meaning. Editing the policy moves the deadline but never restarts the clock,
 * and eligibility starts exactly at the deadline. Callers record the returned
 * policy revision with any committed outcome.
 */
export function evaluateEscalationDeadline(input: {
	actionableAt: Temporal.Instant;
	policy: EscalationPolicySnapshot;
	now: Temporal.Instant;
}): EscalationDeadlineEvaluation {
	const policyRevision = input.policy.revision;
	if (!input.policy.enabled) return { kind: "disabled", policyRevision };

	const deadline = input.actionableAt.add({
		hours: input.policy.responseWindowHours,
	});
	return Temporal.Instant.compare(input.now, deadline) >= 0
		? { kind: "due", deadline, policyRevision }
		: { kind: "not_due", deadline, policyRevision };
}
