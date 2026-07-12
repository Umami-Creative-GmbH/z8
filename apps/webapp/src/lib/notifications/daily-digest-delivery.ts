import { sql } from "drizzle-orm";
import { db } from "@/db";

interface DailyDigestDeliveryKey {
	organizationId: string;
	recipientUserId: string;
	platform: string;
	type: string;
	recipientLocalDate: string;
}

interface DailyDigestDeliveryReference {
	id: string;
	organizationId: string;
}

/**
 * Claims a recipient's digest delivery. Failed deliveries are deliberately
 * reclaimable, while in-progress and sent deliveries remain exclusive.
 */
export async function claimDailyDigestDelivery(
	key: DailyDigestDeliveryKey,
): Promise<string | null> {
	const result = await db.execute<{ id: string }>(sql`
		INSERT INTO daily_digest_delivery (
			organization_id, recipient_user_id, platform, type, recipient_local_date, status, attempt_count
		) VALUES (
			${key.organizationId}, ${key.recipientUserId}, ${key.platform}, ${key.type}, ${key.recipientLocalDate}, 'processing', 1
		)
		ON CONFLICT (organization_id, recipient_user_id, platform, type, recipient_local_date)
		DO UPDATE SET
			status = 'processing',
			attempt_count = daily_digest_delivery.attempt_count + 1,
			last_error = NULL,
			attempted_at = now()
		WHERE daily_digest_delivery.status = 'failed'
		RETURNING id
	`);

	return result.rows[0]?.id ?? null;
}

export async function markDailyDigestDeliverySent(
	reference: DailyDigestDeliveryReference,
): Promise<void> {
	await db.execute(sql`
		UPDATE daily_digest_delivery
		SET status = 'sent', sent_at = now(), last_error = NULL
		WHERE id = ${reference.id}
			AND organization_id = ${reference.organizationId}
			AND status = 'processing'
	`);
}

export async function markDailyDigestDeliveryFailed(
	reference: DailyDigestDeliveryReference,
	error?: unknown,
): Promise<void> {
	const message = error instanceof Error ? error.message : error ? String(error) : null;
	await db.execute(sql`
		UPDATE daily_digest_delivery
		SET status = 'failed', last_error = ${message}
		WHERE id = ${reference.id}
			AND organization_id = ${reference.organizationId}
			AND status = 'processing'
	`);
}
