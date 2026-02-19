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

export interface ScheduleComplianceInput {
	timezone: string;
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
