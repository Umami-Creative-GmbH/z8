"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import { formatClosedMonthLabel } from "@/lib/time-tracking/closed-months/month-label";
import { ClosureStatusBadge } from "./closure-status-badge";
import { useMonthClosureStatuses } from "./use-month-closure-statuses";

/**
 * Closed, partly closed or open, for each month of a selection (#762): the
 * months of a report or payroll range, for the selected employees (every
 * employee of the organization when `employeeIds` is omitted).
 */
export function MonthClosureStrip({
	months,
	employeeIds,
}: {
	months: readonly string[];
	employeeIds?: readonly string[];
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const { data } = useMonthClosureStatuses(months, employeeIds);
	if (!data || data.length === 0) return null;

	return (
		<section
			aria-label={t("common:closedMonths.stripLabel", "Closed months")}
			className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
		>
			<span className="text-muted-foreground">
				{t("common:closedMonths.stripLabel", "Closed months")}
			</span>
			{data.map((status) => (
				<span key={status.month} className="flex items-center gap-2">
					<span className="tabular-nums">{formatClosedMonthLabel(status.month, locale)}</span>
					<ClosureStatusBadge status={status} />
				</span>
			))}
		</section>
	);
}
