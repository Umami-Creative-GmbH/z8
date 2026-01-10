/**
 * Notification System Types
 */

import type { notification, notificationPreference } from "@/db/schema";

// Notification type enum values
export const NOTIFICATION_TYPES = [
	"approval_request_submitted",
	"approval_request_approved",
	"approval_request_rejected",
	"time_correction_submitted",
	"time_correction_approved",
	"time_correction_rejected",
	"absence_request_submitted",
	"absence_request_approved",
	"absence_request_rejected",
	"team_member_added",
	"team_member_removed",
	"password_changed",
	"two_factor_enabled",
	"two_factor_disabled",
	"birthday_reminder",
	"vacation_balance_alert",
	// Shift scheduling notifications
	"schedule_published",
	"shift_assigned",
	"shift_swap_requested",
	"shift_swap_approved",
	"shift_swap_rejected",
	"shift_pickup_available",
	"shift_pickup_approved",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Notification channel enum values
export const NOTIFICATION_CHANNELS = ["in_app", "push", "email"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// Database types
export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;

export type NotificationPreference = typeof notificationPreference.$inferSelect;
export type NewNotificationPreference = typeof notificationPreference.$inferInsert;

// API response types
export interface NotificationWithMeta extends Notification {
	timeAgo: string;
}

export interface NotificationsListResponse {
	notifications: NotificationWithMeta[];
	total: number;
	unreadCount: number;
	hasMore: boolean;
}

export interface UnreadCountResponse {
	count: number;
}

// Create notification params
export interface CreateNotificationParams {
	userId: string;
	organizationId: string;
	type: NotificationType;
	title: string;
	message: string;
	entityType?: string;
	entityId?: string;
	actionUrl?: string;
	metadata?: Record<string, unknown>;
}

// Notification event payloads for triggers
export interface AbsenceNotificationPayload {
	absenceId: string;
	employeeId: string;
	employeeName: string;
	categoryName: string;
	startDate: Date;
	endDate: Date;
	notes?: string;
}

export interface TimeCorrectionNotificationPayload {
	workPeriodId: string;
	employeeId: string;
	employeeName: string;
	originalTime: Date;
	correctedTime: Date;
	reason: string;
}

export interface TeamNotificationPayload {
	teamId: string;
	teamName: string;
	memberId: string;
	memberName: string;
	performedBy: string;
}

export interface SecurityNotificationPayload {
	userId: string;
	eventType: "password_changed" | "two_factor_enabled" | "two_factor_disabled";
	ipAddress?: string;
	userAgent?: string;
}

// SSE event types
export interface NotificationSSEEvent {
	type: "notification" | "count_update" | "heartbeat";
	data: Notification | { count: number } | { timestamp: number };
}

// Preference update params
export interface UpdatePreferenceParams {
	userId: string;
	organizationId: string;
	notificationType: NotificationType;
	channel: NotificationChannel;
	enabled: boolean;
}

// Bulk preference response
export interface UserPreferencesResponse {
	preferences: NotificationPreference[];
	// Matrix format for UI: type -> channel -> enabled
	matrix: Record<NotificationType, Record<NotificationChannel, boolean>>;
}
