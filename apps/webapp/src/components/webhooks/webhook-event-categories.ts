export const EVENT_CATEGORIES = {
	absences: {
		label: "Absences",
		events: [
			"absence_request_submitted",
			"absence_request_approved",
			"absence_request_rejected",
		],
	},
	approvals: {
		label: "Approvals",
		events: [
			"approval_request_submitted",
			"approval_request_approved",
			"approval_request_rejected",
		],
	},
	timeTracking: {
		label: "Time Tracking",
		events: [
			"time_correction_submitted",
			"time_correction_approved",
			"time_correction_rejected",
		],
	},
	shifts: {
		label: "Shifts",
		events: [
			"schedule_published",
			"shift_assigned",
			"shift_swap_requested",
			"shift_swap_approved",
			"shift_swap_rejected",
			"shift_pickup_available",
			"shift_pickup_approved",
		],
	},
	projects: {
		label: "Projects",
		events: [
			"project_budget_warning_70",
			"project_budget_warning_90",
			"project_budget_warning_100",
			"project_deadline_warning_14d",
			"project_deadline_warning_7d",
			"project_deadline_warning_1d",
			"project_deadline_warning_0d",
			"project_deadline_overdue",
		],
	},
	teams: {
		label: "Teams",
		events: ["team_member_added", "team_member_removed"],
	},
	security: {
		label: "Security",
		events: ["password_changed", "two_factor_enabled", "two_factor_disabled"],
	},
	reminders: {
		label: "Reminders",
		events: ["birthday_reminder", "vacation_balance_alert", "water_reminder"],
	},
} as const;
