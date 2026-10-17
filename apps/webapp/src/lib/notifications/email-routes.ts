import type { SecurityEventType } from "@/lib/email/templates/security-alert";
import {
	EMPLOYEE_PAGES_PATH,
	MY_DATA_PATH,
} from "@/lib/personal-data-export/paths";
import type { NotificationType } from "./types";

/**
 * How a notification type is emailed (#812, #1137). The one place that decides
 * whether a type sends email at all.
 *
 * - `none`: email-free. These types sent no email before #812 and stay that way
 *   (user decision U1); the shared layout does not start emailing them.
 * - `layout`: the shared notification layout in the recipient language. There is no
 *   email override; the button links into the app only below `linkPrefixes`,
 *   otherwise to the app's start page.
 * - `template`: an overridable type. An enabled org email override for its template
 *   key wins and is sent as written; otherwise the shared notification layout. `email`
 *   names the builder of its override key, `{{variables}}`, subject and detail rows.
 * - `dedicated`: the security alert keeps its own (overridable) template (ADR 0001),
 *   for the security event it names.
 */
export type NotificationEmailRoute =
	| { kind: "none" }
	| { kind: "layout"; linkPrefixes: readonly string[] }
	| { kind: "template"; email: TemplateNotificationEmail }
	| { kind: "dedicated"; securityEvent: SecurityEventType };

/**
 * The overridable notification emails. Each has one builder; a variant inside one
 * (manager-recorded absence, absence or time-correction pending) is its builder's choice.
 */
export type TemplateNotificationEmail =
	| "absenceRequestSubmitted"
	| "absenceRequestApproved"
	| "absenceRequestRejected"
	| "approvalRequestSubmitted"
	| "timeCorrectionApproved"
	| "timeCorrectionRejected"
	| "teamMemberAdded"
	| "teamMemberRemoved";

const NONE = { kind: "none" } as const satisfies NotificationEmailRoute;

function template(email: TemplateNotificationEmail): NotificationEmailRoute {
	return { kind: "template", email };
}

function dedicated(securityEvent: SecurityEventType): NotificationEmailRoute {
	return { kind: "dedicated", securityEvent };
}

function layout(...linkPrefixes: string[]): NotificationEmailRoute {
	return { kind: "layout", linkPrefixes };
}

