import { DateTime } from "luxon";
import { parseDigestSettings } from "@/lib/bot-platform/digest-settings";

export interface DigestOccurrence {
	due: boolean;
	logicalDate: string;
	scheduledInstant: string;
}

export function evaluateDigestOccurrence(input: {
	now: Date;
	time: string;
	timezone: string;
	windowMinutes: number;
}): DigestOccurrence {
	const settings = parseDigestSettings({ time: input.time, timezone: input.timezone });
	const now = DateTime.fromJSDate(input.now, { zone: "utc" });
	const scheduleNow = now.setZone(settings.timezone);
	const [hour, minute] = settings.time.split(":").map(Number);
	const requested = DateTime.fromObject(
		{
			year: scheduleNow.year,
			month: scheduleNow.month,
			day: scheduleNow.day,
			hour,
			minute,
			second: 0,
			millisecond: 0,
		},
		{ zone: settings.timezone },
	);
	const scheduled = requested.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis())[0]!;
	const minutesSinceSchedule = now.diff(scheduled.toUTC(), "minutes").minutes;

	return {
		due: minutesSinceSchedule >= 0 && minutesSinceSchedule < input.windowMinutes,
		logicalDate: scheduleNow.toISODate()!,
		scheduledInstant: scheduled.toUTC().toISO()!,
	};
}
