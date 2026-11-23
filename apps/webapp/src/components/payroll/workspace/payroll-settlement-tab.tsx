"use client";

import { IconAlertCircle, IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { PayrollSettleForm } from "./payroll-settle-form";
import { countSettlementDays } from "./payroll-settlement-counts";
import { PayrollSettlementHistory } from "./payroll-settlement-history";
import { StatusFigure } from "./payroll-status-strip";
import { PayrollPlaceholderTab } from "./payroll-workspace-tabs";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";
import { usePayrollPeriod } from "./use-payroll-period";

/**
 * The Settlement tab: settling days by hand (#1896) for the workspace's period and
 * scope. How many days are settled, unsettled, changed since settled or without entries;
 * a form to settle or unsettle a range of days for all or some employees; and the
 * settlement history. Confirming an export as paid stays on the Export tab.
 */
export function PayrollSettlementTab({
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
	const { data, error, isPending } = usePayrollPeriod(request, refreshedAt);

	if (filtersHaveNoMatches) {
		return (
			<PayrollPlaceholderTab
				description={t(
					"payroll.filters.noMatchingEmployees",
					"No employees match the selected payroll filters.",
				)}
			/>
		);
	}
	if (error) {
		return (
			<Alert variant="destructive">
				<IconAlertTriangle aria-hidden="true" />
				<AlertTitle>
					{t("payroll.settle.loadFailed", "The days to settle could not be loaded")}
				</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
			</Alert>
		);
	}
	if (isPending || !data) {
		return (
			<div className="flex flex-col gap-3" aria-busy="true">
				<span className="sr-only">{t("payroll.settle.loading", "Loading the days to settle")}</span>
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-72 w-full" />
			</div>
		);
	}

	const counts = countSettlementDays(data.employees, request);
	return (
		<div className="flex flex-col gap-6">
			<section
				aria-label={t("payroll.settle.countsLabel", "Days of this period by settlement")}
				className="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0"
			>
				<StatusFigure
					icon={
						<IconCircleCheck
							aria-hidden="true"
							className="size-4 text-emerald-600 dark:text-emerald-400"
						/>
					}
					label={t("payroll.settle.countSettled", "Settled")}
					value={counts.settledDays.toString()}
				/>
				<StatusFigure
					icon={
						<IconAlertCircle
							aria-hidden="true"
							className="size-4 text-amber-600 dark:text-amber-400"
						/>
					}
					label={t("payroll.settle.countChanged", "Changed since settled")}
					value={counts.changedSinceSettledDays.toString()}
				/>
				<StatusFigure
					label={t("payroll.settle.countUnsettled", "Unsettled, with entries")}
					value={counts.unsettledDays.toString()}
				/>
				<StatusFigure
					label={t("payroll.settle.countWithoutEntries", "Without entries, not settleable")}
					value={counts.withoutEntriesDays.toString()}
				/>
			</section>
			<PayrollSettleForm
				key={JSON.stringify([request.startDate, request.endDate, request.employeeIds])}
				employees={data.employees}
				request={request}
				t={t}
			/>
			<PayrollSettlementHistory
				employeeNames={new Map(data.employees.map((employee) => [employee.id, employee.name]))}
				request={request}
				t={t}
			/>
		</div>
	);
}
