"use client";

import { useTranslate } from "@tolgee/react";
import { useLiveWorkNow } from "@/hooks/use-live-work-now";
import { useTimeSummaryClockSync } from "@/hooks/use-time-summary-clock-sync";
import {
	summarizeTimeKpis,
	type TimeKpiRead,
} from "@/lib/time-tracking/time-kpis";
import { formatDuration } from "@/lib/time-tracking/time-utils";

/** Same live UTC basis as the summary strip; completed work and the current work both count. */
export function ClockDayTotal({ data }: { data: TimeKpiRead }) {
	const { t } = useTranslate();
	const matchesClock = useTimeSummaryClockSync(data);
	const now = useLiveWorkNow(data.basis.liveWork);
	const today = (now ? summarizeTimeKpis(data.basis, now) : data.kpis).today;
	return (
		<div className="space-y-2">
			<p className="text-sm text-muted-foreground">
				{t("timeTracking.summary.today", "Today")}
			</p>
			<p
				role="status"
				className={
					matchesClock
						? "text-3xl font-semibold tracking-tight tabular-nums"
						: "text-sm text-muted-foreground"
				}
			>
				{matchesClock
					? formatDuration(today.workedMinutes)
					: t(
							"timeTracking.summary.updating",
							"Updating total… Use Refresh to retry if it remains unavailable.",
						)}
			</p>
			{matchesClock ? (
				<p className="text-sm text-muted-foreground">
					{today.requiredMinutes === null
						? t(
								"timeTracking.summary.noRequiredToday",
								"No required time today",
							)
						: t(
								"timeTracking.summary.todayOfRequired",
								"{worked} of {required}",
								{
									worked: formatDuration(today.workedMinutes),
									required: formatDuration(today.requiredMinutes),
								},
							)}
				</p>
			) : null}
		</div>
	);
}
