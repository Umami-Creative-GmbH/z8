import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
	APPROVAL_PRESENTATION_MODES,
	type ApprovalPresentationMode,
	type ApprovalPresentationProvider,
	approvalInvocation,
	approvalPresentationControl,
} from "@/db/schema";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalWorkflowType } from "../workflow/ports";
import { ApprovalEvidenceError } from "./errors";

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
	action: "approve" | "reject";
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
 * missing row are always review-only. Preparation reads it; the decision never
 * trusts it (the bound decision is revalidated under the rollout lock).
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

export interface ApprovalInvocationRecord {
	id: string;
	identity: ApprovalInvocationIdentity;
	deliveryId: string | null;
	command: ApprovalInvocationCommand;
	commandFingerprint: string;
	workflowId: string;
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
	if (
		row.organizationId !== parsed.organizationId ||
		row.schemeVersion !== parsed.schemeVersion ||
		(row.action !== "approve" && row.action !== "reject")
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
		workflowId: row.workflowId,
		receiptIdempotencyKey: row.receiptIdempotencyKey,
		decisionEvidenceId: row.decisionEvidenceId,
	};
}

/** Written by the decision owner in the transaction that commits the decision. */
export async function recordApprovalInvocation(
	database: ApprovalDatabase,
	input: {
		identity: ApprovalInvocationIdentity;
		deliveryId: string | null;
		command: ApprovalInvocationCommand;
		workflowId: string;
		receiptIdempotencyKey: string;
		decisionEvidenceId: string;
	},
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
			workflowId: input.workflowId,
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
