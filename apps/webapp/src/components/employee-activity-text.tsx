"use client";

import { useTranslate } from "@tolgee/react";
import { formatEmployeeActivity } from "./employee-activity-format";

interface EmployeeActivityTextProps {
	lastActivityAt: string | null;
	lastActivityUtcOffsetMinutes: number | null;
}

export function EmployeeActivityText({
	lastActivityAt,
	lastActivityUtcOffsetMinutes,
}: EmployeeActivityTextProps) {
	const { t } = useTranslate();
	const text = formatEmployeeActivity(
		lastActivityAt,
		lastActivityUtcOffsetMinutes,
		{
			relativeMinutes: (minutes) =>
				t("common:presence.activity.relativeMinutes", "since {minutes}min", {
					minutes,
				}),
			relativeHours: (hours) =>
				t("common:presence.activity.relativeHours", "since {hours}h", {
					hours,
				}),
			relativeHoursMinutes: (hours, minutes) =>
				t(
					"common:presence.activity.relativeHoursMinutes",
					"since {hours}h {minutes}min",
					{
						hours,
						minutes,
					},
				),
			lastActivity: (date) =>
				t("common:presence.activity.lastActivity", "last activity {date}", {
					date,
				}),
		},
	);

	if (text === null) return null;
	return <p className="text-xs text-muted-foreground">{text}</p>;
}
