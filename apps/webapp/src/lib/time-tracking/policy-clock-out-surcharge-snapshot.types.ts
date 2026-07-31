export interface OrdinarySurchargeRuleSnapshot {
	readonly id: string;
	readonly name: string;
	readonly ruleType: "time_window" | "day_of_week" | "date_based";
	readonly percentage: string;
	readonly dayOfWeek:
		| "monday"
		| "tuesday"
		| "wednesday"
		| "thursday"
		| "friday"
		| "saturday"
		| "sunday"
		| null;
	readonly windowStartTime: string | null;
	readonly windowEndTime: string | null;
	readonly specificDate: string | null;
	readonly dateRangeStart: string | null;
	readonly dateRangeEnd: string | null;
	readonly priority: number;
	readonly validFrom: string | null;
	readonly validUntil: string | null;
}

export type OrdinarySurchargeSnapshot = Readonly<{
	version: 1;
	evaluatedAt: string;
	resolution:
		| Readonly<{ kind: "none" }>
		| Readonly<{
				kind: "surcharge_model";
				teamId: string | null;
				assignmentId: string;
				assignmentType: "employee" | "team" | "organization";
				assignmentPriority: number;
				modelId: string;
				modelName: string;
				rules: readonly Readonly<OrdinarySurchargeRuleSnapshot>[];
		  }>;
}>;

export type PolicyClockOutSurchargeRuleSnapshot = OrdinarySurchargeRuleSnapshot;
export type PolicyClockOutSurchargeSnapshot = OrdinarySurchargeSnapshot;
