/**
 * Test helpers for notification tests
 */

import type { Notification, NotificationPreference } from "../types";

/**
 * Create a mock notification with default values
 */
export function createMockNotification(overrides?: Partial<Notification>): Notification {
	return {
		id: overrides?.id ?? "notif-1",
		userId: overrides?.userId ?? "user-1",
		organizationId: overrides?.organizationId ?? "org-1",
		type: overrides?.type ?? "approval_request_submitted",
		title: overrides?.title ?? "Test Notification",
		message: overrides?.message ?? "This is a test notification message",
		isRead: overrides?.isRead ?? false,
		readAt: overrides?.readAt ?? null,
		entityType: overrides?.entityType ?? null,
		entityId: overrides?.entityId ?? null,
		actionUrl: overrides?.actionUrl ?? null,
		metadata: overrides?.metadata ?? null,
		createdAt: overrides?.createdAt ?? new Date(),
	};
}

/**
 * Create a mock notification preference with default values
 */
export function createMockPreference(
	overrides?: Partial<NotificationPreference>,
): NotificationPreference {
	return {
		id: overrides?.id ?? "pref-1",
		userId: overrides?.userId ?? "user-1",
		organizationId: overrides?.organizationId ?? null,
		notificationType: overrides?.notificationType ?? "approval_request_submitted",
		channel: overrides?.channel ?? "in_app",
		enabled: overrides?.enabled ?? true,
		createdAt: overrides?.createdAt ?? new Date(),
		updatedAt: overrides?.updatedAt ?? new Date(),
	};
}

/**
 * Create a date that is X seconds ago
 */
export function dateSecondsAgo(seconds: number): Date {
	return new Date(Date.now() - seconds * 1000);
}

/**
 * Create a date that is X minutes ago
 */
export function dateMinutesAgo(minutes: number): Date {
	return new Date(Date.now() - minutes * 60 * 1000);
}

/**
 * Create a date that is X hours ago
 */
export function dateHoursAgo(hours: number): Date {
	return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * Create a date that is X days ago
 */
export function dateDaysAgo(days: number): Date {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Create a date that is X weeks ago
 */
export function dateWeeksAgo(weeks: number): Date {
	return dateDaysAgo(weeks * 7);
}

/**
 * Create a date that is X months ago (approximate, using 30 days)
 */
export function dateMonthsAgo(months: number): Date {
	return dateDaysAgo(months * 30);
}

/**
 * Create a list of mock notifications
 */
export function createMockNotificationList(
	count: number,
	overrides?: Partial<Notification>,
): Notification[] {
	return Array.from({ length: count }, (_, i) =>
		createMockNotification({
			...overrides,
			id: `notif-${i + 1}`,
			createdAt: new Date(Date.now() - i * 60 * 1000), // Each notification 1 minute apart
		}),
	);
}
