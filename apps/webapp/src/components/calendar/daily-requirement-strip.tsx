"use client";

import { useTranslate } from "@tolgee/react";
import type { DateTime } from "luxon";
import type { DailyWorkHoursSummaries, DailyWorkHoursSummary } from "@/lib/calendar/types";
import { formatSignedMinutes, formatTimeHours } from "@/lib/calendar/work-hours-summary";
import { cn } from "@/lib/utils";

interface DailyRequirementStripProps {
	dates: DateTime[];
	summaries: DailyWorkHoursSummaries;
}

function getStatusClass(summary: DailyWorkHoursSummary | undefined): string {
	if (!summary) return "border-transparent text-transparent";
	if (summary.status === "under") return "border-red-500 text-red-950 dark:text-red-100";
	if (summary.status === "missing") return "border-muted text-muted-foreground";
	return "border-emerald-500 text-emerald-950 dark:text-emerald-100";
}

type Translate = ReturnType<typeof useTranslate>["t"];

function getStatusLabel(summary: DailyWorkHoursSummary, t: Translate): string {
	if (summary.status === "under") {
		return t("calendar.requirements.status.under", "under requirement");
	}
	if (summary.status === "missing") {
		return t("calendar.requirements.status.missing", "missing recorded time");
	}
	if (summary.status === "over") {
		return t("calendar.requirements.status.over", "over requirement");
	}
	return t("calendar.requirements.status.met", "requirement met");
}

export function DailyRequirementStrip({ dates, summaries }: DailyRequirementStripProps) {
	const { t } = useTranslate();

	if (dates.length === 0) return null;

	const hasAnyRequirement = dates.some((date) => summaries.has(date.toFormat("yyyy-MM-dd")));
	if (!hasAnyRequirement) return null;

	return (
		<div
			role="list"
			className="grid border-x border-t bg-background/80 text-right text-[11px] leading-tight tabular-nums"
			style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }}
			aria-label={t("calendar.requirements.summaryLabel", "Daily work policy requirement summary")}
		>
			{dates.map((date) => {
				const dateKey = date.toFormat("yyyy-MM-dd");
				const summary = summaries.get(dateKey);
				const requiredHours = summary ? formatTimeHours(summary.requiredMinutes) : "";
				const actualHours = summary ? formatTimeHours(summary.actualMinutes) : "";
				const deltaHours = summary ? formatSignedMinutes(summary.deltaMinutes) : "";
				const accessibleLabel = summary
					? t(
							"calendar.requirements.dayLabel",
							"{date}: {required} required, {actual} recorded, {delta} delta, {status}",
							{
								date: date.toFormat("cccc, LLLL d"),
								required: requiredHours,
								actual: actualHours,
								delta: deltaHours,
								status: getStatusLabel(summary, t),
							},
						)
					: undefined;

				return (
					<div
						key={dateKey}
						role="listitem"
						className={cn(
							"min-h-12 border-r border-t-4 px-3 py-2 last:border-r-0",
							getStatusClass(summary),
						)}
					>
						{summary ? (
							<>
								<span className="sr-only">{accessibleLabel}</span>
								<div className="font-semibold">{requiredHours}</div>
								{summary.status !== "met" && (
									<div className="text-muted-foreground">{deltaHours}</div>
								)}
							</>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
