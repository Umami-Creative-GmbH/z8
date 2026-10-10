/**
 * Native push through Firebase Cloud Messaging (#843).
 *
 * One more delivery channel under the same "push" preference as web push:
 * `sendPushToUser()` calls `sendNativePushToUser()` next to web push. Device
 * tokens are user-scoped; the organization comes with each notification.
 * Without FCM credentials every function here is a no-op.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { type PushDevicePlatform, pushDeviceToken } from "@/db/schema";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { loadNamespaces, TolgeeBase } from "@/tolgee/shared";
import { createFcmSender, type FcmSender, readFcmCredentials } from "./fcm-client";
import {
	buildNativePushMessage,
	type NativePushInput,
	type NativePushTranslate,
} from "./native-push-message";
import { resolveRecipientNotificationLocale } from "./recipient-locale";

const logger = createLogger("NativePushService");

export interface PushDeliveryResult {
	sent: number;
	failed: number;
	/** Ids of subscriptions or device tokens that were deactivated as dead. */
	expired: string[];
}

const NOTHING_SENT: PushDeliveryResult = { sent: 0, failed: 0, expired: [] };

let sender: FcmSender | null | undefined;

function getSender(): FcmSender | null {
	if (sender === undefined) {
		const credentials = readFcmCredentials(env);
		sender = credentials ? createFcmSender(credentials) : null;
	}
	return sender;
}

/** Whether FCM credentials are configured for this deployment. */
export function isNativePushAvailable(): boolean {
	return readFcmCredentials(env) !== null;
}

async function recipientTranslator(
	userId: string,
	organizationId: string | null | undefined,
): Promise<NativePushTranslate> {
	try {
		const locale = await resolveRecipientNotificationLocale({ userId, organizationId });
		const tolgee = TolgeeBase().init({
			language: locale,
			staticData: await loadNamespaces(locale, ["common"]),
		});
		await tolgee.run();
		return (key, defaultValue) => tolgee.t({ key, defaultValue });
	} catch (error) {
		logger.warn({ err: error, userId }, "Falling back to default native push text");
		return (_key, defaultValue) => defaultValue;
	}
}

/** Send one content-free message to every active device token of the user. */
export async function sendNativePushToUser(
	userId: string,
	input: NativePushInput,
	options: { throwOnError?: boolean } = {},
): Promise<PushDeliveryResult> {
	const fcm = getSender();
	if (!fcm) return NOTHING_SENT;

	try {
		const devices = await db.query.pushDeviceToken.findMany({
			where: and(eq(pushDeviceToken.userId, userId), eq(pushDeviceToken.isActive, true)),
			columns: { id: true, token: true },
		});
		if (devices.length === 0) return NOTHING_SENT;

		const message = buildNativePushMessage(
			input,
			await recipientTranslator(userId, input.organizationId),
		);
		const results = await Promise.all(
			devices.map(async (device) => {
				const result = await fcm.send(device.token, message);
				if (result.kind === "sent") {
					await db
						.update(pushDeviceToken)
						.set({ lastUsedAt: new Date() })
						.where(eq(pushDeviceToken.id, device.id));
				} else if (result.kind === "invalid_token") {
					await db
						.update(pushDeviceToken)
						.set({ isActive: false })
						.where(eq(pushDeviceToken.id, device.id));
				} else {
					logger.warn(
						{ userId, status: result.status, error: result.error },
						"Native push delivery failed",
					);
				}
				return { id: device.id, kind: result.kind };
			}),
		);

		const delivery: PushDeliveryResult = {
			sent: results.filter((r) => r.kind === "sent").length,
			failed: results.filter((r) => r.kind === "failed").length,
			expired: results.filter((r) => r.kind === "invalid_token").map((r) => r.id),
		};
		logger.info(
			{ userId, sent: delivery.sent, failed: delivery.failed, expired: delivery.expired.length },
			"Native push sent to user",
		);
		return delivery;
	} catch (error) {
		logger.error({ err: error, userId }, "Failed to send native push to user");
		if (options.throwOnError) throw error;
		return NOTHING_SENT;
	}
}

/**
 * Save the device token for the signed-in user. A token is one device: when
 * another user registers it (a shared phone after a missed sign-out), the
 * token moves to that user, so the previous user's pushes stop.
 */
export async function registerNativePushToken(
	userId: string,
	device: { token: string; platform: PushDevicePlatform },
): Promise<void> {
	const now = new Date();
	await db
		.insert(pushDeviceToken)
		.values({
			userId,
			token: device.token,
			platform: device.platform,
			isActive: true,
			lastSeenAt: now,
		})
		.onConflictDoUpdate({
			target: pushDeviceToken.token,
			set: { userId, platform: device.platform, isActive: true, lastSeenAt: now },
		});
}

/** Remove the device token of the signed-in user, for sign-out or opting out. */
export async function removeNativePushToken(userId: string, token: string): Promise<void> {
	await db
		.delete(pushDeviceToken)
		.where(and(eq(pushDeviceToken.userId, userId), eq(pushDeviceToken.token, token)));
}
