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
import { isDiscordAvailable, sendDiscordNotification } from "./discord-channel";
import { sendEmailNotification } from "./email-notifications";
import {
	isPushAvailable,
	type PushPayload,
	sendPushToUser,
} from "./push-service";
import { isSlackAvailable, sendSlackNotification } from "./slack-channel";
import { isTeamsAvailable, sendTeamsNotification } from "./teams-channel";
import {
	isTelegramAvailable,
	sendTelegramNotification,
} from "./telegram-channel";
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

export type NotificationChannelPreferences = Record<NotificationChannel, boolean>;

/** Channel preferences for one notification type; a missing preference means enabled. */
export async function loadNotificationChannelPreferences(
	userId: string,
	type: NotificationType,
): Promise<NotificationChannelPreferences> {
	const preferences = await db.query.notificationPreference.findMany({
		where: and(
			eq(notificationPreference.userId, userId),
			eq(notificationPreference.notificationType, type),
		),
	});
	const enabled = (channel: NotificationChannel) => {
		const preference = preferences.find((p) => p.channel === channel);
		return !preference || preference.enabled;
	};
	return {
		in_app: enabled("in_app"),
		push: enabled("push"),
		email: enabled("email"),
		teams: enabled("teams"),
		telegram: enabled("telegram"),
		discord: enabled("discord"),
		slack: enabled("slack"),
	};
}

export type InAppNotificationResult =
	| { kind: "created"; notification: Notification }
	| { kind: "duplicate" };

/**
 * Awaited in-app insert. With an idempotency key a repeated call reports
 * `duplicate` instead of inserting a second row, so durable callers can
 * retry safely without the fan-out side effects of `createNotification`.
 */
export async function insertInAppNotification(
	params: CreateNotificationParams,
): Promise<InAppNotificationResult> {
	const insert = db.insert(notification).values({
		userId: params.userId,
		organizationId: params.organizationId,
		type: params.type,
		title: params.title,
		message: params.message,
		entityType: params.entityType,
		entityId: params.entityId,
		actionUrl: params.actionUrl,
		metadata: params.metadata ? JSON.stringify(params.metadata) : null,
		idempotencyKey: params.idempotencyKey,
	});
	const [inserted] = params.idempotencyKey
		? await insert
				.onConflictDoNothing({
					target: [notification.organizationId, notification.idempotencyKey],
					where: sql`${notification.idempotencyKey} is not null`,
				})
				.returning()
		: await insert.returning();
	return inserted ? { kind: "created", notification: inserted } : { kind: "duplicate" };
}

export type ExternalNotificationChannel = Exclude<NotificationChannel, "in_app">;

/**
 * Awaited delivery through one external transport. `unavailable` means the
 * transport is not configured for this deployment or organization, which is
 * distinct from a transport failure (thrown) and from preference suppression
 * (decided by the caller before delivery).
 */
