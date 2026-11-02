import { describe, expect, it } from "vitest";
import { EMAIL_FREE_NOTIFICATION_TYPES, notificationEmailRoute } from "./email-routes";

describe("notification email routes", () => {
	it("keeps the types that sent no email before #812 email-free (U1, #1137)", () => {
		expect([...EMAIL_FREE_NOTIFICATION_TYPES].sort()).toEqual(
			[
				"time_correction_submitted",
				"approval_request_approved",
				"approval_request_rejected",
				"birthday_reminder",
				"vacation_balance_alert",
				"schedule_published",
				"shift_assigned",
				"shift_swap_requested",
				"shift_swap_approved",
				"shift_swap_rejected",
				"shift_pickup_available",
				"shift_pickup_requested",
				"shift_pickup_approved",
				"project_budget_warning_70",
				"project_budget_warning_90",
				"project_budget_warning_100",
				"project_deadline_warning_14d",
				"project_deadline_warning_7d",
				"project_deadline_warning_1d",
				"project_deadline_warning_0d",
				"project_deadline_overdue",
				"water_reminder",
				"rest_period_warning",
				"rest_period_violation",
				"overtime_warning",
				"overtime_violation",
				"compliance_exception_requested",
				"compliance_exception_approved",
				"compliance_exception_rejected",
				"compliance_exception_expired",
				"approval_escalation_attention",
				"employee_offboarding_review",
				"month_closed_automatically",
				"month_close_blocked",
				"month_reopened",
				"time_off_in_lieu_available",
			].sort(),
		);
	});

	it("sends notification emails with an override template through the template route", () => {
		expect(notificationEmailRoute("absence_request_approved")).toEqual({
			kind: "template",
			email: "absenceRequestApproved",
		});
		expect(notificationEmailRoute("approval_request_submitted")).toEqual({
			kind: "template",
			email: "approvalRequestSubmitted",
		});
		expect(notificationEmailRoute("team_member_added")).toEqual({
			kind: "template",
			email: "teamMemberAdded",
		});
		expect(notificationEmailRoute("password_changed")).toEqual({
			kind: "dedicated",
			securityEvent: "password_changed",
		});
	});

	it("links layout-only emails into the app only below their prefixes", () => {
		expect(notificationEmailRoute("automatic_clock_out")).toEqual({
			kind: "layout",
			linkPrefixes: ["/calendar/"],
		});
		expect(notificationEmailRoute("personnel_file_expiry_upcoming")).toEqual({
			kind: "layout",
			linkPrefixes: ["/personnel-files/", "/my-documents"],
		});
		// The employee's security settings; their managers' copy the employee's page (#1507).
		expect(notificationEmailRoute("kiosk_fob_registered")).toEqual({
			kind: "layout",
			linkPrefixes: ["/settings/security", "/settings/employees/"],
		});
	});
});
