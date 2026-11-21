"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import type { PayrollSettlementCounts } from "@/app/[locale]/(app)/payroll/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { payrollHoursFormat } from "@/lib/payroll-workspace/hours-format";
import type { PayrollTranslate } from "./state";

/**
 * The counts before settling: days settled now, already settled, the days left out, the
 * warnings for pending absences and months not closed, and the days and hours per
 * employee. Also before confirming an export as paid (#1899), which reports no skips.
 */
export function SettlePreview({
	preview,
	t,
}: {
	preview: PayrollSettlementCounts;
	t: PayrollTranslate;
}) {
	return (
		<div className="flex flex-col gap-3 text-sm">
			<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
				<dt>{t("payroll.settle.newDays", "Newly settled days")}</dt>
				<dd className="text-right font-medium">{preview.newDays}</dd>
				<dt>{t("payroll.settle.alreadySettledDays", "Already settled, left as they are")}</dt>
				<dd className="text-right font-medium">{preview.alreadySettledDays}</dd>
				{preview.previouslyUnsettledDays ? (
					<>
						<dt>
							{t(
								"payroll.confirmPaid.previouslyUnsettledDays",
								"Unsettled since this file was confirmed, skipped",
							)}
						</dt>
						<dd className="text-right font-medium">{preview.previouslyUnsettledDays}</dd>
					</>
				) : null}
				{preview.skippedWithoutEntriesDays ? (
					<>
						<dt>
							{t("payroll.settle.skippedWithoutEntriesDays", "Days without entries, never settled")}
						</dt>
						<dd className="text-right font-medium">{preview.skippedWithoutEntriesDays}</dd>
					</>
				) : null}
				{preview.skippedPendingAbsenceDays ? (
					<>
						<dt>
							{t("payroll.settle.skippedPendingAbsenceDays", "Days with pending absences, skipped")}
						</dt>
						<dd className="text-right font-medium">{preview.skippedPendingAbsenceDays}</dd>
					</>
				) : null}
				{preview.skippedUnclosedMonthDays ? (
					<>
						<dt>
							{t("payroll.settle.skippedUnclosedMonthDays", "Days in months not closed, skipped")}
						</dt>
						<dd className="text-right font-medium">{preview.skippedUnclosedMonthDays}</dd>
					</>
				) : null}
			</dl>
			{preview.pendingAbsenceDays ? (
				<Alert>
					<IconAlertTriangle aria-hidden="true" />
					<AlertTitle>{t("payroll.settle.pendingTitle", "Pending absences")}</AlertTitle>
					<AlertDescription>
						{t(
							"payroll.settle.pendingDescription",
							"{count} of these days have an absence that is still pending. Settling does not pay it; if it is approved later, the day shows as changed since settled.",
							{ count: preview.pendingAbsenceDays },
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{preview.unclosedMonths.length > 0 ? (
				<Alert>
					<IconAlertTriangle aria-hidden="true" />
					<AlertTitle>{t("payroll.settle.unclosedTitle", "Months not closed")}</AlertTitle>
					<AlertDescription>
						{t(
							"payroll.settle.unclosedDescription",
							"{count} of these days are in months that are not closed, so their data can still change: {months}. You can settle them anyway.",
							{
								count: preview.unclosedMonths.reduce((sum, month) => sum + month.days, 0),
								months: preview.unclosedMonths.map((month) => month.month).join(", "),
							},
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{preview.employees && preview.employees.length > 0 ? (
				<SettleBreakdown employees={preview.employees} t={t} />
			) : null}
		</div>
	);
}

function SettleBreakdown({
	employees,
	t,
}: {
	employees: NonNullable<PayrollSettlementCounts["employees"]>;
	t: PayrollTranslate;
}) {
	const locale = useLocale();
	const hours = useMemo(() => payrollHoursFormat(locale), [locale]);
	return (
		<div className="max-h-56 overflow-y-auto rounded-md border">
			<table className="w-full text-sm tabular-nums">
				<caption className="sr-only">
					{t("payroll.settle.breakdownCaption", "Days and hours to settle per employee")}
				</caption>
				<thead className="sticky top-0 bg-muted text-muted-foreground text-xs">
					<tr>
						<th scope="col" className="px-3 py-1.5 text-left font-medium">
							{t("payroll.settle.breakdownEmployee", "Employee")}
						</th>
						<th scope="col" className="px-3 py-1.5 text-right font-medium">
							{t("payroll.settle.breakdownDays", "Days")}
						</th>
						<th scope="col" className="px-3 py-1.5 text-right font-medium">
							{t("payroll.settle.breakdownHours", "Hours")}
						</th>
					</tr>
				</thead>
				<tbody className="divide-y">
					{employees.map((employee) => (
						<tr key={employee.employeeId}>
							<th scope="row" className="max-w-0 truncate px-3 py-1.5 text-left font-normal">
								{employee.name}
							</th>
							<td className="px-3 py-1.5 text-right">{employee.days}</td>
							<td className="px-3 py-1.5 text-right">{hours.minutes(employee.creditedMinutes)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
