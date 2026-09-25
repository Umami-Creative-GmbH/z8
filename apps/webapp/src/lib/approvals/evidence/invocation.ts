import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
	APPROVAL_PRESENTATION_MODES,
	type ApprovalPresentationMode,
	type ApprovalPresentationProvider,
	approvalInvocation,
	approvalPresentationControl,
} from "@/db/schema";
import type { ApprovalAction, ApprovalDatabase } from "../server/types";
import type { ApprovalWorkflowType } from "../workflow/ports";
import { ApprovalEvidenceError } from "./errors";
import {
	type DecisionEvidenceRecord,
	findDecisionEvidenceById,
	findLegacyDecisionEvidenceById,
	type LegacyDecisionEvidenceRecord,
} from "./store";

/**
 * Provider invocation identity (#257 §7, #261). Only schemes whose provider
 * documents a per-invocation identity are representable. Slack block actions
 * and callbacks without a trustworthy ID stay review-only: nothing here
 * substitutes card IDs, nonces, timestamps or receive-time UUIDs.
 */
export const APPROVAL_INVOCATION_SCHEMES = ["telegram_callback_query"] as const;
export type ApprovalInvocationScheme =
	(typeof APPROVAL_INVOCATION_SCHEMES)[number];

export const APPROVAL_INVOCATION_SCHEME_VERSION = 1;

const SCHEME_PROVIDERS: Readonly<
	Record<ApprovalInvocationScheme, ApprovalPresentationProvider>
> = { telegram_callback_query: "telegram" };

/** The provider whose card admission governs invocations of this scheme. */
export function approvalInvocationProvider(
	scheme: ApprovalInvocationScheme,
): ApprovalPresentationProvider {
	return SCHEME_PROVIDERS[scheme];
}

/**
 * A fresh invocation arrived while its provider's card admission is not
 * actionable (never admitted, or paused after cards were sent). Committed
 * invocations still replay; nothing new is decided.
 */
export class ApprovalInvocationNotAdmittedError extends Error {
	constructor() {
		super("Approval card actions are not admitted for this provider");
		this.name = "ApprovalInvocationNotAdmittedError";
	}
}

export interface ApprovalInvocationIdentity {
	organizationId: string;
	scheme: ApprovalInvocationScheme;
	schemeVersion: typeof APPROVAL_INVOCATION_SCHEME_VERSION;
	/** Authenticated receiver, e.g. `telegram-bot:<bot user id>`. */
	receiverScope: string;
	/** Exact provider invocation ID, kept opaque. */
	invocationId: string;
}

/** The command a bound invocation carries, separate from provider identity. */
export interface ApprovalInvocationCommand {
	actorEmployeeId: string;
	actorUserId: string;
	/** Provider-authenticated actor (e.g. Telegram `from.id`), kept opaque. */
	providerActorId: string;
	reviewedBindingId: string;
	action: ApprovalAction;
	reason: string | null;
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function parseApprovalInvocationIdentity(
	value: unknown,
): ApprovalInvocationIdentity {
	const record =
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	if (
		!nonEmpty(record.organizationId) ||
		!APPROVAL_INVOCATION_SCHEMES.includes(
			record.scheme as ApprovalInvocationScheme,
		) ||
		record.schemeVersion !== APPROVAL_INVOCATION_SCHEME_VERSION ||
		!nonEmpty(record.receiverScope) ||
		!nonEmpty(record.invocationId)
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "invocation_identity",
		});
	}
	return {
		organizationId: record.organizationId,
		scheme: record.scheme as ApprovalInvocationScheme,
		schemeVersion: APPROVAL_INVOCATION_SCHEME_VERSION,
		receiverScope: record.receiverScope,
		invocationId: record.invocationId,
	};
}

function lengthPrefixed(value: string): string {
	return `${value.length}:${value}`;
}

/**
 * Engine receipt key for one provider invocation. It never contains semantic
 * command fields, so a fresh invocation can never match an older semantic
 * receipt, and existing semantic keys are left untouched.
 */
export function approvalInvocationIdempotencyKey(
	identity: ApprovalInvocationIdentity,
): string {
	const parsed = parseApprovalInvocationIdentity(identity);
	return [
		`approval-invocation:v${parsed.schemeVersion}`,
		parsed.scheme,
		lengthPrefixed(parsed.receiverScope),
		lengthPrefixed(parsed.invocationId),
	].join(":");
}

