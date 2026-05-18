export type EmployeeTimeBalancePayload = {
	year: number;
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
	balanceMinutes: number;
	calculatedAt: Date;
};
