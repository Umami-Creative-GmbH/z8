/**
 * Native push through Firebase Cloud Messaging (#843).
 *
 * One more delivery channel under the same "push" preference as web push:
 * `sendPushToUser()` calls `sendNativePushToUser()` next to web push. Device
 * tokens are user-scoped; the organization comes with each notification.
 * Each token is bound to the session that registered it, and pushes go only
 * to tokens whose session is still live, so a sign-out on the server (revoked,
 * expired or ended by an admin) stops pushes to that device.
 * Without FCM credentials every function here is a no-op.
 */

import { and, eq, gt } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { session } from "@/db/auth-schema";
import { type PushDevicePlatform, pushDeviceToken } from "@/db/schema";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { createFcmSender, type FcmSender, readFcmCredentials } from "./fcm-client";
import { buildNativePushMessage, type NativePushInput } from "./native-push-message";
import { recipientNotificationTranslator } from "./outbound-localization";
import { NOTHING_SENT, type PushDeliveryResult } from "./push-delivery";

const logger = createLogger("NativePushService");

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

/** Active device tokens of the user whose registering session is still live. */
function findDeliverableDevices(userId: string) {
	const now = new Date(Temporal.Now.instant().epochMilliseconds);
	return db
		.select({ id: pushDeviceToken.id, token: pushDeviceToken.token })
		.from(pushDeviceToken)
		.innerJoin(session, eq(session.id, pushDeviceToken.sessionId))
		.where(
			and(
				eq(pushDeviceToken.userId, userId),
				eq(pushDeviceToken.isActive, true),
				eq(session.userId, userId),
				gt(session.expiresAt, now),
			),
		);
}

/** Send one content-free message to every deliverable device token of the user. */
export async function sendNativePushToUser(
	userId: string,
	input: NativePushInput,
	options: { throwOnError?: boolean } = {},
): Promise<PushDeliveryResult> {
	const fcm = getSender();
	if (!fcm) return NOTHING_SENT;

	try {
		const devices = await findDeliverableDevices(userId);
		if (devices.length === 0) return NOTHING_SENT;

		const message = buildNativePushMessage(
			input,
			await recipientNotificationTranslator({ userId, organizationId: input.organizationId }),
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
 * Save the device token for the signed-in user and bind it to the current
 * session. A token is one device: when another user registers it (a shared
 * phone after a missed sign-out), the token moves to that user and session,
 * so the previous user's pushes stop.
 */
export async function registerNativePushToken(
	owner: { userId: string; sessionId: string },
	device: { token: string; platform: PushDevicePlatform },
): Promise<void> {
	const now = new Date();
	const binding = {
		userId: owner.userId,
		sessionId: owner.sessionId,
		platform: device.platform,
		isActive: true,
		lastSeenAt: now,
	};
	await db
		.insert(pushDeviceToken)
		.values({ ...binding, token: device.token })
		.onConflictDoUpdate({ target: pushDeviceToken.token, set: binding });
}

/** Remove the device token of the signed-in user, for sign-out or opting out. */
export async function removeNativePushToken(userId: string, token: string): Promise<void> {
	await db
		.delete(pushDeviceToken)
		.where(and(eq(pushDeviceToken.userId, userId), eq(pushDeviceToken.token, token)));
}
