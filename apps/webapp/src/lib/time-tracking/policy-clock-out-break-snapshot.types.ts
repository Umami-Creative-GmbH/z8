export interface PolicyClockOutBreakRuleSnapshot {
	readonly id: string;
	readonly workingMinutesThreshold: number;
	readonly requiredBreakMinutes: number;
}

export type PolicyClockOutBreakSnapshotV1 =
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

export type PolicyClockOutBreakSnapshotV2 =
	| Readonly<{
			version: 2;
			evaluatedAt: string;
			resolution: "none";
			employmentPeriodId: string | null;
	  }>
	| Readonly<{
			version: 2;
			evaluatedAt: string;
			resolution: "work_policy";
			employmentPeriodId: string | null;
			policyVersionId: string;
			effectiveFromDate: string;
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

export type PolicyClockOutBreakSnapshot =
	| PolicyClockOutBreakSnapshotV1
	| PolicyClockOutBreakSnapshotV2;
