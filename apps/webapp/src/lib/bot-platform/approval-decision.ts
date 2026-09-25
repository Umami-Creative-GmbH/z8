import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { approvalRequest, employee } from "@/db/schema";
import {
	APPROVAL_INVOCATION_SCHEME_VERSION,
	type ApprovalInvocationScheme,
} from "@/lib/approvals/evidence/invocation";
import {
	type DecisionEvidenceRecord,
	type LegacyDecisionEvidenceRecord,
	loadReviewBindingAuthority,
} from "@/lib/approvals/evidence/store";
import { loadApprovalInboxDecisionTarget } from "@/lib/approvals/inbox/decision-service";
import { decideBoundAbsenceInvocation } from "@/lib/approvals/server/absence-approvals";
import { decideBoundTravelExpenseInvocation } from "@/lib/approvals/server/travel-expense-approvals";
import type { ApprovalAction } from "@/lib/approvals/server/types";
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

/**
 * Provider invocation evidence for a bound card action. Only providers with a
 * documented per-invocation identity supply it (#261); anything missing makes
 * the action review-only.
 */
export interface BotInvocationEnvelope {
	scheme: ApprovalInvocationScheme;
	/**
	 * Authenticated receiver, e.g. `telegram-bot:<bot user id>` or the Teams
	 * bot/tenant/conversation scope of a recorded activity, or
	 * `discord-app:<application id>`.
	 */
	receiverScope: string;
	invocationId: string;
	/** Transport delivery identity (Telegram update_id; none on Discord), kept separately. */
	deliveryId: string | null;
	providerActorId: string;
}

type BoundBotApprovalInput = {
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	/** Opaque reviewed-binding handle carried by the card. */
	bindingId: string;
	action: ApprovalAction;
	platform: BotPlatform;
	invocation: BotInvocationEnvelope | null;
};

export type BoundBotApprovalResult =
	| {
			status: "decided";
			/** This invocation was already committed; the original is returned. */
			replayed: boolean;
			evidence: DecisionEvidenceRecord | LegacyDecisionEvidenceRecord;
	  }
	| { status: "review_required" }
	| { status: "conflict" }
	| { status: "not_found" };

const INVOCATION_SCHEMES: Partial<
	Record<BotPlatform, ApprovalInvocationScheme>
> = {
	telegram: "telegram_callback_query",
	teams: "teams_adaptive_card_action",
	discord: "discord_interaction",
};

/**
 * A bound card action. The binding and invocation cross the shared attempt
 * into the authoritative decision transaction, which validates organization,
 * recipient, cycle, subject, assignment and submitted revision at commit. The
 * provider acknowledgment is the adapter's concern and proves nothing here.
 */
export async function attemptBoundBotApproval(
	input: BoundBotApprovalInput,
): Promise<BoundBotApprovalResult> {
	const scheme = INVOCATION_SCHEMES[input.platform];
	if (!scheme || input.invocation?.scheme !== scheme) {
		// No established invocation identity: never decide, never replay. An
		// incomplete identity is refused by the decision owner's parser.
		return { status: "review_required" };
	}
	const decision = {
		database: db,
		organizationId: input.organizationId,
		actorEmployeeId: input.actorEmployeeId,
		actorUserId: input.actorUserId,
		bindingId: input.bindingId,
		action: input.action,
		...(input.action === "reject"
			? { reason: `Rejected via ${platformNames[input.platform]}` }
			: {}),
		invocation: {
			identity: {
				organizationId: input.organizationId,
				scheme,
				schemeVersion: APPROVAL_INVOCATION_SCHEME_VERSION as typeof APPROVAL_INVOCATION_SCHEME_VERSION,
				receiverScope: input.invocation.receiverScope,
				invocationId: input.invocation.invocationId,
			},
			deliveryId: input.invocation.deliveryId,
			providerActorId: input.invocation.providerActorId,
		},
	};
	// A binding decides only under the authority it was issued for: a legacy
	// handle reaches the legacy expense owner (#296), never a canonical one.
	// Bindings are immutable and outlive their committed invocations, so
	// routing on them keeps exact replays intact.
	const authority = await loadReviewBindingAuthority(db, {
		organizationId: input.organizationId,
		bindingId: input.bindingId,
	});
	const result =
		authority === "legacy"
			? await decideBoundTravelExpenseInvocation(decision)
			: await decideBoundAbsenceInvocation(decision);
	return result.status === "review_required"
		? { status: "review_required" }
		: result;
}
