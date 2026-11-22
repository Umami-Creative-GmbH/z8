export const contractTemplateKinds = ["template", "default_backing"] as const;
export const scheduleModes = ["inherit", "policy", "hours_only", "custom_days"] as const;
export const templateScheduleModes = ["policy", "hours_only", "custom_days"] as const;
export const presenceOverrides = ["inherit", "exempt", "require_onsite"] as const;
export const balanceModes = ["tracked", "trust_based"] as const;
export const scheduleSources = ["policy", "published_shifts", "on_call"] as const;
export const employmentProfiles = [
	"regular",
	"minijob",
	"short_term",
	"working_student",
	"apprentice",
] as const;
export const arbzgScopes = ["standard", "executive_exempt"] as const;
export const onCallHoursKinds = ["exact", "minimum", "maximum", "unspecified"] as const;
export const contractDefaultScopes = ["organization", "team"] as const;
export const contractMigrationConflictKinds = [
	"weekly_hours_policy_day_sum_mismatch",
	"legacy_assignment_conflict",
	"legacy_terms_overlap",
	"other",
] as const;
export const contractMigrationConflictStatuses = ["open", "resolved", "dismissed"] as const;
export const workPolicyAssignmentSourceKinds = [
	"contract_default",
	"employment_terms",
	"manager_assignment",
	"legacy",
] as const;
export const employmentTermAgreementKinds = ["permanent", "fixed_term"] as const;
export const contractChangeBatchOperationKinds = [
	"bulk_template_apply",
	"bulk_adopt_default",
	"bulk_terms_update",
	"csv_contract_import",
	"csv_departure_import",
] as const;
export const contractChangeBatchExecutionModes = ["inline", "async"] as const;
export const contractChangeBatchStatuses = [
	"pending",
	"running",
	"completed",
	"completed_with_errors",
	"failed",
	"canceled",
] as const;
export const contractChangeBatchItemStatuses = [
	"pending",
	"running",
	"completed",
	"skipped",
	"failed",
] as const;

export type ContractTemplateKind = (typeof contractTemplateKinds)[number];
export type ScheduleMode = (typeof scheduleModes)[number];
export type TemplateScheduleMode = (typeof templateScheduleModes)[number];
export type PresenceOverride = (typeof presenceOverrides)[number];
export type BalanceMode = (typeof balanceModes)[number];
export type ScheduleSource = (typeof scheduleSources)[number];
export type EmploymentProfile = (typeof employmentProfiles)[number];
export type ArbzgScope = (typeof arbzgScopes)[number];
export type OnCallHoursKind = (typeof onCallHoursKinds)[number];
export type ContractDefaultScope = (typeof contractDefaultScopes)[number];
export type ContractMigrationConflictKind = (typeof contractMigrationConflictKinds)[number];
export type ContractMigrationConflictStatus = (typeof contractMigrationConflictStatuses)[number];
export type WorkPolicyAssignmentSourceKind = (typeof workPolicyAssignmentSourceKinds)[number];
export type EmploymentTermAgreementKind = (typeof employmentTermAgreementKinds)[number];
export type ContractChangeBatchOperationKind = (typeof contractChangeBatchOperationKinds)[number];
export type ContractChangeBatchExecutionMode = (typeof contractChangeBatchExecutionModes)[number];
export type ContractChangeBatchStatus = (typeof contractChangeBatchStatuses)[number];
export type ContractChangeBatchItemStatus = (typeof contractChangeBatchItemStatuses)[number];
