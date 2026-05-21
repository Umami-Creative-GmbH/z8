import { DateTime } from "luxon";

type PresenceMode = "minimum_count" | "fixed_days";
export type PresenceEvaluationPeriod = "weekly" | "biweekly" | "monthly";
export type PresenceDayOfWeek =
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

const WEEKDAY_BY_NUMBER: Record<number, PresenceDayOfWeek> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

const PRESENCE_DAYS = new Set<PresenceDayOfWeek>(Object.values(WEEKDAY_BY_NUMBER));

export const DEFAULT_WORK_DAYS: PresenceDayOfWeek[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
];

export type PresenceStatusSummary = {
	presenceEnabled: boolean;
	available: boolean;
	period: PresenceEvaluationPeriod;
	periodStart: string;
	periodEnd: string;
	mode: PresenceMode;
	homeOfficeDaysLeft: number;
	officeDaysRequiredLeft: number;
	officeDaysCompleted: number;
	homeOfficeDaysUsed: number;
	workingDaysRemaining: number;
	requiredOfficeDays: number;
	fixedOfficeDays: PresenceDayOfWeek[];
	message: string | null;
};

export function calculatePresenceStatusCounts({
	presenceMode,
	requiredOnsiteDays,
	requiredOnsiteFixedDays,
	workPeriods,
}: {
	presenceMode: PresenceMode;
	requiredOnsiteDays: number | null;
	requiredOnsiteFixedDays: PresenceDayOfWeek[] | null;
	workPeriods: Array<{ startTime: Date; workLocationType: string | null }>;
}) {
	const requiredFixedDaySet = new Set(requiredOnsiteFixedDays ?? []);
	const onsiteDates = new Set<string>();

	for (const period of workPeriods) {
		if (period.workLocationType !== "office") continue;

		const dateTime = DateTime.fromJSDate(period.startTime);
		if (
			presenceMode === "fixed_days" &&
			!requiredFixedDaySet.has(WEEKDAY_BY_NUMBER[dateTime.weekday])
		) {
			continue;
		}

		const date = dateTime.toISODate();
		if (date) {
			onsiteDates.add(date);
		}
	}

	return {
		required:
			presenceMode === "minimum_count" ? (requiredOnsiteDays ?? 0) : requiredFixedDaySet.size,
		actual: onsiteDates.size,
	};
}

export function parsePresenceFixedDays(value: string | null): PresenceDayOfWeek[] | null {
	if (value === null) return null;

	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return null;

		const fixedDays: PresenceDayOfWeek[] = [];
		for (const day of parsed) {
			if (typeof day !== "string" || !PRESENCE_DAYS.has(day as PresenceDayOfWeek)) {
				return null;
			}

			fixedDays.push(day as PresenceDayOfWeek);
		}

		return fixedDays;
	} catch {
		return null;
	}
}

function getStartOfWeek(date: DateTime, weekStartDay: "sunday" | "monday" | 0 | 1) {
	if (weekStartDay === "monday" || weekStartDay === 1) {
		return date.startOf("week").startOf("day");
	}

	const daysSinceSunday = date.weekday % 7;
	return date.minus({ days: daysSinceSunday }).startOf("day");
}

export function getPresenceWorkDays(
	scheduleDays: Array<{ dayOfWeek: string; isWorkDay: boolean }> | null | undefined,
): PresenceDayOfWeek[] {
	const workDays =
		scheduleDays
			?.filter((day) => day.isWorkDay && PRESENCE_DAYS.has(day.dayOfWeek as PresenceDayOfWeek))
			.map((day) => day.dayOfWeek as PresenceDayOfWeek) ?? [];

	return workDays.length ? workDays : DEFAULT_WORK_DAYS;
}

export function getPresencePeriodBounds({
	period,
	now,
	weekStartDay,
	timezone,
}: {
	period: PresenceEvaluationPeriod;
	now: DateTime;
	weekStartDay: "sunday" | "monday" | 0 | 1;
	timezone: string;
}) {
	const zone = timezone || "utc";
	const zonedNow = now.setZone(zone);

	if (period === "monthly") {
		return {
			start: zonedNow.startOf("month"),
			end: zonedNow.endOf("month"),
		};
	}

	const weekStart = getStartOfWeek(zonedNow, weekStartDay);
	if (period === "weekly") {
		return {
			start: weekStart,
			end: weekStart.plus({ days: 6 }).endOf("day"),
		};
	}

	// Monday 2026-01-05 is the deterministic first full biweekly anchor week.
	const mondayAnchor = DateTime.fromISO("2026-01-05T00:00:00.000", { zone });
	const anchor = getStartOfWeek(mondayAnchor, weekStartDay);
	const daysSinceAnchor = Math.floor(weekStart.diff(anchor, "days").days);
	const periodOffsetDays = Math.floor(daysSinceAnchor / 14) * 14;
	const start = anchor.plus({ days: periodOffsetDays });

	return {
		start,
		end: start.plus({ days: 13 }).endOf("day"),
	};
}

