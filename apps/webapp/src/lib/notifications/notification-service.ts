/**
 * Notification Service
 *
 * Core service for creating, retrieving, and managing notifications
 */

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notification, notificationPreference } from "@/db/schema";
import { publishEventAsync } from "@/lib/events";
import { createLogger } from "@/lib/logger";
import { publishNotificationEvent } from "@/lib/valkey";
import { sendEmailNotification } from "./email-notifications";
import { isPushAvailable, type PushPayload, sendPushToUser } from "./push-service";
import type {
	CreateNotificationParams,
	Notification,
	NotificationChannel,
	NotificationType,
	NotificationWithMeta,
} from "./types";

const logger = createLogger("NotificationService");

/**
 * Calculate relative time string (e.g., "2 hours ago", "3 days ago")
 */
export function getTimeAgo(date: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffSeconds = Math.floor(diffMs / 1000);
	const diffMinutes = Math.floor(diffSeconds / 60);
	const diffHours = Math.floor(diffMinutes / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffSeconds < 60) {
		return "just now";
	}
	if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
	}
	if (diffHours < 24) {
		return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
	}
	if (diffDays < 7) {
		return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
	}
	if (diffDays < 30) {
		const weeks = Math.floor(diffDays / 7);
		return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
	}
	const months = Math.floor(diffDays / 30);
	return `${months} month${months === 1 ? "" : "s"} ago`;
}

/**
 * Create a new notification
 *
 * This will:
 * 1. Check user preferences for in-app notifications
 * 2. Create the in-app notification if enabled
 * 3. Send a push notification if push is enabled for this notification type
 */
export async function createNotification(
	params: CreateNotificationParams,
): Promise<Notification | null> {
	try {
		// Fetch all relevant preferences for this notification type at once
		const preferences = await db.query.notificationPreference.findMany({
			where: and(
				eq(notificationPreference.userId, params.userId),
				eq(notificationPreference.organizationId, params.organizationId),
				eq(notificationPreference.notificationType, params.type),
			),
		});

		// Check in-app preference
		const inAppPreference = preferences.find((p) => p.channel === "in_app");
		const inAppEnabled = !inAppPreference || inAppPreference.enabled;

		// Check push preference
		const pushPreference = preferences.find((p) => p.channel === "push");
		const pushEnabled = !pushPreference || pushPreference.enabled;

		// Check email preference
		const emailPreference = preferences.find((p) => p.channel === "email");
		const emailEnabled = !emailPreference || emailPreference.enabled;

		let created: Notification | null = null;

		// Create in-app notification if enabled
		if (inAppEnabled) {
			const [inserted] = await db
				.insert(notification)
				.values({
					userId: params.userId,
					organizationId: params.organizationId,
					type: params.type,
					title: params.title,
					message: params.message,
					entityType: params.entityType,
					entityId: params.entityId,
					actionUrl: params.actionUrl,
					metadata: params.metadata ? JSON.stringify(params.metadata) : null,
				})
				.returning();

			created = inserted;

			logger.info(
				{ notificationId: created.id, userId: params.userId, type: params.type },
				"Notification created",
			);

			// Publish to Valkey for real-time SSE updates
			const notifWithMeta = {
				...created,
				timeAgo: getTimeAgo(created.createdAt),
			};
			void publishNotificationEvent(params.userId, "new_notification", notifWithMeta).catch(
				(error) => {
					logger.error({ error, userId: params.userId }, "Failed to publish notification event");
				},
			);
		} else {
			logger.debug(
				{ userId: params.userId, type: params.type },
				"In-app notification skipped due to user preference",
			);
		}

		// Send push notification if enabled and available
		if (pushEnabled && isPushAvailable()) {
			const pushPayload: PushPayload = {
				title: params.title,
				body: params.message,
				icon: "/icons/icon-192x192.png",
				badge: "/icons/badge-72x72.png",
				tag: params.type,
				data: {
					notificationId: created?.id,
					type: params.type,
					actionUrl: params.actionUrl,
					url: params.actionUrl,
				},
			};

			// Fire and forget - don't await to avoid blocking
			void sendPushToUser(params.userId, pushPayload).catch((error) => {
				logger.error(
					{ error, userId: params.userId, type: params.type },
					"Failed to send push notification",
				);
			});
		}

		// Send email notification if enabled
		if (emailEnabled) {
			// Fire and forget - don't await to avoid blocking
			void sendEmailNotification({
				userId: params.userId,
				type: params.type,
				title: params.title,
				message: params.message,
				metadata: params.metadata,
				organizationId: params.organizationId, // Use org-specific email config
			}).catch((error) => {
				logger.error(
					{ error, userId: params.userId, type: params.type },
					"Failed to send email notification",
				);
			});
		}

		// Publish to event bus for webhooks (fire-and-forget)
		// This allows webhooks to receive all notification events
		publishEventAsync(params.type, params.organizationId, {
			notificationId: created?.id,
			userId: params.userId,
			title: params.title,
			message: params.message,
			entityType: params.entityType,
			entityId: params.entityId,
			actionUrl: params.actionUrl,
			metadata: params.metadata,
		});

		return created;
	} catch (error) {
		logger.error({ error, params }, "Failed to create notification");
		return null;
	}
}

/**
 * Get paginated notifications for a user
 */
