"use client";

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

function getStatusLabel(summary: DailyWorkHoursSummary): string {
	if (summary.status === "under") return "under requirement";
	if (summary.status === "missing") return "missing recorded time";
	if (summary.status === "over") return "over requirement";
	return "requirement met";
}

export function DailyRequirementStrip({ dates, summaries }: DailyRequirementStripProps) {
	if (dates.length === 0) return null;

	const hasAnyRequirement = dates.some((date) => summaries.has(date.toFormat("yyyy-MM-dd")));
	if (!hasAnyRequirement) return null;

	return (
		<div
			className="grid border-x border-t bg-background/80 text-right text-[11px] leading-tight tabular-nums"
			style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }}
			aria-label="Daily work policy requirement summary"
		>
			{dates.map((date) => {
				const dateKey = date.toFormat("yyyy-MM-dd");
				const summary = summaries.get(dateKey);

				return (
					<div
						key={dateKey}
						className={cn(
							"min-h-12 border-r border-t-4 px-3 py-2 last:border-r-0",
							getStatusClass(summary),
						)}
						aria-label={
							summary
								? `${date.toFormat("cccc, LLLL d")}: ${formatTimeHours(summary.requiredMinutes)} required, ${getStatusLabel(summary)}`
								: undefined
						}
					>
						{summary ? (
							<>
								<div className="font-semibold">{formatTimeHours(summary.requiredMinutes)}</div>
								{summary.actualMinutes > 0 && (
									<div className="text-muted-foreground">
										{formatSignedMinutes(summary.deltaMinutes)}
									</div>
								)}
							</>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
