"use client";

import { IconCircleCheck } from "@tabler/icons-react";
import { StatusFigure } from "./payroll-status-strip";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";
import { usePayrollPeriod } from "./use-payroll-period";

/** The status strip's settled and unsettled employee-days of the period (#1896). */
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
	const settlement = filtersHaveNoMatches ? { settledDays: 0, unsettledDays: 0 } : data?.settlement;
	return (
		<>
			<StatusFigure
				icon={<IconCircleCheck aria-hidden="true" className="size-4" />}
				label={t("payroll.summary.settledDays", "Settled days")}
				value={settlement ? settlement.settledDays.toString() : "–"}
			/>
			<StatusFigure
				label={t("payroll.summary.unsettledDays", "Unsettled days")}
				value={settlement ? settlement.unsettledDays.toString() : "–"}
			/>
		</>
	);
}
