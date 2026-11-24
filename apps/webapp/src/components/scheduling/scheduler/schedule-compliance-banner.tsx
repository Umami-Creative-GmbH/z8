"use client";

import { IconAlertTriangle, IconChevronDown } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ScheduleComplianceSummary } from "@/lib/scheduling/compliance/types";
import type { ScheduleStatutoryFindings } from "@/lib/statutory/scheduling/findings-list";
import { cn } from "@/lib/utils";
import { outsideScopeText, StatutoryFindingsList } from "./statutory-findings-list";

interface ScheduleComplianceBannerProps {
	summary?: ScheduleComplianceSummary | null;
	/** The statutory findings behind the statutory count, for this viewer (#2026). */
	statutoryFindings?: ScheduleStatutoryFindings | null;
	/** The visible range, where a finding's calendar link opens. */
	dateRange?: DateRange;
	/** Employees with shifts in the visible range. */
	shiftEmployeeIds?: ReadonlySet<string>;
}

/**
 * The disclosure's label. Beside findings out of the viewer's reach it says the list holds only
 * some ("2 of 4"), so the gap to the statutory count is plain before the list is opened.
 */
function statutoryToggleLabel(
	shown: boolean,
	listed: number,
	outsideScope: number,
	t: ReturnType<typeof useTranslate>["t"],
): string {
	if (outsideScope > 0) {
		const params = { count: listed, total: listed + outsideScope };
		return shown
			? t(
					"scheduling:scheduling.statutory.findings.hideOfTotal",
					"Hide statutory findings ({count} of {total})",
					params,
				)
			: t(
					"scheduling:scheduling.statutory.findings.showOfTotal",
					"Show statutory findings ({count} of {total})",
					params,
				);
	}
	return shown
		? t("scheduling:scheduling.statutory.findings.hide", "Hide statutory findings ({count})", {
				count: listed,
			})
		: t("scheduling:scheduling.statutory.findings.show", "Show statutory findings ({count})", {
				count: listed,
			});
}

export function ScheduleComplianceBanner({
	summary,
	statutoryFindings,
	dateRange,
	shiftEmployeeIds,
}: ScheduleComplianceBannerProps) {
	const { t } = useTranslate();
	const [showStatutory, setShowStatutory] = useState(false);
	const listId = useId();

	if (!summary || summary.totalFindings === 0) {
		return null;
	}

	const listed = statutoryFindings?.items.length ?? 0;
	const outsideScope = statutoryFindings?.outsideScopeCount ?? 0;

	return (
		<Alert className="border-amber-300/70 bg-amber-50/60 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100">
			<IconAlertTriangle className="mt-0.5" aria-hidden="true" />
			<AlertTitle>
				{t("scheduling.scheduler.complianceBanner.title", "Compliance Warnings in This Date Range")}
			</AlertTitle>
			<AlertDescription className="space-y-2 text-amber-900/90 dark:text-amber-100/90">
				<p>
					{t(
						"scheduling.scheduler.complianceBanner.findingsDetected",
						"{count} finding(s) detected before publish.",
						{ count: summary.totalFindings },
					)}
				</p>
				<div className="flex flex-wrap gap-2">
					<Badge variant="outline" className="border-amber-400/60 bg-amber-100/70 text-amber-900">
						{t("scheduling.scheduler.complianceBanner.restTime", "Rest time: {count}", {
							count: summary.byType.restTime,
						})}
					</Badge>
					<Badge variant="outline" className="border-amber-400/60 bg-amber-100/70 text-amber-900">
						{t("scheduling.scheduler.complianceBanner.maxHours", "Max hours: {count}", {
							count: summary.byType.maxHours,
						})}
					</Badge>
					<Badge variant="outline" className="border-amber-400/60 bg-amber-100/70 text-amber-900">
						{t("scheduling.scheduler.complianceBanner.overtime", "Overtime: {count}", {
							count: summary.byType.overtime,
						})}
					</Badge>
					{summary.byType.statutory > 0 && (
						<Badge variant="outline" className="border-amber-400/60 bg-amber-100/70 text-amber-900">
							{t("scheduling.scheduler.complianceBanner.statutory", "Statutory limits: {count}", {
								count: summary.byType.statutory,
							})}
						</Badge>
					)}
				</div>
				{statutoryFindings && dateRange && listed > 0 && (
					<div className="space-y-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="-ml-2 h-auto px-2 py-1 text-amber-900 hover:bg-amber-100/80 dark:text-amber-100 dark:hover:bg-amber-900/40"
							aria-expanded={showStatutory}
							aria-controls={listId}
							onClick={() => setShowStatutory((shown) => !shown)}
						>
							<IconChevronDown
								className={cn(
									"size-4 transition-transform motion-reduce:transition-none",
									showStatutory && "rotate-180",
								)}
								aria-hidden="true"
							/>
							{statutoryToggleLabel(showStatutory, listed, outsideScope, t)}
						</Button>
						<StatutoryFindingsList
							id={listId}
							hidden={!showStatutory}
							findings={statutoryFindings}
							dateRange={dateRange}
							shiftEmployeeIds={shiftEmployeeIds}
						/>
					</div>
				)}
				{statutoryFindings && listed === 0 && outsideScope > 0 && (
					<p>{outsideScopeText(outsideScope, false, t)}</p>
				)}
			</AlertDescription>
		</Alert>
	);
}
