import "@/lib/approvals/init";
import {
	approveApprovalInboxItem,
	rejectApprovalInboxItem,
} from "@/lib/approvals/inbox/decision-service";
import type { BotPlatform } from "./types";

const platformNames: Record<BotPlatform, string> = {
	teams: "Teams",
	telegram: "Telegram",
	discord: "Discord",
	slack: "Slack",
};

export function canAttemptBotApprovalDecision(input: {
	status: string;
	entityType: string;
}): boolean {
	return input.status === "pending" || input.entityType === "time_entry";
}

export async function decideBotApproval({
	approvalId,
	actorEmployeeId,
	organizationId,
	action,
	platform,
}: {
	approvalId: string;
	actorEmployeeId: string;
	organizationId: string;
	action: "approve" | "reject";
	platform: BotPlatform;
}) {
	if (action === "approve") {
		return approveApprovalInboxItem({
			approvalId,
			actorEmployeeId,
			organizationId,
		});
	}

	const platformName = platformNames[platform];
	return rejectApprovalInboxItem({
		approvalId,
		actorEmployeeId,
		organizationId,
		reason: `Rejected via ${platformName}`,
	});
}
