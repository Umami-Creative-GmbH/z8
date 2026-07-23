import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { approveApprovalInboxItemMock, rejectApprovalInboxItemMock } =
	vi.hoisted(() => ({
		approveApprovalInboxItemMock: vi.fn(),
		rejectApprovalInboxItemMock: vi.fn(),
	}));

vi.mock("@/lib/approvals/init", () => ({}));
vi.mock("@/lib/approvals/inbox/decision-service", () => ({
	approveApprovalInboxItem: approveApprovalInboxItemMock,
	rejectApprovalInboxItem: rejectApprovalInboxItemMock,
}));

import {
	canAttemptBotApprovalDecision,
	decideBotApproval,
} from "./approval-decision";

describe("bot approval decisions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("delegates approve and reject actions to the canonical inbox workflow", () => {
		const adapterUrl = new URL("./approval-decision.ts", import.meta.url);

		expect(existsSync(adapterUrl)).toBe(true);
		if (!existsSync(adapterUrl)) return;

		const source = readFileSync(fileURLToPath(adapterUrl), "utf8");
		expect(source).toContain('import "@/lib/approvals/init"');
		expect(source).toContain("approveApprovalInboxItem");
		expect(source).toContain("rejectApprovalInboxItem");
		expect(source).toMatch(/Rejected via \$\{platformName\}/);
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

	it("records the originating platform when rejecting", async () => {
		await decideBotApproval({
			approvalId: "approval-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
			action: "reject",
			platform: "teams",
		});

		expect(rejectApprovalInboxItemMock).toHaveBeenCalledWith({
			approvalId: "approval-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
			reason: "Rejected via Teams",
		});
		expect(approveApprovalInboxItemMock).not.toHaveBeenCalled();
	});

	it.each([
		["pending", "time_entry", true],
		["approved", "time_entry", true],
		["rejected", "time_entry", true],
		["approved", "absence", false],
		["rejected", "absence", false],
	] as const)("returns %s/%s eligibility as %s", (status, entityType, expected) => {
		expect(canAttemptBotApprovalDecision({ status, entityType })).toBe(
			expected,
		);
	});
});

describe("external approval handler architecture", () => {
	const handlerUrls = [
		new URL("../slack/approval-handler.ts", import.meta.url),
		new URL("../discord/approval-handler.ts", import.meta.url),
		new URL("../telegram/approval-handler.ts", import.meta.url),
		new URL("../teams/approval-handler.ts", import.meta.url),
	];

	it.each(
		handlerUrls,
	)("routes %s through the shared canonical adapter", (handlerUrl) => {
		const source = readFileSync(fileURLToPath(handlerUrl), "utf8");

		expect(source).toContain("decideBotApproval");
		expect(source).not.toMatch(/\.update\((approvalRequest|absenceEntry)\)/);
	});
});
