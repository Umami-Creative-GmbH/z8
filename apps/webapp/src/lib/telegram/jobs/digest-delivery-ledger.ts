import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface TelegramDigestDeliveryKey {
	organizationId: string;
	recipientEmployeeId: string;
	recipientUserId: string;
	logicalDate: string;
}

const platform = "telegram";
const digestType = "daily";

/**
 * Claims a delivery in one database statement. Only a new row or a prior
 * failed attempt can transition to sending, so overlapping workers cannot
 * send the same recipient-local digest twice.
 */
export async function claimTelegramDigestDelivery(
	key: TelegramDigestDeliveryKey,
): Promise<boolean> {
	const result = await db.execute(sql`
		INSERT INTO "telegram_digest_delivery" (
			"organization_id", "recipient_employee_id", "recipient_user_id", "platform", "digest_type", "logical_date", "status", "attempted_at", "created_at", "updated_at"
		) VALUES (
			${key.organizationId}, ${key.recipientEmployeeId}, ${key.recipientUserId}, ${platform}, ${digestType}, ${key.logicalDate}, 'sending', NOW(), NOW(), NOW()
		)
		ON CONFLICT ("organization_id", "recipient_employee_id", "recipient_user_id", "platform", "digest_type", "logical_date")
		DO UPDATE SET "status" = 'sending', "attempted_at" = NOW(), "failed_at" = NULL, "updated_at" = NOW()
		WHERE "telegram_digest_delivery"."status" = 'failed'
		RETURNING "id"
	`);

	return result.rows.length === 1;
}

export async function markTelegramDigestDeliverySent(
	key: TelegramDigestDeliveryKey,
): Promise<void> {
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
): Promise<void> {
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