export async function getUserNotifications(
	userId: string,
	organizationId: string,
	options: {
		limit?: number;
		offset?: number;
		unreadOnly?: boolean;
	} = {},
): Promise<{ notifications: NotificationWithMeta[]; total: number; hasMore: boolean }> {
	const { limit = 20, offset = 0, unreadOnly = false } = options;

	try {
		const conditions = [
			eq(notification.userId, userId),
			eq(notification.organizationId, organizationId),
		];

		if (unreadOnly) {
			conditions.push(eq(notification.isRead, false));
		}

		// Get notifications with pagination
		const notifications = await db
			.select()
			.from(notification)
			.where(and(...conditions))
			.orderBy(desc(notification.createdAt))
			.limit(limit + 1) // Fetch one extra to check if there are more
			.offset(offset);

		// Get total count
		const [{ total }] = await db
			.select({ total: count() })
			.from(notification)
			.where(and(...conditions));

		const hasMore = notifications.length > limit;
		const resultNotifications = hasMore ? notifications.slice(0, limit) : notifications;

		// Add timeAgo to each notification
		const notificationsWithMeta: NotificationWithMeta[] = resultNotifications.map((n) => ({
			...n,
			timeAgo: getTimeAgo(n.createdAt),
		}));

		return {
			notifications: notificationsWithMeta,
			total,
			hasMore,
		};
	} catch (error) {
		logger.error({ error, userId }, "Failed to get user notifications");
		return { notifications: [], total: 0, hasMore: false };
	}
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: string, organizationId: string): Promise<number> {
	try {
		const [result] = await db
			.select({ count: count() })
			.from(notification)
			.where(
				and(
					eq(notification.userId, userId),
					eq(notification.organizationId, organizationId),
					eq(notification.isRead, false),
				),
			);

		return result.count;
	} catch (error) {
		logger.error({ error, userId }, "Failed to get unread count");
		return 0;
	}
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(
	notificationId: string,
	userId: string,
): Promise<Notification | null> {
	try {
		const [updated] = await db
			.update(notification)
			.set({
				isRead: true,
				readAt: new Date(),
			})
			.where(and(eq(notification.id, notificationId), eq(notification.userId, userId)))
			.returning();

		if (updated) {
			logger.debug({ notificationId }, "Notification marked as read");

			// Publish count update to Valkey for real-time SSE updates
			// Get organizationId from the updated notification
			const newCount = await getUnreadCount(userId, updated.organizationId);
			void publishNotificationEvent(userId, "count_update", { count: newCount }).catch((error) => {
				logger.error({ error, userId }, "Failed to publish count update event");
			});
		}

		return updated || null;
	} catch (error) {
		logger.error({ error, notificationId, userId }, "Failed to mark notification as read");
		return null;
	}
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string, organizationId: string): Promise<number> {
	try {
		const result = await db
			.update(notification)
			.set({
				isRead: true,
				readAt: new Date(),
			})
			.where(
				and(
					eq(notification.userId, userId),
					eq(notification.organizationId, organizationId),
					eq(notification.isRead, false),
				),
			)
			.returning({ id: notification.id });

		const updatedCount = result.length;
		logger.info({ userId, updatedCount }, "All notifications marked as read");

		// Publish count update to Valkey for real-time SSE updates (count is now 0)
		if (updatedCount > 0) {
			void publishNotificationEvent(userId, "count_update", { count: 0 }).catch((error) => {
				logger.error({ error, userId }, "Failed to publish count update event");
			});
		}

		return updatedCount;
	} catch (error) {
		logger.error({ error, userId }, "Failed to mark all notifications as read");
		return 0;
	}
}

/**
 * Delete a notification
 */
export async function deleteNotification(notificationId: string, userId: string): Promise<boolean> {
	try {
		const result = await db
			.delete(notification)
			.where(and(eq(notification.id, notificationId), eq(notification.userId, userId)))
			.returning({ id: notification.id });

		const deleted = result.length > 0;
		if (deleted) {
			logger.debug({ notificationId }, "Notification deleted");
		}

		return deleted;
	} catch (error) {
		logger.error({ error, notificationId, userId }, "Failed to delete notification");
		return false;
	}
}

/**
 * Delete all notifications for a user
 */
export async function deleteAllNotifications(
	userId: string,
	organizationId: string,
): Promise<number> {
	try {
		const result = await db
			.delete(notification)
			.where(and(eq(notification.userId, userId), eq(notification.organizationId, organizationId)))
			.returning({ id: notification.id });

		const deletedCount = result.length;
		logger.info({ userId, deletedCount }, "All notifications deleted");

		return deletedCount;
	} catch (error) {
		logger.error({ error, userId }, "Failed to delete all notifications");
		return 0;
	}
}

/**
 * Delete old notifications (cleanup job)
 */
export async function deleteOldNotifications(olderThanDays: number = 90): Promise<number> {
	try {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

		const result = await db
			.delete(notification)
			.where(sql`${notification.createdAt} < ${cutoffDate}`)
			.returning({ id: notification.id });

		const deletedCount = result.length;
		logger.info({ deletedCount, olderThanDays }, "Old notifications cleaned up");

		return deletedCount;
	} catch (error) {
		logger.error({ error, olderThanDays }, "Failed to delete old notifications");
		return 0;
	}
}

/**
 * Check if a user has a specific channel enabled for a notification type
 */
export async function isChannelEnabled(
	userId: string,
	organizationId: string,
	notificationType: NotificationType,
	channel: NotificationChannel,
): Promise<boolean> {
	try {
		const preference = await db.query.notificationPreference.findFirst({
			where: and(
				eq(notificationPreference.userId, userId),
				eq(notificationPreference.organizationId, organizationId),
				eq(notificationPreference.notificationType, notificationType),
				eq(notificationPreference.channel, channel),
			),
		});

		// Default to enabled if no preference exists
		return preference ? preference.enabled : true;
	} catch (error) {
		logger.error(
			{ error, userId, notificationType, channel },
			"Failed to check channel preference",
		);
		return true; // Default to enabled on error
	}
}
