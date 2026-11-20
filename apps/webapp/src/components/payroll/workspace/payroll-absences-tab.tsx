"use client";

import { IconAlertTriangle, IconHourglassHigh } from "@tabler/icons-react";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
	PayrollAbsenceCalendar,
	type PayrollAbsenceLegendCategory,
	PENDING_HATCH,
	payrollAbsenceLegend,
} from "./payroll-absence-calendar";
import { PayrollAbsenceList, payrollAbsenceListFormat } from "./payroll-absence-list";
import { payrollDaysFormat } from "./payroll-days-grid";
import { PayrollPlaceholderTab } from "./payroll-workspace-tabs";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";
import { usePayrollPeriod } from "./use-payroll-period";

const SKELETON_ROWS = ["first", "second", "third", "fourth"] as const;

/**
 * The Absences tab: the period's absences as a calendar of employees against days and
 * as a list. Everything shown comes from the payroll period read, whose absence dates
 * are the employees' own local days and whose scope is the payroll access grant's.
 */
export function PayrollAbsencesTab({
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
	const daysFormat = useMemo(() => payrollDaysFormat(locale), [locale]);
	const listFormat = useMemo(() => payrollAbsenceListFormat(locale), [locale]);
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
				<AlertTitle>{t("payroll.absences.loadFailed", "Absences could not be loaded")}</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
			</Alert>
		);
	}
	if (isPending || !data) {
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<span className="sr-only">{t("payroll.absences.loading", "Loading absences")}</span>
				{SKELETON_ROWS.map((row) => (
					<Skeleton key={row} className="h-10 w-full" />
				))}
			</div>
		);
	}
	if (data.absences.length === 0) {
		return (
			<PayrollPlaceholderTab
				description={t("payroll.absences.empty", "No absences in this period.")}
			/>
		);
	}

	const dates = data.employees[0]?.days.map((day) => day.date) ?? [];
	const employeeNames = new Map(data.employees.map((employee) => [employee.id, employee.name]));
	const pendingCount = data.absences.filter(
		(absence) => absence.approvalState === "pending",
	).length;

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<section className="flex min-w-0 flex-col gap-3" aria-labelledby="payroll-absence-calendar">
				<h2 id="payroll-absence-calendar" className="font-semibold text-base">
					{t("payroll.absences.calendarTitle", "Absence calendar")}
				</h2>
				<PayrollAbsenceLegend
					categories={payrollAbsenceLegend(data.absences)}
					pendingCount={pendingCount}
					t={t}
				/>
				<PayrollAbsenceCalendar
					dates={dates}
					employees={data.employees}
					format={daysFormat}
					t={t}
				/>
			</section>
			<section className="flex min-w-0 flex-col gap-3" aria-labelledby="payroll-absence-list">
				<h2 id="payroll-absence-list" className="font-semibold text-base">
					{t("payroll.absences.listTitle", "Absence list")}
				</h2>
				<PayrollAbsenceList
					absences={data.absences}
					employeeNames={employeeNames}
					format={listFormat}
					t={t}
				/>
			</section>
		</div>
	);
}

function PayrollAbsenceLegend({
	categories,
	pendingCount,
	t,
}: {
	categories: readonly PayrollAbsenceLegendCategory[];
	pendingCount: number;
	t: PayrollTranslate;
}) {
	return (
		<div className="flex flex-col gap-2 text-xs">
			<ul
				className="flex flex-wrap items-center gap-x-4 gap-y-1"
				aria-label={t("payroll.absences.legendLabel", "Absence categories")}
			>
				{categories.map((category) => (
					<li key={category.categoryId} className="inline-flex items-center gap-1.5">
						<span
							aria-hidden="true"
							className="inline-block size-3 rounded-sm"
							style={{ backgroundColor: category.color }}
						/>
						{category.categoryName}
					</li>
				))}
			</ul>
			<p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
				<span className="inline-flex items-center gap-1.5">
					<span aria-hidden="true" className="inline-flex h-3 w-4 gap-px">
						<span className="flex-1 rounded-l-sm bg-muted-foreground/60" />
						<span className="flex-1 rounded-r-sm border border-dashed border-muted-foreground/40" />
					</span>
					{t("payroll.absences.legend.halves", "Left half morning (AM), right half afternoon (PM)")}
				</span>
				<span className="inline-flex items-center gap-1.5">
					<span
						aria-hidden="true"
						className="inline-block h-3 w-4 rounded-sm bg-muted-foreground/60 outline-1 outline-dashed outline-muted-foreground"
						style={{ backgroundImage: PENDING_HATCH }}
					/>
					{t("payroll.absences.legend.pending", "Pending, not approved yet")}
				</span>
				{pendingCount > 0 ? (
					<span className="inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-300">
						<IconHourglassHigh aria-hidden="true" className="size-3.5" />
						{t(
							"payroll.absences.pendingCount",
							"{count, plural, one {# pending absence blocks payroll} other {# pending absences block payroll}}",
							{ count: pendingCount },
						)}
					</span>
				) : null}
			</p>
		</div>
	);
}
