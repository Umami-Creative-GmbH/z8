import { dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { parseTimeZone } from "@/lib/timezone/validation";

export function resolveAuditDateRange(
	startDate: string,
	endDate: string,
	timezone: string,
) {
	const start = parsePlainDate(startDate);
	const end = parsePlainDate(endDate);
	if (start.since(end).sign > 0) {
		throw new RangeError(
			"Audit log end date must be on or after the start date",
		);
	}

	const organizationTimezone = parseTimeZone(timezone);
	return {
		start: dateFromInstant(
			start.toZonedDateTime(organizationTimezone).toInstant(),
		),
		endExclusive: dateFromInstant(
			end.add({ days: 1 }).toZonedDateTime(organizationTimezone).toInstant(),
		),
	};
}
