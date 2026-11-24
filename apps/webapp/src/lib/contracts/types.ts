import type {
	ArbzgScope,
	BalanceMode,
	EmploymentProfile,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleMode,
	ScheduleSource,
} from "@/db/schema/contract-types";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
import type { ContractType } from "@/lib/validations/employee";

export type DayOfWeek =
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

export type WorkModel = "onsite" | "hybrid" | "remote" | "flexible";

export type ContractFieldSource =
	| "employee_override"
	| "employee_term"
	| "team_default"
	| "org_default"
	| "legacy_assignment"
	| "default";

export interface CustomWorkDay {
	readonly dayOfWeek: DayOfWeek;
	readonly minutesPerDay: number;
	readonly isWorkDay: boolean;
	readonly latestClockIn: string | null;
}

export interface ResolvedScheduleDay {
	readonly dayOfWeek: DayOfWeek;
	readonly minutesPerDay: number;
	readonly isWorkDay: boolean;
	readonly latestClockIn: string | null;
	readonly cycleWeek: number;
}

export interface WeeklyHoursMismatchWarning {
	readonly kind: "weekly_hours_policy_day_sum_mismatch";
	readonly employeeWeeklyMinutes: number;
	readonly policyDetailedDaySumMinutes: number;
	readonly policyId: string;
	readonly policyVersionId: string | null;
}

export interface ResolvedWorkPolicySchedule {
	readonly id: string;
	readonly scheduleCycle: "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
	readonly scheduleType: "simple" | "detailed";
	readonly workingDaysPreset: "weekdays" | "weekends" | "all_days" | "custom";
	readonly hoursPerCycle: string | null;
	readonly normalizedCycleMinutes: number | null;
	readonly homeOfficeDaysPerCycle: number;
	readonly days: readonly {
		readonly dayOfWeek: DayOfWeek;
		readonly hoursPerDay: string;
		readonly minutesPerDay: number;
		readonly isWorkDay: boolean;
		readonly cycleWeek: number;
		readonly latestClockIn: string | null;
	}[];
}

export interface ResolvedWorkPolicyBreakOption {
	readonly splitCount: number | null;
	readonly minimumSplitMinutes: number | null;
	readonly minimumLongestSplitMinutes: number | null;
}

export interface ResolvedWorkPolicyBreakRule {
	readonly id: string;
	readonly workingMinutesThreshold: number;
	readonly requiredBreakMinutes: number;
	readonly options: readonly ResolvedWorkPolicyBreakOption[];
}

export interface ResolvedWorkPolicyRegulation {
	readonly id: string;
	readonly maxDailyMinutes: number | null;
	readonly maxWeeklyMinutes: number | null;
	readonly maxUninterruptedMinutes: number | null;
	readonly minRestPeriodMinutes: number | null;
	readonly restPeriodEnforcement: "block" | "warn" | "none";
	readonly overtimeDailyThresholdMinutes: number | null;
	readonly overtimeWeeklyThresholdMinutes: number | null;
	readonly overtimeMonthlyThresholdMinutes: number | null;
	readonly alertBeforeLimitMinutes: number;
	readonly alertThresholdPercent: number;
	readonly breakRules: readonly ResolvedWorkPolicyBreakRule[];
}

export interface ResolvedWorkPolicyPresence {
	readonly id: string;
	readonly presenceMode: "minimum_count" | "fixed_days";
	readonly requiredOnsiteDays: number | null;
	readonly requiredOnsiteFixedDays: readonly DayOfWeek[] | null;
	readonly locationId: string | null;
	readonly evaluationPeriod: "weekly" | "biweekly" | "monthly";
	readonly enforcement: "block" | "warn" | "none";
}

