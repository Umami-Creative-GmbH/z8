import { z } from "zod";
import { isLatestClockIn } from "@/lib/scheduling/latest-clock-in";
import type { CustomWorkDay, DayOfWeek } from "./types";

export const DAY_OF_WEEK_ORDER: readonly DayOfWeek[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;

export const WEEKDAY_NAMES: readonly DayOfWeek[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
] as const;

export const PRESET_WORK_DAYS: Readonly<Record<string, readonly DayOfWeek[]>> = {
	weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
	weekends: ["saturday", "sunday"],
	all_days: DAY_OF_WEEK_ORDER,
};

export const ISO_WEEKDAY_TO_DAY_OF_WEEK: Readonly<Record<number, DayOfWeek>> = {
	1: "monday",
	2: "tuesday",
	3: "wednesday",
	4: "thursday",
	5: "friday",
	6: "saturday",
	7: "sunday",
};

export const dayOfWeekSchema = z.enum([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

export const customWorkDaySchema = z
	.object({
		dayOfWeek: dayOfWeekSchema,
		minutesPerDay: z.number().int().min(0).max(1440),
		isWorkDay: z.boolean(),
		latestClockIn: z.string().nullable().optional(),
	})
	.superRefine((day, ctx) => {
		if (!day.isWorkDay && day.minutesPerDay !== 0) {
			ctx.addIssue({
				code: "custom",
				message: "Non-working days must have 0 minutes per day",
				path: ["minutesPerDay"],
			});
		}
		if (day.isWorkDay && day.latestClockIn !== null && day.latestClockIn !== undefined) {
			if (day.latestClockIn !== "" && !isLatestClockIn(day.latestClockIn)) {
				ctx.addIssue({
					code: "custom",
					message: "Latest clock-in must be a valid HH:mm time between 00:00 and 23:59",
					path: ["latestClockIn"],
				});
			}
		}
	})
	.transform((day): CustomWorkDay => ({
		dayOfWeek: day.dayOfWeek,
		minutesPerDay: day.isWorkDay ? day.minutesPerDay : 0,
		isWorkDay: day.isWorkDay,
		latestClockIn:
			day.isWorkDay && day.latestClockIn && day.latestClockIn.length > 0 ? day.latestClockIn : null,
	}));

export const customWorkDaysSchema = z
	.array(customWorkDaySchema)
	.superRefine((days, ctx) => {
		const seen = new Set<DayOfWeek>();
		for (const [index, day] of days.entries()) {
			if (seen.has(day.dayOfWeek)) {
				ctx.addIssue({
					code: "custom",
					message: `Duplicate dayOfWeek "${day.dayOfWeek}"`,
					path: [index, "dayOfWeek"],
				});
			}
			seen.add(day.dayOfWeek);
		}
	})
	.transform((days): readonly CustomWorkDay[] => {
		const order = new Map(DAY_OF_WEEK_ORDER.map((day, idx) => [day, idx]));
		return [...days].sort((a, b) => (order.get(a.dayOfWeek) ?? 0) - (order.get(b.dayOfWeek) ?? 0));
	});

/**
 * Shared parser & validator for normalized custom working days used by
 * contract templates, employee overrides, bulk/CSV imports, and the resolver.
 */
export function parseCustomWorkDays(input: unknown): readonly CustomWorkDay[] {
	return customWorkDaysSchema.parse(input);
}

/**
 * Normalizes a decimal hours string or number (such as `work_policy_schedule.hours_per_cycle`
 * or `work_policy_schedule_day.hours_per_day`) into exact integer minutes.
 */
export function normalizeHoursToMinutes(hours: string | number | null | undefined): number | null {
	if (hours === null || hours === undefined) return null;
	if (typeof hours === "number") {
		if (!Number.isFinite(hours) || hours < 0) return null;
		return Math.round(hours * 60);
	}
	const trimmed = hours.trim();
	if (trimmed.length === 0) return null;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return Math.round(parsed * 60);
}

/**
 * Distributes `totalMinutes` (non-negative integer) across slots according to
 * non-negative integer `weights` using exact integer largest-remainder (Hamilton)
 * apportionment. Guarantees:
 * - Every returned value is a non-negative integer.
 * - Sum of returned values equals `totalMinutes` whenever `totalWeight > 0`.
 * - Ties are broken deterministically by ascending slot index (Monday -> Sunday).
 */
export function distributeMinutesLargestRemainder(
	totalMinutes: number,
	weights: readonly number[],
): number[] {
	if (weights.length === 0) return [];
	const target = Math.max(0, Math.round(totalMinutes));
	const integerWeights = weights.map((w) => Math.max(0, Math.round(w)));
	const weightSum = integerWeights.reduce((acc, w) => acc + w, 0);
	if (target === 0 || weightSum === 0) {
		return weights.map(() => 0);
	}

	const bigTarget = BigInt(target);
	const bigWeightSum = BigInt(weightSum);

	const floors: number[] = [];
	const remainders: { index: number; remainder: bigint }[] = [];
	let allocated = 0;

	for (let index = 0; index < integerWeights.length; index++) {
		const w = BigInt(integerWeights[index] ?? 0);
		const numerator = bigTarget * w;
		const floor = Number(numerator / bigWeightSum);
		const remainder = numerator % bigWeightSum;
		floors.push(floor);
		remainders.push({ index, remainder });
		allocated += floor;
	}

	let leftover = target - allocated;
	remainders.sort((left, right) => {
		if (right.remainder > left.remainder) return 1;
		if (right.remainder < left.remainder) return -1;
		return left.index - right.index;
	});

	const result = [...floors];
	for (let i = 0; i < remainders.length && leftover > 0; i++) {
		const entry = remainders[i];
		if (!entry || (integerWeights[entry.index] ?? 0) === 0) continue;
		result[entry.index] = (result[entry.index] ?? 0) + 1;
		leftover -= 1;
	}

	return result;
}
