/**
 * Push Notification Service
 *
 * Server-side service for sending push notifications using web-push.
 * Requires VAPID keys to be configured in environment variables.
 */

import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { pushSubscription } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { NotificationType } from "./types";

const logger = createLogger("PushService");

// Configure web-push with VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:support@example.com";

let isConfigured = false;

function configureWebPush() {
	if (isConfigured) return true;

	if (!vapidPublicKey || !vapidPrivateKey) {
		logger.warn("VAPID keys not configured. Push notifications will be disabled.");
		return false;
	}

	try {
		webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
		isConfigured = true;
		logger.info("Web push configured successfully");
		return true;
	} catch (error) {
		logger.error({ error }, "Failed to configure web push");
		return false;
	}
}

/**
 * Get the VAPID public key for client-side subscription
 */
export function getVapidPublicKey(): string | null {
	return vapidPublicKey || null;
}

/**
 * Check if push notifications are available (VAPID keys configured)
 */
export function isPushAvailable(): boolean {
	return Boolean(vapidPublicKey && vapidPrivateKey);
}

/**
 * Push notification payload
 */
export interface PushPayload {
	title: string;
	body: string;
	icon?: string;
	badge?: string;
	tag?: string;
	data?: {
		notificationId?: string;
		type?: NotificationType;
		actionUrl?: string;
		url?: string;
		actions?: Array<{
			action: string;
			title: string;
			url?: string;
		}>;
		requireInteraction?: boolean;
		silent?: boolean;
	};
}

/**
 * Send a push notification to a specific subscription
 */
export async function sendPushNotification(
	subscription: {
		endpoint: string;
		p256dh: string;
		auth: string;
	},
	payload: PushPayload,
): Promise<{ success: boolean; error?: string }> {
	if (!configureWebPush()) {
		return { success: false, error: "Push notifications not configured" };
	}

	const pushSubscription = {
		endpoint: subscription.endpoint,
		keys: {
			p256dh: subscription.p256dh,
			auth: subscription.auth,
		},
	};

	try {
		await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
		logger.debug({ endpoint: subscription.endpoint.slice(0, 50) }, "Push notification sent");
		return { success: true };
	} catch (error: unknown) {
		// Handle specific web-push errors
		const webPushError = error as { statusCode?: number; message?: string };
		if (webPushError.statusCode === 410 || webPushError.statusCode === 404) {
			// Subscription has expired or is invalid
			logger.info({ endpoint: subscription.endpoint.slice(0, 50) }, "Push subscription expired");
			return { success: false, error: "subscription_expired" };
		}

		logger.error(
			{ error, statusCode: webPushError.statusCode },
			"Failed to send push notification",
		);
		return { success: false, error: webPushError.message || "Unknown error" };
	}
}

/**
 * Send push notification to all active subscriptions for a user
 */
export async function sendPushToUser(
	userId: string,
	payload: PushPayload,
): Promise<{ sent: number; failed: number; expired: string[] }> {
	if (!configureWebPush()) {
		return { sent: 0, failed: 0, expired: [] };
	}

	try {
		// Get all active subscriptions for the user
		const subscriptions = await db.query.pushSubscription.findMany({
			where: and(eq(pushSubscription.userId, userId), eq(pushSubscription.isActive, true)),
		});

		if (subscriptions.length === 0) {
			logger.debug({ userId }, "No active push subscriptions for user");
			return { sent: 0, failed: 0, expired: [] };
		}

		let sent = 0;
		let failed = 0;
		const expired: string[] = [];

		// Send to all subscriptions in parallel
		const results = await Promise.allSettled(
			subscriptions.map(async (sub) => {
				const result = await sendPushNotification(
					{
						endpoint: sub.endpoint,
						p256dh: sub.p256dh,
						auth: sub.auth,
					},
					payload,
				);

				if (result.success) {
					// Update last used timestamp
					await db
						.update(pushSubscription)
						.set({ lastUsedAt: new Date() })
						.where(eq(pushSubscription.id, sub.id));
					return { success: true, id: sub.id };
				}

				if (result.error === "subscription_expired") {
					// Mark subscription as inactive
					await db
						.update(pushSubscription)
						.set({ isActive: false })
						.where(eq(pushSubscription.id, sub.id));
					return { success: false, expired: true, id: sub.id };
				}

				return { success: false, expired: false, id: sub.id };
			}),
		);

		for (const result of results) {
			if (result.status === "fulfilled") {
				if (result.value.success) {
					sent++;
				} else if (result.value.expired) {
					expired.push(result.value.id);
				} else {
					failed++;
				}
			} else {
				failed++;
			}
		}

		logger.info(
			{ userId, sent, failed, expired: expired.length },
			"Push notifications sent to user",
		);

		return { sent, failed, expired };
	} catch (error) {
		logger.error({ error, userId }, "Failed to send push notifications to user");
		return { sent: 0, failed: 0, expired: [] };
	}
}

