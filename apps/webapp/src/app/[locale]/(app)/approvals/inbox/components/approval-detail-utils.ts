interface TravelExpenseDetailEntity {
	tripStart: Date | string;
	tripEnd: Date | string;
	destinationCity: string | null;
	calculatedCurrency: string;
	calculatedAmount: string;
	notes: string | null;
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function normalizeTravelExpenseDetailEntity(entity: TravelExpenseDetailEntity) {
	return {
		...entity,
		tripStart: toDate(entity.tripStart),
		tripEnd: toDate(entity.tripEnd),
	};
}

export type { TravelExpenseDetailEntity };
export { normalizeTravelExpenseDetailEntity };
