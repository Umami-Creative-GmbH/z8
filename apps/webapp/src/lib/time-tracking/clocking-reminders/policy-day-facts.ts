import { db } from "@/db";
import { resolveEffectiveContractOnDay } from "@/lib/contracts/resolve-contract";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	dateFromInstant,
	type Instant,
	type PlainDate,
	type PlainTime,
	parsePlainTimeMinute,
} from "@/lib/datetime/temporal-core";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";
import type { PolicyDayFacts } from "./policy-reminders";

const WEEKDAYS = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;

/**
 * The latest clock-in of a detailed schedule's work day; simple schedules carry none. It is stored
 * as `HH:mm` text.
 */
export function latestClockInOn(
	policy: EffectiveWorkPolicy | null,
	day: PlainDate,
): PlainTime | null {
	const schedule = policy?.schedule;
	if (schedule?.scheduleType !== "detailed") return null;
	const weekday = WEEKDAYS[day.dayOfWeek - 1];
	const scheduled = schedule.days.find((entry) => entry.dayOfWeek === weekday && entry.isWorkDay);
	return scheduled?.latestClockIn ? parsePlainTimeMinute(scheduled.latestClockIn) : null;
}

/**
 * Reads an employee's work-policy facts for clocking reminders through the unified read-only
 * contract resolver (covering detailed policy versions AND custom working days' latest clock-in)
 * and the per-day work requirements, which already zero non-work days, approved absences,
 * holidays and days outside employment.
 */
export function createPolicyDayFacts(input: {
	organizationId: string;
	employeeId: string;
	timezone: string;
	now: Instant;
}): PolicyDayFacts {
	return {
		async latestClockIn(day) {
			const contract = await resolveEffectiveContractOnDay(db, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				date: day,
				timezoneOverride: input.timezone,
			});
			return contract?.latestClockIn ? parsePlainTimeMinute(contract.latestClockIn) : null;
		},
		async requiredMinutes(day) {
			const { getDailyWorkRequirementsForEmployee } =
				await import("@/lib/calendar/work-policy-requirements");
			const dayStart = dateFromInstant(localDayRange(day.toString(), input.timezone).start);
			const requirements = await getDailyWorkRequirementsForEmployee({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				startDate: dayStart,
				endDate: dayStart,
				timezone: input.timezone,
			});
			return requirements[day.toString()]?.requiredMinutes ?? 0;
		},
	};
}
