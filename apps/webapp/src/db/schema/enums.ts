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
	// ArbZG Compliance notifications
	"rest_period_warning", // Proactive warning about rest period
	"rest_period_violation", // Rest period violation occurred
	"overtime_warning", // Approaching overtime threshold
	"overtime_violation", // Overtime threshold exceeded
	"compliance_exception_requested", // Exception request submitted to manager
	"compliance_exception_approved", // Exception approved by manager
	"compliance_exception_rejected", // Exception rejected by manager
	"compliance_exception_expired", // Pre-approval expired
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
	"in_app",
	"push",
	"email",
	"teams",
	"telegram",
	"discord",
	"slack",
]);

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
	"rest_period", // ArbZG: 11-hour rest period violation
	"overtime_daily", // ArbZG: Daily overtime threshold exceeded
	"overtime_weekly", // ArbZG: Weekly overtime threshold exceeded
	"overtime_monthly", // ArbZG: Monthly overtime threshold exceeded
]);

// Rest period enforcement mode
export const restPeriodEnforcementEnum = pgEnum("rest_period_enforcement", [
	"block", // Hard block clock-in until rest period satisfied (requires approval)
	"warn", // Show warning but allow clock-in; log violation
	"none", // No enforcement, no warnings
]);

// Compliance exception type
export const complianceExceptionTypeEnum = pgEnum("compliance_exception_type", [
	"rest_period", // Exception for 11-hour rest period
	"overtime_daily", // Exception for daily overtime
	"overtime_weekly", // Exception for weekly overtime
	"overtime_monthly", // Exception for monthly overtime
]);

// Compliance exception status
export const complianceExceptionStatusEnum = pgEnum("compliance_exception_status", [
	"pending", // Awaiting manager approval
	"approved", // Approved by manager
	"rejected", // Rejected by manager
	"expired", // Pre-approval expired (24h passed)
	"used", // Exception was used (employee clocked in using it)
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

// Payroll export format enum
export const payrollExportFormatEnum = pgEnum("payroll_export_format_type", [
	"datev_lohn",
	"personio",
	"sage",
	"lexware",
	"custom",
]);

// Payroll export status enum
export const payrollExportStatusEnum = pgEnum("payroll_export_status", [
	"pending",
	"processing",
	"completed",
	"failed",
]);

// ============================================
// SCHEDULED EXPORT ENUMS
// ============================================

// Schedule frequency type (preset intervals or custom cron)
export const scheduledExportScheduleTypeEnum = pgEnum("scheduled_export_schedule_type", [
	"daily",
	"weekly",
	"monthly",
	"quarterly",
	"cron",
]);

// Report type for scheduled exports
export const scheduledExportReportTypeEnum = pgEnum("scheduled_export_report_type", [
	"payroll_export",
	"data_export",
	"audit_report",
]);

// Delivery method
export const scheduledExportDeliveryMethodEnum = pgEnum("scheduled_export_delivery_method", [
	"s3_only",
	"email_only",
	"s3_and_email",
]);

// Date range calculation strategy
export const scheduledExportDateRangeStrategyEnum = pgEnum("scheduled_export_date_range_strategy", [
	"previous_day",
	"previous_week",
	"previous_month",
	"previous_quarter",
	"custom_offset",
]);

// Execution status
export const scheduledExportExecutionStatusEnum = pgEnum("scheduled_export_execution_status", [
	"pending",
	"processing",
	"completed",
	"failed",
]);

// ============================================
// SKILL & QUALIFICATION ENUMS
// ============================================

// Skill categories for organization skill catalog
export const skillCategoryEnum = pgEnum("skill_category", [
	"safety", // Safety certifications (e.g., First Aid, Fire Safety)
	"equipment", // Equipment operation (e.g., Forklift, Crane)
	"certification", // Professional certifications (e.g., Food Safety)
	"training", // Training completions
	"language", // Language proficiency
	"custom", // Custom category (uses customCategoryName field)
]);

// ============================================
// COMPLIANCE RADAR ENUMS
// ============================================

// Compliance finding type (what rule was violated)
export const complianceFindingTypeEnum = pgEnum("compliance_finding_type", [
	"rest_period_insufficient", // 11-hour rest period violated
	"max_hours_daily_exceeded", // Daily max exceeded
	"max_hours_weekly_exceeded", // Weekly max exceeded
	"consecutive_days_exceeded", // Too many consecutive work days
]);

// Compliance finding severity
export const complianceFindingSeverityEnum = pgEnum("compliance_finding_severity", [
	"info", // FYI only (5-10% over threshold)
	"warning", // Should review (10-25% over threshold)
	"critical", // Requires action (25%+ over threshold)
]);

// Compliance finding status
export const complianceFindingStatusEnum = pgEnum("compliance_finding_status", [
	"open", // Not yet reviewed
	"acknowledged", // Manager reviewed, noted
	"waived", // Manager approved exception
	"resolved", // Fixed/no longer relevant
]);
