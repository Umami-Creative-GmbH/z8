"use client";

import { useTranslate } from "@tolgee/react";
import { formatEmployeeActivity } from "./employee-activity-format";
import { BreakInProgressNotice } from "./time-tracking/break-in-progress-notice";

interface EmployeeActivityTextProps {
	lastActivityAt: string | null;
	lastActivityUtcOffsetMinutes: number | null;
	/** A break in progress (#861), shown instead of the last activity. */
	breakStartedAt?: string | null;
	breakStartedZone?: string | null;
}

export function EmployeeActivityText({
	lastActivityAt,
	lastActivityUtcOffsetMinutes,
	breakStartedAt,
	breakStartedZone,
}: EmployeeActivityTextProps) {
	const { t } = useTranslate();
	if (breakStartedAt) {
		return (
			<BreakInProgressNotice
				since={breakStartedAt}
				zone={breakStartedZone ?? null}
				className="text-xs"
			/>
		);
	}
	const text = formatEmployeeActivity(
		lastActivityAt,
		lastActivityUtcOffsetMinutes,
		{
			relativeMinutes: (minutes) =>
				t("presence.activity.relativeMinutes", "since {minutes}min", {
					minutes,
				}),
			relativeHours: (hours) =>
				t("presence.activity.relativeHours", "since {hours}h", {
					hours,
				}),
			relativeHoursMinutes: (hours, minutes) =>
				t(
					"presence.activity.relativeHoursMinutes",
					"since {hours}h {minutes}min",
					{
						hours,
						minutes,
					},
				),
			lastActivity: (date) =>
				t("presence.activity.lastActivity", "last activity {date}", {
					date,
				}),
		},
	);

	if (text === null) return null;
	return <p className="text-xs text-muted-foreground">{text}</p>;
}
