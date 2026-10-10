/**
 * Content-free native push messages (#843).
 *
 * A native push travels through Firebase Cloud Messaging, so it must not carry
 * personal data: no names, times, amounts or organization names. A message
 * holds only a generic, localized title and body, the notification type, the
 * in-app path to open and the organization id. The app fetches the details
 * after it opens. The notification's own title, message and metadata are
 * never read here.
 */

import type { NotificationType } from "./types";

export type NativePushCategory =
	| "review"
	| "request_update"
	| "reminder"
	| "schedule"
	| "working_time"
	| "security"
	| "team"
	| "travel_expense"
	| "document"
	| "project"
	| "attention";

/** Every type needs a category, so a new type cannot leak its own text. */
const NATIVE_PUSH_CATEGORY: Record<NotificationType, NativePushCategory> = {
	approval_request_submitted: "review",
	approval_request_approved: "request_update",
	approval_request_rejected: "request_update",
	time_correction_submitted: "review",
	time_correction_approved: "request_update",
	time_correction_rejected: "request_update",
	absence_request_submitted: "review",
	absence_request_approved: "request_update",
	absence_request_rejected: "request_update",
	team_member_added: "team",
	team_member_removed: "team",
	password_changed: "security",
	two_factor_enabled: "security",
	two_factor_disabled: "security",
	birthday_reminder: "reminder",
	vacation_balance_alert: "reminder",
	schedule_published: "schedule",
	shift_assigned: "schedule",
	shift_swap_requested: "review",
	shift_swap_approved: "request_update",
	shift_swap_rejected: "request_update",
	shift_pickup_available: "schedule",
	shift_pickup_requested: "review",
	shift_pickup_approved: "request_update",
	project_budget_warning_70: "project",
	project_budget_warning_90: "project",
	project_budget_warning_100: "project",
	project_deadline_warning_14d: "project",
	project_deadline_warning_7d: "project",
	project_deadline_warning_1d: "project",
	project_deadline_warning_0d: "project",
	project_deadline_overdue: "project",
	water_reminder: "reminder",
	rest_period_warning: "working_time",
	rest_period_violation: "working_time",
	overtime_warning: "working_time",
	overtime_violation: "working_time",
	compliance_exception_requested: "review",
	compliance_exception_approved: "request_update",
	compliance_exception_rejected: "request_update",
	compliance_exception_expired: "request_update",
	approval_escalation_attention: "attention",
	employee_offboarding_review: "attention",
	automatic_clock_out: "working_time",
	travel_expense_reimbursed: "travel_expense",
	travel_expense_partially_reimbursed: "travel_expense",
	travel_expense_recovery_recorded: "travel_expense",
	travel_expense_ready_for_reimbursement: "attention",
	travel_expense_payroll_run_awaiting_confirmation: "attention",
	missed_clock_in_reminder: "reminder",
	forgotten_clock_out_reminder: "reminder",
	break_due_reminder: "reminder",
	personnel_file_document_shared: "document",
	personnel_file_employee_upload: "attention",
	personnel_file_expiry_upcoming: "document",
	personnel_file_expired_today: "document",
	personnel_file_due_for_deletion: "attention",
	absence_deputy_assigned: "schedule",
	absence_deputy_removed: "schedule",
	absence_deputy_dates_changed: "schedule",
	absence_deputy_reminder: "reminder",
	absence_deputy_unavailable: "attention",
	approval_cover_started: "review",
	approval_cover_return_summary: "request_update",
};

/** One static `t()` default per key, so the extractor can read every default. */
function categoryTitle(category: NativePushCategory, t: NativePushTranslate): string {
	switch (category) {
		case "review":
			return t("notifications.nativePush.review.title", "You have a request to review");
		case "request_update":
			return t("notifications.nativePush.requestUpdate.title", "Your request was updated");
		case "reminder":
			return t("notifications.nativePush.reminder.title", "Reminder from Z8");
		case "schedule":
			return t("notifications.nativePush.schedule.title", "Your schedule has changed");
		case "working_time":
			return t("notifications.nativePush.workingTime.title", "News about your working time");
		case "security":
			return t("notifications.nativePush.security.title", "Security notice for your account");
		case "team":
			return t("notifications.nativePush.team.title", "Your teams have changed");
		case "travel_expense":
			return t("notifications.nativePush.travelExpense.title", "News about your travel expenses");
		case "document":
			return t("notifications.nativePush.document.title", "News about your documents");
		case "project":
			return t("notifications.nativePush.project.title", "News about a project");
		case "attention":
			return t("notifications.nativePush.attention.title", "Something needs your attention");
	}
}

/** `(key, defaultValue) => text` in the recipient's language. */
export type NativePushTranslate = (key: string, defaultValue: string) => string;

export interface NativePushInput {
	type: NotificationType;
	organizationId?: string | null;
	actionUrl?: string | null;
}

export interface NativePushMessage {
	title: string;
	body: string;
	data: {
		type: NotificationType;
		path: string;
		organizationId?: string;
	};
}

const PATH_BASE = "https://z8.invalid";

/**
 * The in-app path of an action URL. Query and hash are dropped because they
 * can carry dates or other details; other origins and schemes become "/".
 */
export function nativePushPath(actionUrl: string | null | undefined): string {
	if (!actionUrl?.startsWith("/") || actionUrl.startsWith("//")) return "/";
	try {
		const url = new URL(actionUrl, PATH_BASE);
		return url.origin === PATH_BASE ? url.pathname : "/";
	} catch {
		return "/";
	}
}

export function buildNativePushMessage(
	input: NativePushInput,
	t: NativePushTranslate,
): NativePushMessage {
	const data: NativePushMessage["data"] = {
		type: input.type,
		path: nativePushPath(input.actionUrl),
	};
	if (input.organizationId) data.organizationId = input.organizationId;
	return {
		title: categoryTitle(NATIVE_PUSH_CATEGORY[input.type], t),
		body: t("notifications.nativePush.body", "Open Z8 to see the details."),
		data,
	};
}

/** The FCM HTTP v1 `messages:send` body for one device. Data values are strings. */
export function toFcmMessage(token: string, message: NativePushMessage) {
	const data: Record<string, string> = { ...message.data };
	return {
		message: {
			token,
			notification: { title: message.title, body: message.body },
			data,
			android: { priority: "high" as const },
			apns: { payload: { aps: { sound: "default" } } },
		},
	};
}

export type FcmMessageBody = ReturnType<typeof toFcmMessage>;
