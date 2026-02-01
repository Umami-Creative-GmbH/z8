"use client";

import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { useTranslate } from "@tolgee/react";
import { AlertCircle, Calendar, Loader2 } from "lucide-react";
import { previewNextExecutionsAction } from "@/app/[locale]/(app)/settings/scheduled-exports/actions";
import type { ScheduleType } from "@/lib/scheduled-exports/domain/types";

interface CronPreviewProps {
	scheduleType: ScheduleType;
	cronExpression?: string;
	timezone: string;
}

export function CronPreview({
	scheduleType,
	cronExpression,
	timezone,
}: CronPreviewProps) {
	const { t } = useTranslate();
	const [nextRuns, setNextRuns] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		// Only fetch if we have valid input
		if (scheduleType === "cron" && !cronExpression) {
			setNextRuns([]);
			setError(null);
			return;
		}

		const fetchPreview = async () => {
			setIsLoading(true);
			setError(null);

			try {
				const result = await previewNextExecutionsAction(
					scheduleType,
					cronExpression,
					timezone,
					5,
				);

				if (result.success) {
					setNextRuns(result.data);
				} else {
					setError(result.error || t("settings.scheduledExports.cronPreview.error", "Failed to calculate next runs"));
					setNextRuns([]);
				}
			} catch {
				setError(t("settings.scheduledExports.cronPreview.error", "Failed to calculate next runs"));
				setNextRuns([]);
			} finally {
				setIsLoading(false);
			}
		};

		// Debounce for cron expression changes
		const timer = setTimeout(fetchPreview, scheduleType === "cron" ? 500 : 0);
		return () => clearTimeout(timer);
	}, [scheduleType, cronExpression, timezone, t]);

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground py-2" role="status" aria-live="polite">
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
				<span>{t("settings.scheduledExports.cronPreview.loading", "Calculating next runs...")}</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center gap-2 text-sm text-destructive py-2" role="alert">
				<AlertCircle className="h-4 w-4" aria-hidden="true" />
				<span>{error}</span>
			</div>
		);
	}

	if (nextRuns.length === 0) {
		return null;
	}

	return (
		<div className="rounded-md border bg-muted/50 p-3 space-y-2" role="region" aria-label={t("settings.scheduledExports.cronPreview.region", "Scheduled runs preview")}>
			<div className="flex items-center gap-2 text-sm font-medium">
				<Calendar className="h-4 w-4" aria-hidden="true" />
				<span>{t("settings.scheduledExports.cronPreview.title", "Next 5 scheduled runs")}</span>
			</div>
			<ul className="space-y-1 text-sm text-muted-foreground" aria-label={t("settings.scheduledExports.cronPreview.listLabel", "List of next scheduled runs")}>
				{nextRuns.map((run) => {
					const dt = DateTime.fromISO(run).setZone(timezone);
					return (
						<li key={run} className="flex items-center gap-2">
							<span className="w-2 h-2 rounded-full bg-primary/50" aria-hidden="true" />
							{dt.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
