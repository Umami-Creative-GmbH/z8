import { Temporal } from "temporal-polyfill";
import { type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";

/**
 * A known employment interval, half-open [startedAt, endedAt). A null bound is
 * unknown or open and is never narrowed by invented dates.
 */
export type EmploymentInterval = {
	startedAt: Instant | null;
	endedAt: Instant | null;
};

/**
 * A local calendar day is employed when its [start, next start) interval in
 * the given zone intersects any employment interval. The zone's real start of
 * day is used, so 23- and 25-hour days are handled.
 */
export function isDateKeyEmployed(
	coverage: readonly EmploymentInterval[],
	dateKey: string,
	timezone: string,
): boolean {
	const day = parsePlainDate(dateKey);
	const dayStart = day.toZonedDateTime(timezone).toInstant();
	const nextDayStart = day.add({ days: 1 }).toZonedDateTime(timezone).toInstant();

	return coverage.some(
		(interval) =>
			(interval.startedAt === null ||
				Temporal.Instant.compare(interval.startedAt, nextDayStart) < 0) &&
			(interval.endedAt === null || Temporal.Instant.compare(interval.endedAt, dayStart) > 0),
	);
}

/**
 * Removes requirement days outside employment. Without lifecycle coverage the
 * requirements are returned unchanged. Day keys follow the requirement
 * builder's zone, including its UTC fallback for an unusable zone.
 */
export function clipRequirementsToEmployment<T>(
	requirements: Record<string, T>,
	coverage: readonly EmploymentInterval[] | null,
	timezone: string | null | undefined,
): Record<string, T> {
	if (!coverage) return requirements;
	const zone = isUsableTimeZone(timezone) ? timezone : "UTC";
	return Object.fromEntries(
		Object.entries(requirements).filter(([dateKey]) => isDateKeyEmployed(coverage, dateKey, zone)),
	);
}

function isUsableTimeZone(timezone: string | null | undefined): timezone is string {
	if (!timezone) return false;
	try {
		Temporal.Now.zonedDateTimeISO(timezone);
		return true;
	} catch {
		return false;
	}
}
