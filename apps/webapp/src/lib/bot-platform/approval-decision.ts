import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { approvalRequest, employee } from "@/db/schema";
import { loadApprovalInboxDecisionTarget } from "@/lib/approvals/inbox/decision-service";
import { decideOrdinaryWorkPeriodWithStableTargetEffect } from "@/lib/approvals/server/work-period-approvals";
import {
	DatabaseService,
	DatabaseServiceLive,
} from "@/lib/effect/services/database.service";
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
	| { status: "unauthorized" }
	| { status: "review_required" }
	| { status: "historical"; action: "approve" | "reject" };

/**
 * All existing cards are unbound. Preserve supported historical semantic replay
 * under the existing ordinary-work owner, with a transaction-time no-mutation
 * guard. A fresh invocation never obtains authority from an old card.
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
	const actor = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, input.actorEmployeeId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.isActive, true),
		),
		with: { user: true },
	});
	if (!actor || approval.approverId !== actor.id)
		return { status: "unauthorized" };
	const membership = await db.query.member.findFirst({
		where: and(
			eq(member.userId, actor.userId),
			eq(member.organizationId, input.organizationId),
		),
		columns: { id: true },
	});
	if (!membership) return { status: "unauthorized" };
	const target = await loadApprovalInboxDecisionTarget(input);
	if (target.approverId !== actor.id) return { status: "unauthorized" };
	if (
		target.entityType !== "time_entry" ||
		(target.workflowKind !== "manual_time_submission" &&
			target.workflowKind !== "policy_clock_out")
	)
		return { status: "review_required" };
	// No first-read source facts are handed to rendering. The owner reloads the
	// exact target and verifies committed matching; it cannot fall through to a
	// fresh decision even if discovery raced with reassignment or source edits.
	const verified = await Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* DatabaseService;
			return yield* decideOrdinaryWorkPeriodWithStableTargetEffect(
				service,
				actor,
				{
					approvalRequestId: target.id,
					workPeriodId: target.entityId,
					historicalOnly: true,
					decision:
						input.action === "approve"
							? { kind: "approve", reason: null }
							: {
									kind: "reject",
									reason: `Rejected via ${platformNames[input.platform]}`,
								},
				},
			).pipe(Effect.either);
		}).pipe(Effect.provide(DatabaseServiceLive)),
	);
	return verified._tag === "Right"
		? { status: "historical", action: input.action }
		: { status: "review_required" };
}
