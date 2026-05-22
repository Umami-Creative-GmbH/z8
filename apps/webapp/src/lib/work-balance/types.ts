export interface EmployeeWorkBalancePayload {
	employeeId: string;
	organizationId: string;
	actualMinutes: number;
	requiredMinutes: number;
	balanceMinutes: number;
	computedFromDate: string;
	computedThroughDate: string;
	computedAt: Date;
}

export type WorkBalanceStatus = "positive" | "neutral" | "negative";
