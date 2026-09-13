import "@/lib/approvals/init";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequest } from "@/db/schema";
import {
	approveApprovalInboxItem,
	canAttemptApprovalInboxDecisionTarget,
	loadApprovalInboxDecisionTarget,
	rejectApprovalInboxItem,
} from "@/lib/approvals/inbox/decision-service";
import type { BotPlatform } from "./types";

const platformNames: Record<BotPlatform, string> = {
	teams: "Teams",
	telegram: "Telegram",
	discord: "Discord",
	slack: "Slack",
};

type BotApprovalAttemptInput = {
	approvalId: string;
	actorEmployeeId: string;
	organizationId: string;
	action: "approve" | "reject";
	platform: BotPlatform;
};

export type BotApprovalAttemptResult =
	| { status: "not_found" }
	| { status: "already_processed" }
	| { status: "unauthorized" }
	| {
			status: "succeeded";
			/** Original compatibility request for presentation, never decision authority. */
			approval: typeof approvalRequest.$inferSelect;
	  };

/**
 * Attempt a bot decision after the adapter has resolved its actor and organization.
 * Initial compatibility-request absence is a semantic exit; subsequent loading or
 * decision errors propagate to the platform's exception handler.
 */
export async function attemptBotApproval(
	input: BotApprovalAttemptInput,
): Promise<BotApprovalAttemptResult> {
	const approval = await db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalId),
			eq(approvalRequest.organizationId, input.organizationId),
		),
	});
	if (!approval) return { status: "not_found" };

	const target = await loadApprovalInboxDecisionTarget(input);
	if (!canAttemptApprovalInboxDecisionTarget(target)) {
		return { status: "already_processed" };
	}
	if (target.approverId !== input.actorEmployeeId) {
		return { status: "unauthorized" };
	}

	// The public inbox interface reloads and authorizes the target before dispatch.
	await decideBotApproval(input);
	return { status: "succeeded", approval };
}

export function canAttemptBotApprovalDecision(input: {
	status: string;
	workflowKind:
		| "time_correction"
		| "manual_time_submission"
		| "policy_clock_out"
		| "unclassified"
		| null;
}): boolean {
	return canAttemptApprovalInboxDecisionTarget(input);
}

export function loadBotApprovalDecisionTarget(input: {
	approvalId: string;
	organizationId: string;
}) {
	return loadApprovalInboxDecisionTarget(input);
}

export async function decideBotApproval({
	approvalId,
	actorEmployeeId,
	organizationId,
	action,
	platform,
}: BotApprovalAttemptInput) {
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
