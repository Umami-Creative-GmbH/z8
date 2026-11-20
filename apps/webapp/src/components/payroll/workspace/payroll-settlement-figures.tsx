"use client";

import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import { StatusFigure } from "./payroll-status-strip";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";
import { usePayrollPeriod } from "./use-payroll-period";

/**
 * The status strip's settled, changed-since-settled (#1897) and unsettled
 * employee-days of the period (#1896). Changed days are among the settled ones.
 */
export function PayrollSettlementFigures({
	filtersHaveNoMatches,
	refreshedAt,
	request,
	t,
}: {
	filtersHaveNoMatches: boolean;
	refreshedAt: string;
	request: PayrollPeriodRequest;
	t: PayrollTranslate;
}) {
	const { data } = usePayrollPeriod(request, refreshedAt);
	const settlement = filtersHaveNoMatches
		? { settledDays: 0, changedSinceSettledDays: 0, unsettledDays: 0 }
		: data?.settlement;
	return (
		<>
			<StatusFigure
				icon={<IconCircleCheck aria-hidden="true" className="size-4" />}
				label={t("payroll.summary.settledDays", "Settled days")}
				value={settlement ? settlement.settledDays.toString() : "–"}
			/>
			{settlement && settlement.changedSinceSettledDays > 0 ? (
				<StatusFigure
					icon={
						<IconAlertCircle
							aria-hidden="true"
							className="size-4 text-amber-600 dark:text-amber-400"
						/>
					}
					label={t("payroll.summary.changedSinceSettledDays", "Changed since settled")}
					value={settlement.changedSinceSettledDays.toString()}
				/>
			) : null}
			<StatusFigure
				label={t("payroll.summary.unsettledDays", "Unsettled days")}
				value={settlement ? settlement.unsettledDays.toString() : "–"}
			/>
		</>
	);
}