/** Versioned association fingerprint; old semantic formats are not changed. */
export function fingerprintApprovalInvocationCommand(
	command: ApprovalInvocationCommand,
): string {
	const canonical = JSON.stringify([
		command.actorEmployeeId,
		command.actorUserId,
		command.providerActorId,
		command.reviewedBindingId,
		command.action,
		command.reason,
	]);
	return `approval-invocation-command:v1:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Actionable card admission for one organization/kind/provider. Slack and a
 * missing row are always review-only. Preparation reads it to admit a card; a
 * fresh bound decision rereads it under the rollout gate, so pausing stops
 * cards that were already sent.
 */
export async function readApprovalPresentationMode(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflowType: ApprovalWorkflowType;
		provider: ApprovalPresentationProvider;
	},
): Promise<ApprovalPresentationMode> {
	if (input.provider === "slack") return "review_only";
	const rows = await database
		.select({ mode: approvalPresentationControl.mode })
		.from(approvalPresentationControl)
		.where(
			and(
				eq(approvalPresentationControl.organizationId, input.organizationId),
				eq(approvalPresentationControl.workflowType, input.workflowType),
				eq(approvalPresentationControl.provider, input.provider),
			),
		)
		.limit(1);
	const mode = rows[0]?.mode ?? "review_only";
	if (!APPROVAL_PRESENTATION_MODES.includes(mode)) {
		throw new ApprovalEvidenceError("invariant", {
			field: "presentation_mode",
		});
	}
	return mode;
}

/**
 * The lifecycle a committed invocation decided: a canonical workflow, or for
 * legacy authority (#296) the exact legacy request, never a workflow.
 */
export type ApprovalInvocationLifecycle =
	| { authority: "canonical"; workflowId: string }
	| { authority: "legacy"; legacyApprovalRequestId: string };

export interface ApprovalInvocationRecord {
	id: string;
	identity: ApprovalInvocationIdentity;
	deliveryId: string | null;
	command: ApprovalInvocationCommand;
	commandFingerprint: string;
	lifecycle: ApprovalInvocationLifecycle;
	receiptIdempotencyKey: string;
	decisionEvidenceId: string;
}

/**
 * Serializes concurrent deliveries of one invocation. Taken after the rollout
 * gate and before authoritative rows (#264 §2 order, operation identity).
 */
export async function lockApprovalInvocation(
	database: ApprovalDatabase,
	identity: ApprovalInvocationIdentity,
): Promise<void> {
	const scope = `approval-invocation:${identity.organizationId.length}:${identity.organizationId}:${approvalInvocationIdempotencyKey(identity)}`;
	await database.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`,
	);
}

export async function findApprovalInvocation(
	database: ApprovalDatabase,
	identity: ApprovalInvocationIdentity,
): Promise<ApprovalInvocationRecord | null> {
	const parsed = parseApprovalInvocationIdentity(identity);
	const rows = await database
		.select()
		.from(approvalInvocation)
		.where(
			and(
				eq(approvalInvocation.organizationId, parsed.organizationId),
				eq(approvalInvocation.scheme, parsed.scheme),
				eq(approvalInvocation.receiverScope, parsed.receiverScope),
				eq(approvalInvocation.invocationId, parsed.invocationId),
			),
		)
		.limit(2);
	if (rows.length > 1) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation" });
	}
	const row = rows[0];
	if (!row) return null;
	const lifecycle: ApprovalInvocationLifecycle | null =
		row.authority === "canonical" && row.workflowId && !row.legacyApprovalRequestId
			? { authority: "canonical", workflowId: row.workflowId }
			: row.authority === "legacy" && !row.workflowId && row.legacyApprovalRequestId
				? {
						authority: "legacy",
						legacyApprovalRequestId: row.legacyApprovalRequestId,
					}
				: null;
	if (
		row.organizationId !== parsed.organizationId ||
		row.schemeVersion !== parsed.schemeVersion ||
		(row.action !== "approve" && row.action !== "reject") ||
		!lifecycle
	) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation" });
	}
	return {
		id: row.id,
		identity: parsed,
		deliveryId: row.deliveryId,
		command: {
			actorEmployeeId: row.actorEmployeeId,
			actorUserId: row.actorUserId,
			providerActorId: row.providerActorId,
			reviewedBindingId: row.reviewedBindingId,
			action: row.action,
			// The reason is never stored; its value is bound by the fingerprint.
			reason: null,
		},
		commandFingerprint: row.commandFingerprint,
		lifecycle,
		receiptIdempotencyKey: row.receiptIdempotencyKey,
		decisionEvidenceId: row.decisionEvidenceId,
	};
}

