import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	approveApprovalInboxItemMock,
	rejectApprovalInboxItemMock,
	loadApprovalInboxDecisionTargetMock,
} = vi.hoisted(() => ({
	approveApprovalInboxItemMock: vi.fn(),
	rejectApprovalInboxItemMock: vi.fn(),
	loadApprovalInboxDecisionTargetMock: vi.fn(),
}));

vi.mock("@/lib/approvals/init", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/approvals/inbox/decision-service", () => ({
	approveApprovalInboxItem: approveApprovalInboxItemMock,
	rejectApprovalInboxItem: rejectApprovalInboxItemMock,
	loadApprovalInboxDecisionTarget: loadApprovalInboxDecisionTargetMock,
	canAttemptApprovalInboxDecisionTarget: ({
		status,
		workflowKind,
	}: Record<string, string>) =>
		status === "pending" ||
		((status === "approved" || status === "rejected") &&
			(workflowKind === "manual_time_submission" ||
				workflowKind === "policy_clock_out")),
}));

import {
	canAttemptBotApprovalDecision,
	decideBotApproval,
} from "./approval-decision";

describe("bot approval decisions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("passes approval actor and organization scope to the inbox workflow", async () => {
		await decideBotApproval({
			approvalId: "approval-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
			action: "approve",
			platform: "slack",
		});

		expect(approveApprovalInboxItemMock).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
		});
		expect(rejectApprovalInboxItemMock).not.toHaveBeenCalled();
	});

	it.each([
		["teams", "Rejected via Teams"],
		["telegram", "Rejected via Telegram"],
		["discord", "Rejected via Discord"],
		["slack", "Rejected via Slack"],
	] as const)(
		"records exact %s rejection attribution",
		async (platform, reason) => {
			await decideBotApproval({
				approvalId: "approval-1",
				actorEmployeeId: "manager-1",
				organizationId: "org-1",
				action: "reject",
				platform,
			});

			expect(rejectApprovalInboxItemMock).toHaveBeenCalledWith({
				approvalId: "approval-1",
				actorEmployeeId: "manager-1",
				organizationId: "org-1",
				reason,
			});
			expect(approveApprovalInboxItemMock).not.toHaveBeenCalled();
		},
	);

	it.each([
		["pending", "time_correction", true],
		["approved", "manual_time_submission", true],
		["rejected", "policy_clock_out", true],
		["approved", "time_correction", false],
		["rejected", "unclassified", false],
		["cancelled", "manual_time_submission", false],
	] as const)(
		"returns %s/%s eligibility as %s",
		(status, workflowKind, expected) => {
			expect(canAttemptBotApprovalDecision({ status, workflowKind })).toBe(
				expected,
			);
		},
	);
});
