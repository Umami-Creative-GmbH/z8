import { Effect } from "effect";
import { DateTime } from "luxon";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
	type EffectiveWorkPolicy,
} from "@/lib/effect/services/work-policy.service";
import type { DailyWorkRequirements } from "./types";

type EffectiveWorkPolicyScheduleDayName = NonNullable<
	EffectiveWorkPolicy["schedule"]
>["days"][number]["dayOfWeek"];

const WEEKDAY_BY_NUMBER: Record<number, EffectiveWorkPolicyScheduleDayName> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

const PRESET_DAYS: Record<string, EffectiveWorkPolicyScheduleDayName[]> = {
	weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
	weekends: ["saturday", "sunday"],
	all_days: [
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
		"sunday",
	],
};

interface BuildDailyWorkRequirementsOptions {
	policy: EffectiveWorkPolicy | null;
	startDate: Date;
	endDate: Date;
}

function hoursToMinutes(hours: string | null | undefined): number {
	const parsed = Number.parseFloat(hours ?? "");
	if (!Number.isFinite(parsed) || parsed <= 0) return 0;
	return Math.round(parsed * 60);
}

function getSimpleWorkDays(
	schedule: NonNullable<EffectiveWorkPolicy["schedule"]>,
): EffectiveWorkPolicyScheduleDayName[] {
	if (schedule.workingDaysPreset === "custom") {
		return schedule.days.filter((day) => day.isWorkDay).map((day) => day.dayOfWeek);
	}

	return PRESET_DAYS[schedule.workingDaysPreset] ?? [];
}

function getRequiredMinutesForDay(
	policy: EffectiveWorkPolicy,
	dayName: EffectiveWorkPolicyScheduleDayName,
): number {
	const schedule = policy.schedule;
	if (!schedule) return 0;

	if (schedule.scheduleType === "detailed") {
		if (schedule.scheduleCycle !== "weekly") return 0;

		const configuredDay = schedule.days.find(
			(day) => day.dayOfWeek === dayName && day.isWorkDay,
		);
		return hoursToMinutes(configuredDay?.hoursPerDay);
	}

	if (schedule.scheduleType === "simple") {
		if (schedule.scheduleCycle !== "weekly") return 0;

		const workDays = getSimpleWorkDays(schedule);
		if (!workDays.includes(dayName) || workDays.length === 0) return 0;

		const cycleMinutes = hoursToMinutes(schedule.hoursPerCycle);
		return cycleMinutes > 0 ? Math.round(cycleMinutes / workDays.length) : 0;
	}

	return 0;
}

export function buildDailyWorkRequirements({
	policy,
	startDate,
	endDate,
}: BuildDailyWorkRequirementsOptions): DailyWorkRequirements {
	if (!policy?.schedule) return {};

	const start = DateTime.fromJSDate(startDate).startOf("day");
	const end = DateTime.fromJSDate(endDate).startOf("day");
	if (!start.isValid || !end.isValid || end < start) return {};

	const requirements: DailyWorkRequirements = {};

	for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
		const dayName = WEEKDAY_BY_NUMBER[cursor.weekday];
		const requiredMinutes = getRequiredMinutesForDay(policy, dayName);
		if (requiredMinutes <= 0) continue;

		requirements[cursor.toFormat("yyyy-MM-dd")] = {
			requiredMinutes,
			policyId: policy.policyId,
			policyName: policy.policyName,
		};
	}

	return requirements;
}

export async function getDailyWorkRequirementsForEmployee(params: {
	employeeId: string;
	startDate: Date;
	endDate: Date;
}): Promise<DailyWorkRequirements> {
	return Effect.runPromise(
		Effect.gen(function* (_) {
			const service = yield* _(WorkPolicyService);
			const policy = yield* _(service.getEffectivePolicy(params.employeeId));
			return buildDailyWorkRequirements({
				policy,
				startDate: params.startDate,
				endDate: params.endDate,
			});
		}).pipe(Effect.provide(WorkPolicyServiceLive), Effect.provide(DatabaseServiceLive)),
	);
}