/**
 * The original decision of a committed invocation, or null when this
 * invocation never committed. The same invocation with a different command
 * (actor, provider actor, binding, action or reason) is a mismatch, never a
 * second operation. Current state is not consulted: a committed result stays
 * replayable after later assignment, revision or source changes.
 */
export async function findCommittedInvocationDecision(
	database: ApprovalDatabase,
	input: {
		identity: ApprovalInvocationIdentity;
		command: ApprovalInvocationCommand;
	},
): Promise<DecisionEvidenceRecord | LegacyDecisionEvidenceRecord | null> {
	const existing = await findApprovalInvocation(database, input.identity);
	if (!existing) return null;
	if (
		existing.commandFingerprint !==
		fingerprintApprovalInvocationCommand(input.command)
	) {
		throw new ApprovalEvidenceError("invocation_mismatch");
	}
	const evidence =
		existing.lifecycle.authority === "canonical"
			? await findDecisionEvidenceById(database, {
					organizationId: input.identity.organizationId,
					workflowId: existing.lifecycle.workflowId,
					id: existing.decisionEvidenceId,
				})
			: await findLegacyDecisionEvidenceById(database, {
					organizationId: input.identity.organizationId,
					id: existing.decisionEvidenceId,
				});
	if (
		!evidence ||
		(existing.lifecycle.authority === "legacy" &&
			(!("authority" in evidence) ||
				evidence.legacy.approvalRequestId !==
					existing.lifecycle.legacyApprovalRequestId))
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "invocation_decision",
		});
	}
	return evidence;
}

/**
 * A canonical decision owner's view of a committed invocation. The command
 * fingerprint includes the binding, whose authority is fixed, so a legacy
 * decision here is an integrity contradiction, never a replay.
 */
export function requireCanonicalInvocationDecision(
	evidence: DecisionEvidenceRecord | LegacyDecisionEvidenceRecord,
): DecisionEvidenceRecord {
	if ("authority" in evidence) {
		throw new ApprovalEvidenceError("invariant", {
			field: "invocation_decision",
		});
	}
	return evidence;
}

/** Written by the decision owner in the transaction that commits the decision. */
export async function recordApprovalInvocation(
	database: ApprovalDatabase,
	input: {
		identity: ApprovalInvocationIdentity;
		deliveryId: string | null;
		command: ApprovalInvocationCommand;
		receiptIdempotencyKey: string;
		decisionEvidenceId: string;
	} & (
		| { workflowId: string; legacyApprovalRequestId?: never }
		| { legacyApprovalRequestId: string; workflowId?: never }
	),
): Promise<{ id: string }> {
	const identity = parseApprovalInvocationIdentity(input.identity);
	if (
		input.receiptIdempotencyKey !== approvalInvocationIdempotencyKey(identity)
	) {
		throw new ApprovalEvidenceError("invariant", {
			field: "invocation_receipt",
		});
	}
	const inserted = await database
		.insert(approvalInvocation)
		.values({
			organizationId: identity.organizationId,
			scheme: identity.scheme,
			schemeVersion: identity.schemeVersion,
			receiverScope: identity.receiverScope,
			invocationId: identity.invocationId,
			deliveryId: input.deliveryId,
			providerActorId: input.command.providerActorId,
			actorEmployeeId: input.command.actorEmployeeId,
			actorUserId: input.command.actorUserId,
			...(input.legacyApprovalRequestId
				? {
						authority: "legacy" as const,
						workflowId: null,
						legacyApprovalRequestId: input.legacyApprovalRequestId,
					}
				: {
						authority: "canonical" as const,
						workflowId: input.workflowId,
						legacyApprovalRequestId: null,
					}),
			reviewedBindingId: input.command.reviewedBindingId,
			action: input.command.action,
			commandFingerprint: fingerprintApprovalInvocationCommand(input.command),
			receiptIdempotencyKey: input.receiptIdempotencyKey,
			decisionEvidenceId: input.decisionEvidenceId,
		})
		.returning({ id: approvalInvocation.id });
	const row = inserted[0];
	if (inserted.length !== 1 || !row) {
		throw new ApprovalEvidenceError("invariant", { field: "invocation" });
	}
	return row;
}
