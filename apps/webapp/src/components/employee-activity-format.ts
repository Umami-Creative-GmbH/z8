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

export type FormatEmployeeActivityInput = [
	lastActivityAt: string | null,
	lastActivityUtcOffsetMinutes: number | null,
	templates: EmployeeActivityTemplates,
	now?: Instant,
];

const NANOSECONDS_PER_MINUTE = BigInt(60_000_000_000);

export function formatEmployeeActivity(
	...[
		lastActivityAt,
		lastActivityUtcOffsetMinutes,
		templates,
		now = systemClock.nowInstant(),
	]: FormatEmployeeActivityInput
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