export async function deliverNotificationToChannel(
	channel: ExternalNotificationChannel,
	params: CreateNotificationParams,
	notificationId: string | null,
): Promise<"sent" | "unavailable"> {
	const botChannelPayload = {
		userId: params.userId,
		organizationId: params.organizationId,
		type: params.type,
		title: params.title,
		message: params.message,
		entityType: params.entityType,
		entityId: params.entityId,
		actionUrl: params.actionUrl,
		metadata: params.metadata,
	};
	switch (channel) {
		case "push": {
			if (!isPushAvailable()) return "unavailable";
			await sendPushToUser(params.userId, {
				title: params.title,
				body: params.message,
				icon: "/icons/icon-192x192.png",
				badge: "/icons/badge-72x72.png",
				tag: params.type,
				data: {
					notificationId: notificationId ?? undefined,
					type: params.type,
					actionUrl: params.actionUrl,
					url: params.actionUrl,
				},
			});
			return "sent";
		}
		case "email":
			await sendEmailNotification({
				userId: params.userId,
				type: params.type,
				title: params.title,
				message: params.message,
				metadata: params.metadata,
				organizationId: params.organizationId,
			});
			return "sent";
		case "teams":
			if (!(await isTeamsAvailable(params.organizationId))) return "unavailable";
			await sendTeamsNotification(botChannelPayload);
			return "sent";
		case "telegram":
			if (!(await isTelegramAvailable(params.organizationId))) return "unavailable";
			await sendTelegramNotification(botChannelPayload);
			return "sent";
		case "discord":
			if (!(await isDiscordAvailable(params.organizationId))) return "unavailable";
			await sendDiscordNotification(botChannelPayload);
			return "sent";
		case "slack":
			if (!(await isSlackAvailable(params.organizationId))) return "unavailable";
			await sendSlackNotification(botChannelPayload);
			return "sent";
	}
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
	options: { throwOnError?: boolean } = {},
): Promise<Notification | null> {
	try {
		const channels = await loadNotificationChannelPreferences(
			params.userId,
			params.type,
		);
		const inAppEnabled = channels.in_app;
		const pushEnabled = channels.push;
		const emailEnabled = channels.email;
		const teamsEnabled = channels.teams;
		const telegramEnabled = channels.telegram;
		const discordEnabled = channels.discord;
		const slackEnabled = channels.slack;

		let created: Notification | null = null;

		// Create in-app notification if enabled
		if (inAppEnabled) {
			const inserted = await insertInAppNotification(params);
			created = inserted.kind === "created" ? inserted.notification : null;

			if (created) {
				logger.info(
					{
						notificationId: created.id,
						userId: params.userId,
						type: params.type,
					},
					"Notification created",
				);
			} else if (params.idempotencyKey) {
				return null;
			}
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

		// Check bot platform availability in parallel (async-parallel rule)
		const [
			teamsAvailable,
			telegramAvailable,
			discordAvailable,
			slackAvailable,
		] = await Promise.all([
			teamsEnabled
				? isTeamsAvailable(params.organizationId)
				: Promise.resolve(false),
			telegramEnabled
				? isTelegramAvailable(params.organizationId)
				: Promise.resolve(false),
			discordEnabled
				? isDiscordAvailable(params.organizationId)
				: Promise.resolve(false),
			slackEnabled
				? isSlackAvailable(params.organizationId)
				: Promise.resolve(false),
		]);

		const botChannelPayload = {
			userId: params.userId,
			organizationId: params.organizationId,
			type: params.type,
			title: params.title,
			message: params.message,
			entityType: params.entityType,
			entityId: params.entityId,
			actionUrl: params.actionUrl,
			metadata: params.metadata,
		};

		// Send Teams notification if enabled and available
		if (teamsAvailable) {
			void sendTeamsNotification(botChannelPayload).catch((error) => {
				logger.error(
					{ error, userId: params.userId, type: params.type },
					"Failed to send Teams notification",
				);
			});
		}

		// Send Telegram notification if enabled and available
		if (telegramAvailable) {
			void sendTelegramNotification(botChannelPayload).catch((error) => {
				logger.error(
					{ error, userId: params.userId, type: params.type },
					"Failed to send Telegram notification",
				);
			});
		}

		// Send Discord notification if enabled and available
		if (discordAvailable) {
			void sendDiscordNotification(botChannelPayload).catch((error) => {
				logger.error(
					{ error, userId: params.userId, type: params.type },
					"Failed to send Discord notification",
				);
			});
		}

		// Send Slack notification if enabled and available
		if (slackAvailable) {
			void sendSlackNotification(botChannelPayload).catch((error) => {
				logger.error(
					{ error, userId: params.userId, type: params.type },
					"Failed to send Slack notification",
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
		if (options.throwOnError) throw error;
		return null;
	}
}

/**
 * Create a notification for a manager by their employee ID
 *
 * This resolves the manager's userId from their employee ID, then creates
 * the notification using createNotification.
 */
export async function createNotificationForManager(
	params: Omit<CreateNotificationParams, "userId"> & { managerId: string },
): Promise<Notification | null> {
	try {
		// Import employee table here to avoid circular dependency
		const { employee } = await import("@/db/schema");

		// Get the manager's userId from their employee record
		const manager = await db.query.employee.findFirst({
			where: eq(employee.id, params.managerId),
			columns: { userId: true },
		});

		if (!manager) {
			logger.warn(
				{ managerId: params.managerId },
				"Manager not found for notification",
			);
			return null;
		}

		// Create notification with resolved userId
		return await createNotification({
			...params,
			userId: manager.userId,
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to create manager notification");
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
): Promise<{
	notifications: NotificationWithMeta[];
	total: number;
	hasMore: boolean;
}> {
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
		const resultNotifications = hasMore
			? notifications.slice(0, limit)
			: notifications;

		// Add timeAgo to each notification
		const notificationsWithMeta: NotificationWithMeta[] =
			resultNotifications.map((n) => ({
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
export async function getUnreadCount(
	userId: string,
	organizationId: string,
): Promise<number> {
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
	organizationId: string,
): Promise<Notification | null> {
	try {
		const [updated] = await db
			.update(notification)
			.set({
				isRead: true,
				readAt: new Date(),
			})
			.where(
				and(
					eq(notification.id, notificationId),
					eq(notification.userId, userId),
					eq(notification.organizationId, organizationId),
				),
			)
			.returning();

		if (updated) {
			logger.debug({ notificationId }, "Notification marked as read");
		}

		return updated || null;
	} catch (error) {
		logger.error(
			{ error, notificationId, userId },
			"Failed to mark notification as read",
		);
		return null;
	}
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(
	userId: string,
	organizationId: string,
): Promise<number> {
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

		return updatedCount;
	} catch (error) {
		logger.error({ error, userId }, "Failed to mark all notifications as read");
		return 0;
	}
}

/**
 * Delete a notification
 */
export async function deleteNotification(
	notificationId: string,
	userId: string,
	organizationId: string,
): Promise<boolean> {
	try {
		const result = await db
			.delete(notification)
			.where(
				and(
					eq(notification.id, notificationId),
					eq(notification.userId, userId),
					eq(notification.organizationId, organizationId),
				),
			)
			.returning({ id: notification.id });

		const deleted = result.length > 0;
		if (deleted) {
			logger.debug({ notificationId }, "Notification deleted");
		}

		return deleted;
	} catch (error) {
		logger.error(
			{ error, notificationId, userId },
			"Failed to delete notification",
		);
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
			.where(
				and(
					eq(notification.userId, userId),
					eq(notification.organizationId, organizationId),
				),
			)
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
export async function deleteOldNotifications(
	olderThanDays: number = 90,
): Promise<number> {
	try {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

		const result = await db
			.delete(notification)
			.where(sql`${notification.createdAt} < ${cutoffDate}`)
			.returning({ id: notification.id });

		const deletedCount = result.length;
		logger.info(
			{ deletedCount, olderThanDays },
			"Old notifications cleaned up",
		);

		return deletedCount;
	} catch (error) {
		logger.error(
			{ error, olderThanDays },
			"Failed to delete old notifications",
		);
		return 0;
	}
}

/**
 * Check if a user has a specific channel enabled for a notification type
 */
export async function isChannelEnabled(
	userId: string,
	_organizationId: string,
	notificationType: NotificationType,
	channel: NotificationChannel,
): Promise<boolean> {
	try {
		const preference = await db.query.notificationPreference.findFirst({
			where: and(
				eq(notificationPreference.userId, userId),
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