/** Every notification type must be listed: a new type has to choose its email route. */
const NOTIFICATION_EMAIL_ROUTES: {
	readonly [Type in NotificationType]: NotificationEmailRoute;
} = {
	// Overridable notification emails (EMAIL_TEMPLATE_KEYS).
	absence_request_submitted: template("absenceRequestSubmitted"),
	absence_request_approved: template("absenceRequestApproved"),
	absence_request_rejected: template("absenceRequestRejected"),
	// The approver's absence or time-correction pending email (`metadata.approvalSubject`).
	approval_request_submitted: template("approvalRequestSubmitted"),
	time_correction_approved: template("timeCorrectionApproved"),
	time_correction_rejected: template("timeCorrectionRejected"),
	team_member_added: template("teamMemberAdded"),
	team_member_removed: template("teamMemberRemoved"),
	// Security alert: dedicated template.
	password_changed: dedicated("password_changed"),
	two_factor_enabled: dedicated("two_factor_enabled"),
	two_factor_disabled: dedicated("two_factor_disabled"),

	// Shared layout only.
	automatic_clock_out: layout("/calendar/"),
	travel_expense_reimbursed: layout("/travel-expenses/"),
	travel_expense_partially_reimbursed: layout("/travel-expenses/"),
	travel_expense_recovery_recorded: layout("/travel-expenses/"),
	travel_expense_ready_for_reimbursement: layout("/travel-expenses/"),
	travel_expense_payroll_run_awaiting_confirmation: layout("/travel-expenses/"),
	missed_clock_in_reminder: layout("/time-tracking"),
	forgotten_clock_out_reminder: layout("/time-tracking"),
	break_due_reminder: layout("/time-tracking"),
	period_submission_reminder: layout("/time-tracking"),
	period_submission_sent_back: layout("/time-tracking"),
	period_submission_decided: layout("/time-tracking"),
	driving_details_missing_reminder: layout("/time-tracking"),
	driving_licence_reminder: layout("/driving-licence"),
	driving_authorization_suspended: layout("/driving-licence"),
	// Record the refused kiosk clocking again (#1290).
	kiosk_command_refused: layout("/time-tracking"),
	personnel_file_document_shared: layout("/my-documents"),
	personnel_file_employee_upload: layout("/personnel-files/"),
	// Officers get the employee's personnel file, the employee My documents (#869).
	personnel_file_expiry_upcoming: layout("/personnel-files/", "/my-documents"),
	personnel_file_expired_today: layout("/personnel-files/", "/my-documents"),
	personnel_file_due_for_deletion: layout("/personnel-files/"),
	// The deputy's dashboard, which shows whom they cover (#1013).
	absence_deputy_assigned: layout("/"),
	absence_deputy_removed: layout("/"),
	absence_deputy_dates_changed: layout("/"),
	absence_deputy_reminder: layout("/"),
	// The absent employee gets their absences, managers the team absences (#1014).
	absence_deputy_unavailable: layout("/absences", "/team/absences"),
	// The covering deputy's inbox section, the approver's deputy decisions (#1018).
	approval_cover_started: layout("/approvals/inbox"),
	approval_cover_return_summary: layout("/approvals/deputy-decisions/"),
	work_balance_adjustment_recorded: layout("/time-tracking"),
	work_balance_adjustment_cancelled: layout("/time-tracking"),
	scheduled_export_paused: layout("/settings/scheduled-exports"),
	// The page the export was started from; never a file link (#811).
	personal_data_export_ready: layout(MY_DATA_PATH, EMPLOYEE_PAGES_PATH),
	// Where the employee can request their own copy (#1166).
	personal_data_export_admin_exported: layout(MY_DATA_PATH),
	// Download your personal data before your departure cutoff (#1173).
	personal_data_export_reminder: layout(MY_DATA_PATH),
	// Managers, owners and admins get the employee's skills, the employee their profile (#1143).
	skill_expiry_upcoming: layout("/settings/employees/", "/settings/profile"),
	skill_expired_today: layout("/settings/employees/", "/settings/profile"),

	// Email-free (U1).
	// The employee's own "submitted"/"pending approval" confirmation. Its approver gets the
	// pending email through `approval_request_submitted`; this one is never that email (O8).
	time_correction_submitted: NONE,
	approval_request_approved: NONE,
	approval_request_rejected: NONE,
	birthday_reminder: NONE,
	vacation_balance_alert: NONE,
	schedule_published: NONE,
	shift_assigned: NONE,
	shift_swap_requested: NONE,
	shift_swap_approved: NONE,
	shift_swap_rejected: NONE,
	shift_pickup_available: NONE,
	shift_pickup_requested: NONE,
	shift_pickup_approved: NONE,
	project_budget_warning_70: NONE,
	project_budget_warning_90: NONE,
	project_budget_warning_100: NONE,
	project_deadline_warning_14d: NONE,
	project_deadline_warning_7d: NONE,
	project_deadline_warning_1d: NONE,
	project_deadline_warning_0d: NONE,
	project_deadline_overdue: NONE,
	water_reminder: NONE,
	rest_period_warning: NONE,
	rest_period_violation: NONE,
	overtime_warning: NONE,
	overtime_violation: NONE,
	compliance_exception_requested: NONE,
	compliance_exception_approved: NONE,
	compliance_exception_rejected: NONE,
	compliance_exception_expired: NONE,
	approval_escalation_attention: NONE,
	employee_offboarding_review: NONE,
	month_closed_automatically: NONE,
	month_close_blocked: NONE,
	month_reopened: NONE,
	time_off_in_lieu_available: NONE,
};

export function notificationEmailRoute(
	type: NotificationType,
): NotificationEmailRoute {
	return NOTIFICATION_EMAIL_ROUTES[type];
}

/** The notification types that never send email. */
export const EMAIL_FREE_NOTIFICATION_TYPES: readonly NotificationType[] = (
	Object.keys(NOTIFICATION_EMAIL_ROUTES) as NotificationType[]
).filter((type) => NOTIFICATION_EMAIL_ROUTES[type].kind === "none");
