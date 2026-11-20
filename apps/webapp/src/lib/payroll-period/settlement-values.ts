import type {
	PayrollPeriodDay,
	PayrollPeriodDaySettlement,
	PayrollSettledDaySource,
	PayrollSettledDayValues,
} from "./types";

/**
 * The values settling a day pays and keeps a copy of (#1896): its credited minutes
 * and its approved absences. A pending absence has not been paid, so approving it
 * later changes the day. Absences are sorted, so equal days give equal copies.
 */
export function settledDayValues(day: PayrollPeriodDay): PayrollSettledDayValues {
	return {
		creditedMinutes: day.creditedMinutes,
		absences: day.absences
			.filter((absence) => absence.approvalState === "approved")
			.map((absence) => ({
				categoryId: absence.categoryId,
				categoryName: absence.categoryName,
				categoryType: absence.categoryType,
				period: absence.period,
			}))
			.toSorted(
				(left, right) =>
					compare(left.categoryId, right.categoryId) || compare(left.period, right.period),
			),
	};
}

/** A day's settlement state from its active settlement, if any. */
export function daySettlement(
	source: PayrollSettledDaySource | undefined,
): PayrollPeriodDaySettlement {
	if (!source) return { state: "unsettled" };
	return {
		state: "settled",
		settledDayId: source.id,
		method: source.method,
		payrollExportJobId: source.payrollExportJobId,
		settledAt: source.settledAt,
		paid: source.paid,
	};
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