export interface ResolvedWorkPolicyVersion {
	readonly policyId: string;
	readonly policyName: string;
	readonly policyVersionId: string | null;
	readonly versionNumber: number | null;
	readonly effectiveFromDate: string | null;
	/** Stable cycle anchor date preserved across non-schedule policy versions (A2-15/P7-2). */
	readonly scheduleAnchorDate?: string | null;
	readonly scheduleEnabled: boolean;
	readonly regulationEnabled: boolean;
	readonly presenceEnabled: boolean;
	readonly schedule: ResolvedWorkPolicySchedule | null;
	readonly regulation: ResolvedWorkPolicyRegulation | null;
	readonly presence: ResolvedWorkPolicyPresence | null;
	readonly assignmentType: "organization" | "team" | "employee";
	readonly assignmentId: string | null;
	readonly assignedVia: string;
}

export interface ResolvedOnCallTerms {
	readonly hoursKind: OnCallHoursKind;
	readonly weeklyMinutes: number | null;
	readonly statutoryFallbackWeeklyMinutes: number | null;
	readonly callInMinBandMinutes: number | null;
	readonly callInMaxBandMinutes: number | null;
	readonly dailyMinutes: number | null;
	readonly statutoryMinDailyMinutes: number;
}

export type EffectivePresenceStatus = "required" | "exempt" | "not_configured";

/**
 * The balance mode a resolved day carries: a contract's own mode, or `excluded`
 * on a day inside an External Contractor period, which keeps no work balance at
 * all (#1996). `excluded` is never stored on terms, templates or defaults.
 */
export type ResolvedBalanceMode = BalanceMode | "excluded";

/** The balance mode a resolved day's terms may store: `excluded` is never written. */
export function storedBalanceMode(mode: ResolvedBalanceMode): BalanceMode | null {
	return mode === "excluded" ? null : mode;
}

export interface EffectiveContractOnDay {
	readonly date: string;
	readonly dayOfWeek: DayOfWeek;
	readonly calendarTimezone: string;
	readonly employeeId: string;
	readonly employmentPeriodId: string | null;
	readonly isEmployedOnDay: boolean;
	/**
	 * The engagement kind of the stint in force on this day. A `contractor` day
	 * inherits no Org or Primary Team default contract and no work policy, keeps
	 * no work balance (`balanceMode: "excluded"`, zero required time) and has no
	 * employee statutory profile (#1996).
	 */
	readonly engagementKind: EngagementKind;
	readonly primaryTeamId: string | null;
	readonly employmentHistoryId: string | null;
	readonly contractDefaultId: string | null;
	readonly contractDefaultScope: "team" | "organization" | null;

	// Live-inherited operational rules
	readonly workPolicy: ResolvedWorkPolicyVersion | null;
	readonly workPolicySource: ContractFieldSource;
	readonly weeklyContractMinutes: number | null;
	readonly weeklyContractMinutesSource: ContractFieldSource;
	readonly scheduleMode: Exclude<ScheduleMode, "inherit">;
	readonly scheduleModeSource: ContractFieldSource;
	readonly workModel: WorkModel | null;
	readonly workModelSource: ContractFieldSource;
	readonly presenceOverride: PresenceOverride;
	readonly presenceOverrideSource: ContractFieldSource;
	readonly presenceStatus: EffectivePresenceStatus;
	readonly effectivePresence: ResolvedWorkPolicyPresence | null;
	readonly balanceMode: ResolvedBalanceMode;
	readonly balanceModeSource: ContractFieldSource;
	readonly scheduleSource: ScheduleSource;
	readonly scheduleSourceSource: ContractFieldSource;

	// Schedule evaluation for this day
	readonly isWorkDay: boolean;
	readonly requiredMinutes: number;
	readonly contributesZeroBalanceDelta: boolean;
	readonly latestClockIn: string | null;
	readonly weeklyScheduleDays: readonly ResolvedScheduleDay[];
	readonly mismatchWarning: WeeklyHoursMismatchWarning | null;

	// Employee-owned legal, pay, and statutory terms (never live-inherited)
	readonly contractType: ContractType;
	readonly hourlyRate: number | null;
	readonly currency: string;
	/** Null on a contractor day: an External Contractor has no employee statutory profile. */
	readonly employmentProfile: EmploymentProfile | null;
	readonly arbzgScope: ArbzgScope;
	readonly onCallTerms: ResolvedOnCallTerms | null;
	readonly migratedLegacyTerms: boolean;
}
