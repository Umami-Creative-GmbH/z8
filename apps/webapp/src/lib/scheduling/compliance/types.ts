import type { PlainDate } from "@/lib/datetime/temporal-core";

export type ScheduleComplianceFindingType = "restTime" | "maxHours" | "overtime";

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

export type ComplianceFinding = RestTimeFinding | MaxHoursFinding | OvertimeFinding;

export interface ScheduleComplianceSummary {
	totalFindings: number;
	byType: {
		restTime: number;
		maxHours: number;
		overtime: number;
	};
}

export interface ScheduleComplianceResult {
	findings: ComplianceFinding[];
	summary: ScheduleComplianceSummary;
}