/**
 * Save a new push subscription for a user
 */
export async function savePushSubscription(
	userId: string,
	subscription: {
		endpoint: string;
		keys: {
			p256dh: string;
			auth: string;
		};
	},
	metadata?: {
		userAgent?: string;
		deviceName?: string;
	},
): Promise<{ success: boolean; id?: string; error?: string }> {
	try {
		// Check if this endpoint already exists
		const existing = await db.query.pushSubscription.findFirst({
			where: eq(pushSubscription.endpoint, subscription.endpoint),
		});

		if (existing) {
			// Update existing subscription
			await db
				.update(pushSubscription)
				.set({
					userId, // Update in case user changed
					p256dh: subscription.keys.p256dh,
					auth: subscription.keys.auth,
					isActive: true,
					userAgent: metadata?.userAgent,
					deviceName: metadata?.deviceName,
				})
				.where(eq(pushSubscription.id, existing.id));

			logger.info({ userId, subscriptionId: existing.id }, "Push subscription updated");
			return { success: true, id: existing.id };
		}

		// Create new subscription
		const [created] = await db
			.insert(pushSubscription)
			.values({
				userId,
				endpoint: subscription.endpoint,
				p256dh: subscription.keys.p256dh,
				auth: subscription.keys.auth,
				userAgent: metadata?.userAgent,
				deviceName: metadata?.deviceName,
				isActive: true,
			})
			.returning();

		logger.info({ userId, subscriptionId: created.id }, "Push subscription created");
		return { success: true, id: created.id };
	} catch (error) {
		logger.error({ error, userId }, "Failed to save push subscription");
		return { success: false, error: "Failed to save subscription" };
	}
}

/**
 * Remove a push subscription
 */
export async function removePushSubscription(
	userId: string,
	endpoint: string,
): Promise<{ success: boolean }> {
	try {
		await db
			.delete(pushSubscription)
			.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));

		logger.info({ userId }, "Push subscription removed");
		return { success: true };
	} catch (error) {
		logger.error({ error, userId }, "Failed to remove push subscription");
		return { success: false };
	}
}

/**
 * Get all push subscriptions for a user
 */
export async function getUserPushSubscriptions(userId: string) {
	try {
		const subscriptions = await db.query.pushSubscription.findMany({
			where: eq(pushSubscription.userId, userId),
			columns: {
				id: true,
				deviceName: true,
				userAgent: true,
				isActive: true,
				lastUsedAt: true,
				createdAt: true,
			},
		});

		return subscriptions;
	} catch (error) {
		logger.error({ error, userId }, "Failed to get user push subscriptions");
		return [];
	}
}

/**
 * Deactivate a specific push subscription
 */
export async function deactivatePushSubscription(
	userId: string,
	subscriptionId: string,
): Promise<{ success: boolean }> {
	try {
		await db
			.update(pushSubscription)
			.set({ isActive: false })
			.where(and(eq(pushSubscription.id, subscriptionId), eq(pushSubscription.userId, userId)));

		logger.info({ userId, subscriptionId }, "Push subscription deactivated");
		return { success: true };
	} catch (error) {
		logger.error({ error, userId, subscriptionId }, "Failed to deactivate push subscription");
		return { success: false };
	}
}
