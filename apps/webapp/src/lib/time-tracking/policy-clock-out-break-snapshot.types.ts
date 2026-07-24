export interface PolicyClockOutBreakRuleSnapshot {
	readonly id: string;
	readonly workingMinutesThreshold: number;
	readonly requiredBreakMinutes: number;
}

export type PolicyClockOutBreakSnapshot =
	| Readonly<{
			version: 1;
			evaluatedAt: string;
			resolution: "none";
	  }>
	| Readonly<{
			version: 1;
			evaluatedAt: string;
			resolution: "work_policy";
			teamId: string | null;
			assignment: Readonly<{
				id: string;
				type: "employee" | "team" | "organization";
			}>;
			policy: Readonly<{ id: string; name: string }>;
			regulationEnabled: boolean;
			regulation: Readonly<{
				id: string | null;
				name: string | null;
				maxUninterruptedMinutes: number | null;
			}>;
			breakRules: readonly Readonly<PolicyClockOutBreakRuleSnapshot>[];
	  }>;
