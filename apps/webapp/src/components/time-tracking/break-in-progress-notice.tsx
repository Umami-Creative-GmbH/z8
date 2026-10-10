"use client";

import { IconClockPause } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { cn } from "@/lib/utils";
import { getTimeFormatDateTimeOptions, type TimeFormat } from "@/lib/user-preferences/time-format";

/**
 * A break in progress, read-only (#861, Time Tracking ADR 0007): the employee
 * is on a break started at a kiosk. The time shows in the zone observed where
 * the break started, as its endpoint will be recorded.
 */
export function BreakInProgressNotice({
	since,
	zone,
	timeFormat = "24h",
	className,
}: {
	since: Date | string;
	zone: string | null;
	timeFormat?: TimeFormat;
	className?: string;
}) {
	const { t } = useTranslate();
	const time = new Intl.DateTimeFormat(undefined, {
		...getTimeFormatDateTimeOptions(timeFormat),
		...(zone ? { timeZone: zone } : {}),
	}).format(new Date(since));

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 text-amber-700 text-sm dark:text-amber-300",
				className,
			)}
		>
			<IconClockPause aria-hidden="true" className="size-4 shrink-0" />
			<span>{t("timeTracking.breakInProgress.since", "On break since {time}", { time })}</span>
		</span>
	);
}
