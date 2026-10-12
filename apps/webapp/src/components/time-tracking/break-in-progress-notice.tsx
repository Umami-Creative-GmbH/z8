"use client";

import { IconClockPause } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { cn } from "@/lib/utils";

/**
 * A break in progress, read-only (#861, Time Tracking ADR 0007): the employee
 * is on a break started at a kiosk. The time shows in the zone observed where
 * the break started, as its endpoint will be recorded, in the app's language
 * and the viewer's time format; never in the viewer's own zone.
 */
export function BreakInProgressNotice({
	since,
	zone,
	timeFormat = "24h",
	className,
}: {
	since: Date | string;
	/** The zone recorded with the break's start; UTC when a legacy row has none. */
	zone: string | null;
	timeFormat?: TimeFormat;
	className?: string;
}) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const time = formatInstant(
		typeof since === "string" ? parseInstant(since) : instantFromDate(since),
		{ locale: tolgee.getLanguage() ?? "en", timeFormat, timezone: zone ?? "UTC" },
		"time",
	);

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
