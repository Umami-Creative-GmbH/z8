import { ApprovalEvidenceError } from "../evidence/errors";
import {
	type ApprovalInvocationCommand,
	type ApprovalInvocationIdentity,
	ApprovalInvocationNotAdmittedError,
	approvalInvocationIdempotencyKey,
	approvalInvocationProvider,
	findCommittedInvocationDecision,
	lockApprovalInvocation,
	readApprovalPresentationMode,
	recordApprovalInvocation,
	requireLegacyInvocationDecision,
} from "../evidence/invocation";
import {
	type LegacyDecisionEvidenceRecord,
	type LegacyReviewBindingRecord,
	loadLegacyReviewBinding,
} from "../evidence/store";
import { TRAVEL_EXPENSE_REPORT_ACTIONABLE_PROVIDERS } from "../evidence/travel-expense-report-cards";
import type { ApprovalAction, ApprovalDatabase, CurrentApprover } from "./types";

/**
 * Bound card actions of the expense report decision owner (#623), mirroring
 * the expense claim owner (#296): the invocation is locked and an exact
 * committed one replays before any fresh check; a fresh one needs current
 * provider admission; the binding names the exact legacy request and frozen
 * revision the recipient reviewed; the invocation is recorded in the decision
 * transaction with its evidence.
 */

/** A bound card action: the reviewed binding and its provider invocation. */
export interface TravelExpenseReportBoundInvocation {
	bindingId: string;
	identity: ApprovalInvocationIdentity;
	/** Transport delivery identity (e.g. Telegram update_id); not identity. */
	deliveryId: string | null;
	providerActorId: string;
}

export type BoundReportInvocationStart =
	| { kind: "replayed"; evidence: LegacyDecisionEvidenceRecord }
	| { kind: "fresh"; key: string; command: ApprovalInvocationCommand };

export function boundReportInvocationCommand(input: {
	actor: Pick<CurrentApprover, "id" | "userId">;
	action: ApprovalAction;
	reason: string | undefined;
	bound: Pick<TravelExpenseReportBoundInvocation, "bindingId" | "providerActorId">;
}): ApprovalInvocationCommand {
	return {
		actorEmployeeId: input.actor.id,
		actorUserId: input.actor.userId,
		providerActorId: input.bound.providerActorId,
		reviewedBindingId: input.bound.bindingId,
		action: input.action,
		reason: input.reason ?? null,
	};
}

/**
 * Under the caller's rollout gate: locks the invocation, replays an exact
 * committed one, and otherwise admits a fresh one only for a report-admitted
 * provider whose presentation is actionable now (pausing stops sent cards).
 */
export async function beginBoundReportInvocation(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		actor: Pick<CurrentApprover, "id" | "userId">;
		action: ApprovalAction;
		reason: string | undefined;
		bound: TravelExpenseReportBoundInvocation;
	},
): Promise<BoundReportInvocationStart> {
	const { identity } = input.bound;
	if (identity.organizationId !== input.organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation" });
	}
	const command = boundReportInvocationCommand(input);
	await lockApprovalInvocation(database, identity);
	const committed = await findCommittedInvocationDecision(database, { identity, command });
	if (committed) return { kind: "replayed", evidence: requireLegacyInvocationDecision(committed) };
	const provider = approvalInvocationProvider(identity.scheme);
	if (!TRAVEL_EXPENSE_REPORT_ACTIONABLE_PROVIDERS.includes(provider)) {
		throw new ApprovalInvocationNotAdmittedError();
	}
	const presentationMode = await readApprovalPresentationMode(database, {
		organizationId: input.organizationId,
		workflowType: "travel_expense",
		provider,
	});
	if (presentationMode !== "actionable") throw new ApprovalInvocationNotAdmittedError();
	return { kind: "fresh", key: approvalInvocationIdempotencyKey(identity), command };
}

/** The legacy binding of the card, issued to exactly this actor. */
export async function loadBoundReportBinding(
	database: ApprovalDatabase,
	input: { organizationId: string; bindingId: string; actorEmployeeId: string },
): Promise<LegacyReviewBindingRecord> {
	const binding = await loadLegacyReviewBinding(database, {
		organizationId: input.organizationId,
		bindingId: input.bindingId,
	});
	if (!binding || binding.recipientEmployeeId !== input.actorEmployeeId) {
		throw new ApprovalEvidenceError("binding_mismatch");
	}
	return binding;
}

/** Associates the fresh invocation with its decision, in the decision transaction. */
export async function recordBoundReportInvocation(
	database: ApprovalDatabase,
	input: {
		bound: TravelExpenseReportBoundInvocation;
		invocation: Extract<BoundReportInvocationStart, { kind: "fresh" }>;
		approvalRequestId: string;
		decisionEvidenceId: string;
	},
): Promise<void> {
	await recordApprovalInvocation(database, {
		identity: input.bound.identity,
		deliveryId: input.bound.deliveryId,
		command: input.invocation.command,
		legacyApprovalRequestId: input.approvalRequestId,
		receiptIdempotencyKey: input.invocation.key,
		decisionEvidenceId: input.decisionEvidenceId,
	});
}
