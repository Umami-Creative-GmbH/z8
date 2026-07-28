"use client";

import { useTranslate } from "@tolgee/react";
import {
	compareInstants,
	type Instant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";

export interface EmployeeActivityTemplates {
	relativeMinutes(minutes: number): string;
	relativeHours(hours: number): string;
	relativeHoursMinutes(hours: number, minutes: number): string;
	lastActivity(date: string): string;
}

const NANOSECONDS_PER_MINUTE = BigInt(60_000_000_000);

export function formatEmployeeActivity(
	lastActivityAt: string | null,
	lastActivityUtcOffsetMinutes: number | null,
	templates: EmployeeActivityTemplates,
	now: Instant = systemClock.nowInstant(),
): string | null {
	if (lastActivityAt === null || lastActivityUtcOffsetMinutes === null)
		return null;

	try {
		const activity = parseInstant(lastActivityAt);
		const timezone = offsetMinutesToTimeZoneId(lastActivityUtcOffsetMinutes);
		if (compareInstants(activity, now) > 0) return null;

		const elapsedMinutes = Number(
			(now.epochNanoseconds - activity.epochNanoseconds) /
				NANOSECONDS_PER_MINUTE,
		);
		const activityLocal = activity.toZonedDateTimeISO(timezone);
		const sameLocalDate = activityLocal
			.toPlainDate()
			.equals(now.toZonedDateTimeISO(timezone).toPlainDate());

		if (elapsedMinutes < 180 || sameLocalDate) {
			const hours = Math.floor(elapsedMinutes / 60);
			const minutes = elapsedMinutes % 60;
			if (hours === 0) return templates.relativeMinutes(minutes);
			if (minutes === 0) return templates.relativeHours(hours);
			return templates.relativeHoursMinutes(hours, minutes);
		}

		const date = `${String(activityLocal.day).padStart(2, "0")}.${String(
			activityLocal.month,
		).padStart(2, "0")}.`;
		return templates.lastActivity(date);
	} catch {
		return null;
	}
}

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
