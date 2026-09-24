import { describe, expect, it } from "vitest";
import {
	classifyEscalationAttentionRecheck,
	type EscalationAttentionInput,
	escalationAttentionApprovalHref,
	escalationAttentionDedupeKey,
} from "./attention";

function input(
	overrides: Partial<EscalationAttentionInput>,
): EscalationAttentionInput {
	return {
		organizationId: "org-1",
		reason: "no_eligible_backup",
		subject: { kind: "assignment", assignmentId: "assignment-1" },
		evidence: {},
		...overrides,
	};
}

describe("escalationAttentionDedupeKey", () => {
	it("deduplicates repeated observations of the same assignment condition", () => {
		const first = escalationAttentionDedupeKey(input({ evidence: { run: 1 } }));
		const second = escalationAttentionDedupeKey(
			input({ evidence: { run: 2 } }),
		);

		expect(first).toBe("no_eligible_backup:assignment:assignment-1");
		expect(second).toBe(first);
	});

	it("keeps different reasons and assignments as separate incidents", () => {
		expect(
			escalationAttentionDedupeKey(input({ reason: "replacement_overdue" })),
		).not.toBe(escalationAttentionDedupeKey(input({})));
		expect(
			escalationAttentionDedupeKey(
				input({
					subject: { kind: "assignment", assignmentId: "assignment-2" },
				}),
			),
		).not.toBe(escalationAttentionDedupeKey(input({})));
	});

	it("identifies legacy assignments by approval request and approver", () => {
		expect(
			escalationAttentionDedupeKey(
				input({
					reason: "unsupported_route",
					subject: {
						kind: "legacy_assignment",
						approvalRequestId: "request-1",
						approverEmployeeId: "employee-1",
					},
				}),
			),
		).toBe("unsupported_route:approval:request-1:approver:employee-1");
	});

	it("scopes ambiguous history to the lineage when known", () => {
		expect(
			escalationAttentionDedupeKey(
				input({
					reason: "ambiguous_history",
					lineageRootAssignmentId: "root-1",
				}),
			),
		).toBe("ambiguous_history:lineage:root-1");
	});

	it("tracks exhausted delivery per channel and requires one", () => {
		expect(
			escalationAttentionDedupeKey(
				input({ reason: "delivery_exhausted", deliveryChannel: "slack" }),
			),
		).toBe("delivery_exhausted:assignment:assignment-1:channel:slack");
		expect(() =>
			escalationAttentionDedupeKey(input({ reason: "delivery_exhausted" })),
		).toThrow(/delivery channel/);
	});
});

describe("classifyEscalationAttentionRecheck", () => {
	const assignmentIncident = {
		reason: "no_eligible_backup" as const,
		assignmentId: "assignment-1",
		currentApproverEmployeeId: "employee-1",
	};
	const legacyIncident = { ...assignmentIncident, assignmentId: null };

	it("keeps incidents open while the approval and assignment remain pending", () => {
		expect(
			classifyEscalationAttentionRecheck(assignmentIncident, {
				workflowStatus: "pending",
				assignmentStatus: "pending",
			}),
		).toEqual({ kind: "persisting" });
	});

	it("does not treat missing records as recovery", () => {
		expect(
			classifyEscalationAttentionRecheck(assignmentIncident, {
				workflowStatus: null,
				assignmentStatus: null,
			}),
		).toEqual({ kind: "persisting" });
	});

	it("resolves once the approval is decided", () => {
		expect(
			classifyEscalationAttentionRecheck(legacyIncident, {
				approvalStatus: "approved",
				approvalApproverEmployeeId: "employee-1",
			}),
		).toEqual({ kind: "recovered", cause: "approval_no_longer_pending" });
	});

	it("resolves once the concerned assignment is no longer pending", () => {
		expect(
			classifyEscalationAttentionRecheck(assignmentIncident, {
				workflowStatus: "pending",
				assignmentStatus: "cancelled",
			}),
		).toEqual({ kind: "recovered", cause: "assignment_no_longer_pending" });
	});

	it("resolves a legacy incident once the approval moved to another approver", () => {
		expect(
			classifyEscalationAttentionRecheck(legacyIncident, {
				approvalStatus: "pending",
				approvalApproverEmployeeId: "employee-2",
			}),
		).toEqual({ kind: "recovered", cause: "assignment_moved" });
	});

	it("keeps lineage-wide history ambiguity open across reassignment until the approval settles", () => {
		const incident = {
			...assignmentIncident,
			reason: "ambiguous_history" as const,
		};

		expect(
			classifyEscalationAttentionRecheck(incident, {
				workflowStatus: "pending",
				assignmentStatus: "cancelled",
			}),
		).toEqual({ kind: "persisting" });
		expect(
			classifyEscalationAttentionRecheck(incident, {
				workflowStatus: "rejected",
			}),
		).toEqual({ kind: "recovered", cause: "approval_no_longer_pending" });
	});
});

describe("escalationAttentionApprovalHref", () => {
	it("links canonical and legacy approval types to their inbox filter", () => {
		expect(escalationAttentionApprovalHref("absence")).toBe(
			"/approvals/inbox?types=absence_entry",
		);
		expect(escalationAttentionApprovalHref("policy_clock_out")).toBe(
			"/approvals/inbox?types=time_entry",
		);
		expect(escalationAttentionApprovalHref("travel_expense")).toBe(
			"/approvals/inbox?types=travel_expense_claim",
		);
		expect(escalationAttentionApprovalHref("shift_request")).toBe(
			"/approvals/inbox",
		);
		expect(escalationAttentionApprovalHref(null)).toBe("/approvals/inbox");
	});
});
