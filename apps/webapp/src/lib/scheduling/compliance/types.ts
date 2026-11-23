import type { PlainDate } from "@/lib/datetime/temporal-core";
import type { StatutoryFindingSummary, StatutorySeverity } from "@/lib/statutory/finding";
import type { StatutoryDomain } from "@/lib/statutory/threshold-catalog";

export type ScheduleComplianceFindingType = "restTime" | "maxHours" | "overtime" | "statutory";

export interface ScheduleComplianceRegulation {
	minRestPeriodMinutes?: number;
	maxDailyMinutes?: number;
	overtimeDailyThresholdMinutes?: number;
	overtimeWeeklyThresholdMinutes?: number;
	overtimeMonthlyThresholdMinutes?: number;
}

export interface RestTransitionInterval {
	fromEndIso: string;
	toStartIso: string;
}

export interface EmployeeScheduleComplianceInput {
	employeeId: string;
	actualMinutesByDay: Record<string, number>;
	scheduledMinutesByDay: Record<string, number>;
	restTransitions: RestTransitionInterval[];
}

/**
 * The organization-local calendar days `[start, endExclusive)` being judged. Days before `start`
 * are lookback: they count toward weekly and monthly totals and the first rest gap, but get no
 * findings of their own.
 */
export interface ScheduleComplianceWindow {
	start: PlainDate;
	endExclusive: PlainDate;
}

export interface ScheduleComplianceInput {
	timezone: string;
	window: ScheduleComplianceWindow;
	regulation: ScheduleComplianceRegulation;
	employees: EmployeeScheduleComplianceInput[];
}

export interface RestTimeFinding {
	type: "restTime";
	employeeId: string;
	fromEndIso: string;
	toStartIso: string;
	restMinutes: number;
	minRestPeriodMinutes: number;
}

export interface MaxHoursFinding {
	type: "maxHours";
	employeeId: string;
	day: string;
	totalMinutes: number;
	maxDailyMinutes: number;
}

export interface OvertimeFinding {
	type: "overtime";
	employeeId: string;
	period: "daily" | "weekly" | "monthly";
	periodKey: string;
	totalMinutes: number;
	thresholdMinutes: number;
}

/**
 * A German statutory monitor finding (#1988 seam for #1989–#1993), projected for Scheduling and
 * Staffing: managers and planners see it, so it carries the wage-free summary only. The pure
 * evaluator never produces it; `evaluateStatutoryScheduleFindings` contributors do.
 */
export interface StatutoryComplianceFinding {
	type: "statutory";
	employeeId: string;
	/** `StatutoryFinding.id`: kind, employee and subject. */
	findingId: string;
	/** Monitor-specific kind, e.g. `minijob_monthly_cap`. */
	statutoryKind: string;
	domain: StatutoryDomain;
	severity: StatutorySeverity;
	subjectKey: string;
	legalReference: string;
	summary: StatutoryFindingSummary;
	/** Null when the finding cannot be acknowledged. */
	acknowledgementStatus: "none" | "current" | "stale" | null;
	/** True when the organization blocks publishing this finding (JArbSchG hard limits). */
	blocksPublication: boolean;
}

export type ComplianceFinding =
	| RestTimeFinding
	| MaxHoursFinding
	| OvertimeFinding
	| StatutoryComplianceFinding;

export interface ScheduleComplianceSummary {
	totalFindings: number;
	byType: {
		restTime: number;
		maxHours: number;
		overtime: number;
		statutory: number;
	};
}

export interface ScheduleComplianceResult {
	findings: ComplianceFinding[];
	summary: ScheduleComplianceSummary;
}
