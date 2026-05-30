"use client";

import { IconAlertCircle, IconCalendar, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { previewNextExecutionsAction } from "@/app/[locale]/(app)/settings/scheduled-exports/actions";
import type { ScheduleType } from "@/lib/scheduled-exports/domain/types";

interface CronPreviewProps {
	scheduleType: ScheduleType;
	cronExpression?: string;
	timezone: string;
}

export function CronPreview({ scheduleType, cronExpression, timezone }: CronPreviewProps) {
	const { t } = useTranslate();
	const hasValidInput = scheduleType !== "cron" || Boolean(cronExpression);
	const [nextRuns, setNextRuns] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!hasValidInput) {
			return;
		}

		const fetchPreview = async () => {
			setIsLoading(true);
			setError(null);

			const result = await previewNextExecutionsAction(
				scheduleType,
				cronExpression,
				timezone,
				5,
			).then(
				(response) => response,
				() => null,
			);

			if (!result) {
				setError(t("settings.scheduledExports.cronPreview.error", "Failed to calculate next runs"));
				setNextRuns([]);
				setIsLoading(false);
				return;
			}

			if (result.success) {
				setNextRuns(result.data);
			} else {
				setError(
					result.error ||
						t("settings.scheduledExports.cronPreview.error", "Failed to calculate next runs"),
				);
				setNextRuns([]);
			}

			setIsLoading(false);
		};

		// Debounce for cron expression changes
		const timer = setTimeout(fetchPreview, scheduleType === "cron" ? 500 : 0);
		return () => clearTimeout(timer);
	}, [hasValidInput, scheduleType, cronExpression, timezone, t]);

	const displayError = hasValidInput ? error : null;
	const displayRuns = hasValidInput ? nextRuns : [];

	if (isLoading) {
		return (
			<div
				className="flex items-center gap-2 text-sm text-muted-foreground py-2"
				role="status"
				aria-live="polite"
			>
				<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
				<span>
					{t("settings.scheduledExports.cronPreview.loading", "Calculating next runs...")}
				</span>
			</div>
		);
	}

	if (displayError) {
		return (
			<div className="flex items-center gap-2 text-sm text-destructive py-2" role="alert">
				<IconAlertCircle className="size-4" aria-hidden="true" />
				<span>{displayError}</span>
			</div>
		);
	}

	if (displayRuns.length === 0) {
		return null;
	}

	return (
		<div
			className="rounded-md border bg-muted/50 p-3 space-y-2"
			role="region"
			aria-label={t("settings.scheduledExports.cronPreview.region", "Scheduled runs preview")}
		>
			<div className="flex items-center gap-2 text-sm font-medium">
				<IconCalendar className="size-4" aria-hidden="true" />
				<span>{t("settings.scheduledExports.cronPreview.title", "Next 5 scheduled runs")}</span>
			</div>
			<ul
				className="space-y-1 text-sm text-muted-foreground"
				aria-label={t(
					"settings.scheduledExports.cronPreview.listLabel",
					"List of next scheduled runs",
				)}
			>
				{displayRuns.map((run) => {
					const dt = DateTime.fromISO(run).setZone(timezone);
					return (
						<li key={run} className="flex items-center gap-2">
							<span className="size-2 rounded-full bg-primary/50" aria-hidden="true" />
							{dt.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
