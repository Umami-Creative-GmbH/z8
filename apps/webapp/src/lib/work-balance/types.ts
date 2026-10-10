export interface EmployeeWorkBalancePayload {
	employeeId: string;
	organizationId: string;
	actualMinutes: number;
	requiredMinutes: number;
	/** Uncancelled balance adjustments counted in `balanceMinutes` (#993). */
	adjustmentMinutes: number;
	/** actual - required + adjustments, through `computedThroughDate`. */
	balanceMinutes: number;
	computedFromDate: string;
	computedThroughDate: string;
	computedAt: Date;
}

export type WorkBalanceStatus = "positive" | "neutral" | "negative";
