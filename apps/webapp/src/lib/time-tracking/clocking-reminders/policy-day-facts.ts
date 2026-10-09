import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";
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

/** The latest clock-in of a detailed schedule's work day; simple schedules carry none. */
export function latestClockInOn(policy: EffectiveWorkPolicy | null, day: string): string | null {
	const schedule = policy?.schedule;
	if (schedule?.scheduleType !== "detailed") return null;
	const weekday = WEEKDAYS[parsePlainDate(day).dayOfWeek - 1];
	const scheduled = schedule.days.find((entry) => entry.dayOfWeek === weekday && entry.isWorkDay);
	return scheduled?.latestClockIn ?? null;
}

/**
 * Reads an employee's work-policy facts for clocking reminders through the existing effective
 * policy resolution (employee, team, organization) and the per-day work requirements, which
 * already zero non-work days, approved absences, holidays and days outside employment.
 */
export function createPolicyDayFacts(input: {
	organizationId: string;
	employeeId: string;
	timezone: string;
	now: Instant;
}): PolicyDayFacts {
	return {
		async latestClockIn(day) {
			const [{ Effect }, { runtime }, { WorkPolicyService }] = await Promise.all([
				import("effect"),
				import("@/lib/effect/runtime"),
				import("@/lib/effect/services/work-policy.service"),
			]);
			const policy = await runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* WorkPolicyService;
					return yield* service.getEffectivePolicyAt({
						employeeId: input.employeeId,
						organizationId: input.organizationId,
						at: input.now,
					});
				}),
			);
			return latestClockInOn(policy, day);
		},
		async requiredMinutes(day) {
			const { getDailyWorkRequirementsForEmployee } = await import(
				"@/lib/calendar/work-policy-requirements"
			);
			const dayStart = dateFromInstant(localDayRange(day, input.timezone).start);
			const requirements = await getDailyWorkRequirementsForEmployee({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				startDate: dayStart,
				endDate: dayStart,
				timezone: input.timezone,
			});
			return requirements[day]?.requiredMinutes ?? 0;
		},
	};
}
