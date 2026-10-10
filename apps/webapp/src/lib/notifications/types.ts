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
	"shift_pickup_requested",
	"shift_pickup_approved",
	// Project notifications
	"project_budget_warning_70",
	"project_budget_warning_90",
	"project_budget_warning_100",
	"project_deadline_warning_14d",
	"project_deadline_warning_7d",
	"project_deadline_warning_1d",
	"project_deadline_warning_0d",
	"project_deadline_overdue",
	// Wellness notifications
	"water_reminder",
	// ArbZG Compliance notifications
	"rest_period_warning",
	"rest_period_violation",
	"overtime_warning",
	"overtime_violation",
	"compliance_exception_requested",
	"compliance_exception_approved",
	"compliance_exception_rejected",
	"compliance_exception_expired",
	// Approval escalation administrative attention
	"approval_escalation_attention",
	// Employee offboarding follow-up review
	"employee_offboarding_review",
	"automatic_clock_out",
	// Money recorded on the employee's own travel expense (#752)
	"travel_expense_reimbursed",
	"travel_expense_partially_reimbursed",
	"travel_expense_recovery_recorded",
	// Reimbursement work arriving for expense officers (#756)
	"travel_expense_ready_for_reimbursement",
	// A payroll run awaits the officer's confirmation (#855)
	"travel_expense_payroll_run_awaiting_confirmation",
	// Clocking reminders to the employee about their own clocking (#827)
	"missed_clock_in_reminder",
	"forgotten_clock_out_reminder",
	// Break-due reminder before live work breaks the policy's break rules (#833)
	"break_due_reminder",
	// An employee document became visible to its employee (#865)
	"personnel_file_document_shared",
	// An employee uploaded a document into their own personnel file (#867)
	"personnel_file_employee_upload",
	// Expiry reminders for certificates and other documents (#869)
	"personnel_file_expiry_upcoming",
	"personnel_file_expired_today",
	// Documents newly due for deletion, for covering officers (#870)
	"personnel_file_due_for_deletion",
	// Deputy on an absence: named, removed, new dates, day-before reminder (#1013)
	"absence_deputy_assigned",
	"absence_deputy_removed",
	"absence_deputy_dates_changed",
	"absence_deputy_reminder",
	// A departed or deactivated deputy was cleared from an absence (#1014)
	"absence_deputy_unavailable",
	// Cover summaries: to the deputy when cover starts, to the approver on return (#1018)
	"approval_cover_started",
	"approval_cover_return_summary",
	// Closed months (#762): automatic close, its blockers, and reopenings
	"month_closed_automatically",
	"month_close_blocked",
	"month_reopened",
	// One-time notice to owners and admins that time off in lieu is available (#1000)
	"time_off_in_lieu_available",
	// A balance adjustment on the employee's own work balance (#996)
	"work_balance_adjustment_recorded",
	"work_balance_adjustment_cancelled",
	// Reminders to the employee to submit an ended submission period (#1064)
	"period_submission_reminder",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** System closure evidence is always delivered to the employee's inbox. */
export function hasMandatoryInbox(type: NotificationType): boolean {
	return type === "automatic_clock_out";
}

/** Types delivered only to the inbox until the user turns on another channel. */
const IN_APP_ONLY_BY_DEFAULT: ReadonlySet<NotificationType> = new Set([
	"travel_expense_ready_for_reimbursement",
	"travel_expense_payroll_run_awaiting_confirmation",
	// The approver hears in the app what their deputy decided (#1018).
	"approval_cover_return_summary",
	// Closed months notify in-app only (#762).
	"month_closed_automatically",
	"month_close_blocked",
	"month_reopened",
]);

/** Clocking reminders: in-app and push until the user turns on another channel. */
const IN_APP_AND_PUSH_BY_DEFAULT: ReadonlySet<NotificationType> = new Set([
	"missed_clock_in_reminder",
	"forgotten_clock_out_reminder",
	"break_due_reminder",
	"period_submission_reminder",
]);

/** Whether a channel is on for a type the user stored no preference for. */
export function isChannelEnabledByDefault(
	type: NotificationType,
	channel: NotificationChannel,
): boolean {
	if (channel === "in_app") return true;
	if (IN_APP_AND_PUSH_BY_DEFAULT.has(type)) return channel === "push";
	return !IN_APP_ONLY_BY_DEFAULT.has(type);
}

// Notification channel enum values
export const NOTIFICATION_CHANNELS = [
	"in_app",
	"push",
	"email",
	"teams",
	"telegram",
	"discord",
	"slack",
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// Database types
export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;

export type NotificationPreference = typeof notificationPreference.$inferSelect;
export type NewNotificationPreference =
	typeof notificationPreference.$inferInsert;

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
	idempotencyKey?: string;
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
	// Organization-scoped availability for rendering channel controls.
	availableChannels: Record<NotificationChannel, boolean>;
}