export function calculatePresenceStatusSummary({
	presenceMode,
	requiredOnsiteDays,
	requiredOnsiteFixedDays,
	period,
	periodStart,
	periodEnd,
	now,
	timezone,
	workDays,
	workPeriods,
}: {
	presenceMode: PresenceMode;
	requiredOnsiteDays: number | null;
	requiredOnsiteFixedDays: PresenceDayOfWeek[] | null;
	period: PresenceEvaluationPeriod;
	periodStart: DateTime;
	periodEnd: DateTime;
	now: DateTime;
	timezone: string;
	workDays: PresenceDayOfWeek[] | null;
	workPeriods: Array<{ startTime: Date; workLocationType: string | null }>;
}): PresenceStatusSummary {
	const zone = timezone || "utc";
	const start = periodStart.setZone(zone).startOf("day");
	const end = periodEnd.setZone(zone).endOf("day");
	const today = now.setZone(zone).startOf("day");
	const scheduledDays = new Set(workDays?.length ? workDays : DEFAULT_WORK_DAYS);
	const fixedOfficeDays = requiredOnsiteFixedDays ?? [];
	const fixedOfficeDaySet = new Set(fixedOfficeDays);
	const officeDates = new Set<string>();
	const homeDates = new Set<string>();
	const workedDates = new Set<string>();

	for (const workPeriod of workPeriods) {
		const dateTime = DateTime.fromJSDate(workPeriod.startTime, { zone });
		if (dateTime < start || dateTime > end) continue;

		const date = dateTime.toISODate();
		if (!date) continue;

		workedDates.add(date);
		if (workPeriod.workLocationType === "office") {
			officeDates.add(date);
		} else if (workPeriod.workLocationType === "home") {
			homeDates.add(date);
		}
	}

	let totalScheduledWorkDays = 0;
	let workingDaysRemaining = 0;
	let fixedOfficeDates = 0;
	let officeDaysRequiredLeft = 0;
	let homeOfficeDaysLeft = 0;
	let cursor = start;

	while (cursor <= end) {
		const weekday = WEEKDAY_BY_NUMBER[cursor.weekday];
		const date = cursor.toISODate();
		if (date && scheduledDays.has(weekday)) {
			totalScheduledWorkDays += 1;

			const isRemaining = cursor >= today && !workedDates.has(date);
			if (isRemaining) {
				workingDaysRemaining += 1;
			}

			if (presenceMode === "fixed_days" && fixedOfficeDaySet.has(weekday)) {
				fixedOfficeDates += 1;
				if (cursor >= today && !officeDates.has(date)) {
					officeDaysRequiredLeft += 1;
				}
			} else if (presenceMode === "fixed_days" && isRemaining) {
				homeOfficeDaysLeft += 1;
			}
		}

		cursor = cursor.plus({ days: 1 });
	}

	const officeDaysCompleted =
		presenceMode === "minimum_count"
			? officeDates.size
			: Array.from(officeDates).filter((date) => {
					const dateTime = DateTime.fromISO(date, { zone });
					return fixedOfficeDaySet.has(WEEKDAY_BY_NUMBER[dateTime.weekday]);
				}).length;
	const homeOfficeDaysUsed = Array.from(homeDates).filter((date) => !officeDates.has(date)).length;
	const requiredOfficeDays =
		presenceMode === "minimum_count"
			? Math.min(requiredOnsiteDays ?? 0, totalScheduledWorkDays)
			: fixedOfficeDates;

	if (presenceMode === "minimum_count") {
		officeDaysRequiredLeft = Math.max(requiredOfficeDays - officeDaysCompleted, 0);
		homeOfficeDaysLeft = Math.max(workingDaysRemaining - officeDaysRequiredLeft, 0);
	}

	return {
		presenceEnabled: true,
		available: true,
		period,
		periodStart: start.toISO() ?? periodStart.toISO() ?? "",
		periodEnd: end.toISO() ?? periodEnd.toISO() ?? "",
		mode: presenceMode,
		homeOfficeDaysLeft,
		officeDaysRequiredLeft,
		officeDaysCompleted,
		homeOfficeDaysUsed,
		workingDaysRemaining,
		requiredOfficeDays,
		fixedOfficeDays,
		message: null,
	};
}
