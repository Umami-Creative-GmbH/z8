"use client";

import {
	IconAlertCircle,
	IconAlertTriangle,
	IconCircleCheck,
	IconConfetti,
} from "@tabler/icons-react";
import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PayrollPeriodDay, PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import { PayrollDayPanel, type PayrollDaySelection } from "./payroll-day-panel";
import { PayrollDaySettlement } from "./payroll-day-settlement";
import { PayrollDaysGrid } from "./payroll-days-grid";
import { payrollDaysFormat } from "./payroll-day-format";
import { PayrollDaysList } from "./payroll-days-list";
import { PayrollPlaceholderTab } from "./payroll-workspace-tabs";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";
import { usePayrollPeriod } from "./use-payroll-period";

const SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth", "sixth"] as const;

/**
 * The Days tab: credited hours per employee and local day, with required hours, the
 * difference, absences and holidays. Everything shown comes from the payroll period read.
 * A day opens a read-only side panel; below the mobile breakpoint the grid becomes a list
 * of days for one employee at a time (#1894).
 */
export function PayrollDaysTab({
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
	const locale = useLocale();
	const isMobile = useIsMobile();
	const format = useMemo(() => payrollDaysFormat(locale), [locale]);
	const { data, error, isPending } = usePayrollPeriod(request, refreshedAt);
	const [selection, setSelection] = useState<PayrollDaySelection | null>(null);
	const selectDay = (employee: PayrollPeriodEmployee, day: PayrollPeriodDay) =>
		setSelection({ employee, day });

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
				<AlertTitle>{t("payroll.days.loadFailed", "Hours per day could not be loaded")}</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
			</Alert>
		);
	}
	if (isPending || !data) {
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<span className="sr-only">{t("payroll.days.loading", "Loading hours per day")}</span>
				{SKELETON_ROWS.map((row) => (
					<Skeleton key={row} className="h-14 w-full" />
				))}
			</div>
		);
	}
	if (data.employees.length === 0) {
		return (
			<PayrollPlaceholderTab
				description={t("payroll.days.empty", "No employees in scope for this period.")}
			/>
		);
	}

	const dates = data.employees[0]?.days.map((day) => day.date) ?? [];
	// The open day follows refetches of the period, for example after unsettling it.
	const currentSelection = selection ? currentDay(data.employees, selection) : null;
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<PayrollDaysLegend t={t} />
			{isMobile ? (
				<PayrollDaysList employees={data.employees} format={format} onSelectDay={selectDay} t={t} />
			) : (
				<PayrollDaysGrid
					dates={dates}
					employees={data.employees}
					format={format}
					onSelectDay={selectDay}
					t={t}
				/>
			)}
			<PayrollDayPanel
				format={format}
				onClose={() => setSelection(null)}
				refreshedAt={refreshedAt}
				selection={currentSelection}
				settlementHistory={
					currentSelection ? (
						<PayrollDaySettlement
							day={currentSelection.day}
							employeeId={currentSelection.employee.id}
							format={format}
							t={t}
						/>
					) : null
				}
				t={t}
			/>
		</div>
	);
}

function currentDay(
	employees: readonly PayrollPeriodEmployee[],
	selection: PayrollDaySelection,
): PayrollDaySelection {
	const employee = employees.find((row) => row.id === selection.employee.id);
	const day = employee?.days.find((row) => row.date === selection.day.date);
	return employee && day ? { employee, day } : selection;
}

function PayrollDaysLegend({ t }: { t: PayrollTranslate }) {
	return (
		<p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
			<span>
				{t(
					"payroll.days.legend.hours",
					"Worked hours, then required hours and the difference. Days are each employee's local days.",
				)}
			</span>
			<span className="inline-flex items-center gap-1">
				<IconConfetti aria-hidden="true" className="size-3.5 text-amber-600" />
				{t("payroll.days.legend.holiday", "Holiday")}
			</span>
			<span className="inline-flex items-center gap-1">
				<IconCircleCheck
					aria-hidden="true"
					className="size-3.5 text-emerald-600 dark:text-emerald-400"
				/>
				{t("payroll.days.legend.settled", "Settled")}
			</span>
			<span className="inline-flex items-center gap-1">
				<IconAlertCircle
					aria-hidden="true"
					className="size-3.5 text-amber-600 dark:text-amber-400"
				/>
				{t("payroll.days.legend.changedSinceSettled", "Changed since settled")}
			</span>
			<span className="inline-flex items-center gap-1">
				<span
					aria-hidden="true"
					className="inline-block h-3 w-4 rounded-sm border"
					style={{
						backgroundImage:
							"repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklab, currentColor 30%, transparent) 3px 4px)",
					}}
				/>
				{t("payroll.days.legend.pending", "Pending absence")}
			</span>
		</p>
	);
}
