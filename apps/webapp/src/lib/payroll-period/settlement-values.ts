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

/**
 * A day's settlement state from its active settlement, if any (#1896). The day is
 * changed since settled (#1897) when its current values differ from the copy taken
 * at settling: other credited minutes, or an approved absence added, removed, or
 * with another category or day period. A renamed category is not a change.
 */
export function daySettlement(
	source: PayrollSettledDaySource | undefined,
	day: PayrollPeriodDay,
): PayrollPeriodDaySettlement {
	if (!source) return { state: "unsettled" };
	const settled = {
		settledDayId: source.id,
		method: source.method,
		payrollExportJobId: source.payrollExportJobId,
		settledAt: source.settledAt,
		paid: source.paid,
	};
	const current = settledDayValues(day);
	const creditedMinutesDifference = current.creditedMinutes - source.paid.creditedMinutes;
	const absencesChanged = absenceKeys(current.absences) !== absenceKeys(source.paid.absences);
	if (creditedMinutesDifference === 0 && !absencesChanged) return { state: "settled", ...settled };
	return {
		state: "changed_since_settled",
		...settled,
		change: { current, creditedMinutesDifference, absencesChanged },
	};
}

function absenceKeys(absences: PayrollSettledDayValues["absences"]): string {
	return absences
		.map((absence) => `${absence.categoryId}:${absence.period}`)
		.toSorted()
		.join("|");
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
