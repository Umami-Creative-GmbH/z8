import { pgEnum } from "drizzle-orm/pg-core";

// ============================================
// ENUMS
// ============================================

export const roleEnum = pgEnum("role", ["admin", "manager", "employee"]);
export const absenceTypeEnum = pgEnum("absence_type", [
	"home_office",
	"sick",
	"vacation",
	"personal",
	"unpaid",
	"parental",
	"bereavement",
	"custom",
]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const timeEntryTypeEnum = pgEnum("time_entry_type", ["clock_in", "clock_out", "correction"]);
export const holidayCategoryEnum = pgEnum("holiday_category_type", [
	"public_holiday",
	"company_holiday",
	"training_day",
	"custom",
]);
export const recurrenceTypeEnum = pgEnum("recurrence_type", ["none", "yearly", "custom"]);
export const holidayPresetAssignmentTypeEnum = pgEnum("holiday_preset_assignment_type", [
	"organization",
	"team",
	"employee",
]);
export const genderEnum = pgEnum("gender", ["male", "female", "other"]);
export const contractTypeEnum = pgEnum("contract_type", ["fixed", "hourly"]);
export const scheduleCycleEnum = pgEnum("schedule_cycle", [
	"daily",
	"weekly",
	"biweekly",
	"monthly",
	"yearly",
]);
export const scheduleTypeEnum = pgEnum("schedule_type", ["simple", "detailed"]);
export const workingDaysPresetEnum = pgEnum("working_days_preset", [
	"weekdays",
	"weekends",
	"all_days",
	"custom",
]);
export const dayOfWeekEnum = pgEnum("day_of_week", [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

// Day period for half-day absences
export const dayPeriodEnum = pgEnum("day_period", ["full_day", "am", "pm"]);

// Notification enums
export const notificationTypeEnum = pgEnum("notification_type", [
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
]);

export const notificationChannelEnum = pgEnum("notification_channel", ["in_app", "push", "email"]);

// Shift scheduling enums
export const shiftStatusEnum = pgEnum("shift_status", ["draft", "published"]);
export const shiftRequestTypeEnum = pgEnum("shift_request_type", ["swap", "assignment", "pickup"]);
export const shiftRecurrenceTypeEnum = pgEnum("shift_recurrence_type", [
	"daily",
	"weekly",
	"biweekly",
	"monthly",
	"custom",
]);

// Project enums
export const projectStatusEnum = pgEnum("project_status", [
	"planned",
	"active",
	"paused",
	"completed",
	"archived",
]);
export const projectAssignmentTypeEnum = pgEnum("project_assignment_type", ["team", "employee"]);

// Time regulation enums
export const timeRegulationViolationTypeEnum = pgEnum("time_regulation_violation_type", [
	"max_daily",
	"max_weekly",
	"max_uninterrupted",
	"break_required",
]);

// Surcharge enums
export const surchargeRuleTypeEnum = pgEnum("surcharge_rule_type", [
	"day_of_week",
	"time_window",
	"date_based",
]);

// Water intake / hydration tracking enums
export const waterIntakeSourceEnum = pgEnum("water_intake_source", [
	"reminder_action",
	"manual",
	"widget",
]);

// Export status enum
export const exportStatusEnum = pgEnum("export_status", [
	"pending",
	"processing",
	"completed",
	"failed",
]);

// Invite code status enum
export const inviteCodeStatusEnum = pgEnum("invite_code_status", [
	"active",
	"paused",
	"expired",
	"archived",
]);

// Member status enum (for pending member approval flow)
export const memberStatusEnum = pgEnum("member_status", [
	"pending", // awaiting admin approval
	"approved", // active member
	"rejected", // invitation rejected
	"suspended", // temporarily disabled
]);
