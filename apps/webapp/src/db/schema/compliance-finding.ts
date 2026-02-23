export type ComplianceFindingSeverity = "info" | "warning" | "critical";

export interface PresenceRequirementEvidence {
	type: "presence_requirement";
	mode: "minimum_count" | "fixed_days";
	evaluationStart: string;
	evaluationEnd: string;
	requiredDays: number;
	actualOnsiteDays: number;
	excludedDays: string[];
	excludedReasons: string[];
	onsiteWorkPeriodIds: string[];
	locationId: string | null;
	locationName: string | null;
	missedDays?: string[];
}
