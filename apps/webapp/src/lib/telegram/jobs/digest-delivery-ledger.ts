import { sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import type {
	ChatNotificationDispatchFailureClassification,
	ChatNotificationDispatchRedactedDiagnostics,
} from "@/db/schema";
import {
	type DurableDispatchAttemptRow,
	type DurableDispatchRuntimeDeps,
	markDurableDispatchConfirmedUnsent,
	markDurableDispatchProviderCalled,
	markDurableDispatchSent,
	markDurableDispatchUncertain,
	recordDurableDispatchIntent,
} from "@/lib/chat-installations/durable-dispatch";

export interface TelegramDigestDeliveryKey {
	organizationId: string;
	recipientEmployeeId: string;
	recipientUserId: string;
	logicalDate: string;
}

export interface TelegramDigestDispatchTarget {
	installationId?: string | null;
	credentialRevisionId?: string | null;
	dispatchAttemptId?: string | null;
}

const platform = "telegram";
const digestType = "daily";

export function buildTelegramDigestDedupeKey(key: TelegramDigestDeliveryKey): string {
	return `telegram-digest:${key.recipientEmployeeId}:${key.recipientUserId}:${key.logicalDate}`;
}

/**
 * Claims a delivery in one database statement. Only a new row or a prior
 * failed attempt can transition to sending, so overlapping workers cannot
 * send the same recipient-local digest twice.
 */
export async function claimTelegramDigestDelivery(
	key: TelegramDigestDeliveryKey,
	target?: TelegramDigestDispatchTarget,
	deps?: Pick<DurableDispatchRuntimeDeps, "db">,
): Promise<boolean> {
	const db = deps?.db ?? defaultDb;
	const installationId = target?.installationId ?? null;
	const credentialRevisionId = target?.credentialRevisionId ?? null;
	const dispatchAttemptId = target?.dispatchAttemptId ?? null;

	const result = await db.execute(sql`
		INSERT INTO "telegram_digest_delivery" (
			"organization_id", "recipient_employee_id", "recipient_user_id", "platform", "digest_type", "logical_date", "installation_id", "credential_revision_id", "dispatch_attempt_id", "status", "attempted_at", "created_at", "updated_at"
		) VALUES (
			${key.organizationId}, ${key.recipientEmployeeId}, ${key.recipientUserId}, ${platform}, ${digestType}, ${key.logicalDate}, ${installationId}, ${credentialRevisionId}, ${dispatchAttemptId}, 'sending', NOW(), NOW(), NOW()
		)
		ON CONFLICT ("organization_id", "recipient_employee_id", "recipient_user_id", "platform", "digest_type", "logical_date")
		DO UPDATE SET
			"status" = 'sending',
			"installation_id" = COALESCE(${installationId}, "telegram_digest_delivery"."installation_id"),
			"credential_revision_id" = COALESCE(${credentialRevisionId}, "telegram_digest_delivery"."credential_revision_id"),
			"dispatch_attempt_id" = COALESCE(${dispatchAttemptId}, "telegram_digest_delivery"."dispatch_attempt_id"),
			"attempted_at" = NOW(),
			"failed_at" = NULL,
			"updated_at" = NOW()
		WHERE "telegram_digest_delivery"."status" = 'failed'
		RETURNING "id"
	`);

	return result.rows.length === 1;
}

export async function markTelegramDigestDeliverySent(
	key: TelegramDigestDeliveryKey,
	deps?: Pick<DurableDispatchRuntimeDeps, "db">,
): Promise<void> {
	const db = deps?.db ?? defaultDb;
	await db.execute(sql`
		UPDATE "telegram_digest_delivery"
		SET "status" = 'sent', "sent_at" = NOW(), "updated_at" = NOW()
		WHERE "organization_id" = ${key.organizationId}
			AND "recipient_employee_id" = ${key.recipientEmployeeId}
			AND "recipient_user_id" = ${key.recipientUserId}
			AND "platform" = ${platform}
			AND "digest_type" = ${digestType}
			AND "logical_date" = ${key.logicalDate}
			AND "status" = 'sending'
	`);
}

export async function markTelegramDigestDeliveryFailed(
	key: TelegramDigestDeliveryKey,
	deps?: Pick<DurableDispatchRuntimeDeps, "db">,
): Promise<void> {
	const db = deps?.db ?? defaultDb;
	await db.execute(sql`
		UPDATE "telegram_digest_delivery"
		SET "status" = 'failed', "failed_at" = NOW(), "updated_at" = NOW()
		WHERE "organization_id" = ${key.organizationId}
			AND "recipient_employee_id" = ${key.recipientEmployeeId}
			AND "recipient_user_id" = ${key.recipientUserId}
			AND "platform" = ${platform}
			AND "digest_type" = ${digestType}
			AND "logical_date" = ${key.logicalDate}
			AND "status" = 'sending'
	`);
}

export type BeginTelegramDigestDispatchResult =
	| {
			kind: "proceed";
			attempt: DurableDispatchAttemptRow;
	  }
	| {
			kind: "skip";
			reason: "already_sent" | "closed_unknown" | "already_claimed";
			attempt?: DurableDispatchAttemptRow;
	  }
	| {
			kind: "reconciliation_required";
			attempt: DurableDispatchAttemptRow;
			installationSwitched: boolean;
	  };

/**
 * Integrates `telegram_digest_delivery` with the shared durable dispatch intent guard
 * (`chat_notification_dispatch_attempt`, `sourceKind: "telegram_digest"`):
 * 1) Records dispatch intent (installation + credential revision) BEFORE any Telegram API call.
 * 2) If a previous worker crashed or left an uncertain outcome (even across a bot switch!),
 *    quarantines to `reconciliation_required` and NEVER automatically repeats to the new bot.
 * 3) Confirmed-unsent prior attempts release the dedupe guard and can safely retry.
 */
export async function beginTelegramDigestDispatch(
	key: TelegramDigestDeliveryKey,
	target?: Omit<TelegramDigestDispatchTarget, "dispatchAttemptId">,
	deps?: DurableDispatchRuntimeDeps,
): Promise<BeginTelegramDigestDispatchResult> {
	const dedupeKey = buildTelegramDigestDedupeKey(key);
	const intent = await recordDurableDispatchIntent(
		{
			organizationId: key.organizationId,
			provider: "telegram",
			sourceKind: "telegram_digest",
			sourceRefId: dedupeKey,
			dedupeKey,
			installationId: target?.installationId ?? null,
			credentialRevisionId: target?.credentialRevisionId ?? null,
		},
		deps,
	);

	if (intent.kind === "already_sent") {
		return { kind: "skip", reason: "already_sent", attempt: intent.attempt };
	}

	if (intent.kind === "closed_unknown") {
		return { kind: "skip", reason: "closed_unknown", attempt: intent.attempt };
	}

	if (intent.kind === "reconciliation_required") {
		return {
			kind: "reconciliation_required",
			attempt: intent.attempt,
			installationSwitched: intent.installationSwitched,
		};
	}

	const claimed = await claimTelegramDigestDelivery(
		key,
		{
			installationId: intent.attempt.installationId,
			credentialRevisionId: intent.attempt.credentialRevisionId,
			dispatchAttemptId: intent.attempt.id,
		},
		deps,
	);

	if (!claimed) {
		// Check whether the legacy ledger row is already `sent` vs stuck in `sending`.
		const db = deps?.db ?? defaultDb;
		const existing = await db.execute(sql`
			SELECT "status"
			FROM "telegram_digest_delivery"
			WHERE "organization_id" = ${key.organizationId}
				AND "recipient_employee_id" = ${key.recipientEmployeeId}
				AND "recipient_user_id" = ${key.recipientUserId}
				AND "platform" = ${platform}
				AND "digest_type" = ${digestType}
				AND "logical_date" = ${key.logicalDate}
			LIMIT 1
		`);
		const status = (existing.rows[0] as { status?: string } | undefined)?.status ?? null;
		if (status === "sent") {
			const sentAttempt =
				(await markDurableDispatchSent(
					{
						organizationId: key.organizationId,
						attemptId: intent.attempt.id,
						diagnostics: { reason: "already_sent_in_digest_ledger" },
					},
					deps,
				)) ?? intent.attempt;
			return { kind: "skip", reason: "already_sent", attempt: sentAttempt };
		}

		// Prior row is stuck in `sending` (e.g. legacy crash before switch) -> quarantine without resend!
		const quarantined =
			(await markDurableDispatchUncertain(
				{
					organizationId: key.organizationId,
					attemptId: intent.attempt.id,
					classification: "worker_lost",
					diagnostics: { reason: "telegram_digest_ledger_stuck_sending" },
				},
				deps,
			)) ?? intent.attempt;
		return {
			kind: "reconciliation_required",
			attempt: quarantined,
			installationSwitched: false,
		};
	}

	return { kind: "proceed", attempt: intent.attempt };
}

export async function markTelegramDigestProviderCalled(
	organizationId: string,
	attemptId: string,
	deps?: DurableDispatchRuntimeDeps,
): Promise<void> {
	await markDurableDispatchProviderCalled({ organizationId, attemptId }, deps);
}

export async function completeTelegramDigestDispatchSent(
	key: TelegramDigestDeliveryKey,
	attemptId: string,
	deps?: DurableDispatchRuntimeDeps,
): Promise<void> {
	await markTelegramDigestDeliverySent(key, deps);
	await markDurableDispatchSent({ organizationId: key.organizationId, attemptId }, deps);
}

/**
 * Records a confirmed-unsent digest failure (failed before provider acceptance or deterministic
 * client rejection), releasing both the ledger (`failed`) and durable attempt (`confirmed_unsent`)
 * so a subsequent run can safely retry under existing deduplication.
 */
export async function completeTelegramDigestDispatchConfirmedUnsent(
	key: TelegramDigestDeliveryKey,
	attemptId: string,
	diagnostics?: ChatNotificationDispatchRedactedDiagnostics,
	deps?: DurableDispatchRuntimeDeps,
): Promise<void> {
	await markTelegramDigestDeliveryFailed(key, deps);
	await markDurableDispatchConfirmedUnsent(
		{
			organizationId: key.organizationId,
			attemptId,
			diagnostics,
		},
		deps,
	);
}

/**
 * Records an uncertain digest send outcome (timeout, network error, 5xx, or lost worker).
 * Leaves `telegram_digest_delivery.status = 'sending'` AND marks the durable dispatch attempt
 * `reconciliation_required` so it is NEVER automatically resent to a new bot after switch,
 * and closes explicitly as `closed_unknown` after 7 days.
 */
export async function completeTelegramDigestDispatchUncertain(
	key: TelegramDigestDeliveryKey,
	attemptId: string,
	options?: {
		classification?: Exclude<ChatNotificationDispatchFailureClassification, "confirmed_unsent">;
		diagnostics?: ChatNotificationDispatchRedactedDiagnostics;
	},
	deps?: DurableDispatchRuntimeDeps,
): Promise<void> {
	await markDurableDispatchUncertain(
		{
			organizationId: key.organizationId,
			attemptId,
			classification: options?.classification ?? "ambiguous",
			diagnostics: options?.diagnostics,
		},
		deps,
	);
}
