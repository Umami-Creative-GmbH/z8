import { DateTime } from "luxon";

import type { TimeFormat } from "@/lib/user-preferences/time-format";

export interface HeaderTimezoneDisplay {
	timeLabel: string;
	offsetLabel: string;
	displayTimezone: string;
}

export function formatHeaderTimezone({
	now,
	timezone,
	timeFormat,
}: {
	now: DateTime;
	timezone: string;
	timeFormat: TimeFormat;
}): HeaderTimezoneDisplay {
	const zonedNow = now.setZone(timezone);
	const displayDateTime = zonedNow.isValid ? zonedNow : now.setZone("UTC");
	const displayTimezone = zonedNow.isValid ? timezone : "UTC";
	const offsetMinutes = displayDateTime.offset;
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffset = Math.abs(offsetMinutes);
	const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
	const offsetRemainderMinutes = String(absoluteOffset % 60).padStart(2, "0");

	return {
		displayTimezone,
		offsetLabel: `UTC${sign}${offsetHours}:${offsetRemainderMinutes}`,
		timeLabel: displayDateTime.toFormat(timeFormat === "12h" ? "h:mm a" : "HH:mm"),
	};
}
