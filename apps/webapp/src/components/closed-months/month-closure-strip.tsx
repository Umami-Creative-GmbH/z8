"use client";

import { useQuery } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { getMonthClosureStatuses } from "@/app/[locale]/(app)/settings/closed-months/actions";
import { ClosureStatusBadge } from "./closure-status-badge";
import { formatClosedMonthLabel } from "@/lib/time-tracking/closed-months/month-label";

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
	const { data } = useQuery({
		queryKey: ["closed-months", "statuses", months, employeeIds ?? null],
		queryFn: async () => {
			const result = await getMonthClosureStatuses({
				months: [...months],
				employeeIds: employeeIds ? [...employeeIds] : undefined,
			});
			return result.success ? result.data : [];
		},
		enabled: months.length > 0,
		staleTime: 30_000,
	});
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
