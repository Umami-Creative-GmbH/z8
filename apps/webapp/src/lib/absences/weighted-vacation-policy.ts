/** Calendar-month weighting of dated policy terms before employment proration. */
import { Temporal } from "temporal-polyfill";
import {
	type AllowanceRate,
	FIRST_WORKING_WEEK_YEAR,
	REFERENCE_WORKING_DAYS_PER_WEEK,
	yearShare,
} from "./prorated-allowance";
import type {
	VacationBalanceConfiguration,
	VacationConfigurationProblemPeriod,
} from "./types";
import type { EmployeeVacationPolicyPeriod } from "./vacation-policy-history";
import type { VacationPolicy } from "./vacation-policy-store";
import type { WorkingWeekPeriod } from "./working-days";

/**
 * An employee's policy for a year combined from their dated policy periods: the reference
 * allowance and statutory minimum weighted by calendar month, and the allowance rates of each
 * combined policy/working-week period (Absences ADR 0003) that the allowance converts.
 */
export type WeightedVacationPolicy = VacationPolicy & {
	allowanceRates: AllowanceRate[];
};

export function resolveWeightedVacationPolicy(
	periods: readonly EmployeeVacationPolicyPeriod[],
	input: {
		year: number;
		/**
		 * The employee's working days per week over the year. Days without a period, and every day
		 * before the working-week rollout, count five days.
		 */
		workingWeeks?: readonly WorkingWeekPeriod[];
	},
): {
	policy?: WeightedVacationPolicy;
	configuration: VacationBalanceConfiguration;
} {
	const start = Temporal.PlainDate.from({ year: input.year, month: 1, day: 1 });
	const end = start.add({ years: 1 });
	const workingWeeks =
		input.year >= FIRST_WORKING_WEEK_YEAR ? (input.workingWeeks ?? []) : [];
	let cursor = start;
	let annual = 0;
	let minimum = 0;
	let selected: VacationPolicy | undefined;
	const allowanceRates: AllowanceRate[] = [];
	const missing: { startDate: string; endDate: string }[] = [];
	const conflicts: VacationConfigurationProblemPeriod[] = [];
	let resolved = false;
	for (const period of periods) {
		const from =
			Temporal.PlainDate.compare(period.startDate, start) < 0
				? start
				: Temporal.PlainDate.from(period.startDate);
		const untilDate = Temporal.PlainDate.from(period.endDate).add({ days: 1 });
		const until =
			Temporal.PlainDate.compare(untilDate, end) > 0 ? end : untilDate;
		if (Temporal.PlainDate.compare(from, until) >= 0) continue;
		if (Temporal.PlainDate.compare(cursor, from) < 0)
			missing.push({
				startDate: cursor.toString(),
				endDate: from.subtract({ days: 1 }).toString(),
			});
		cursor = until;
		const resolution = period.resolution;
		if (resolution.status === "conflict") {
			conflicts.push({
				startDate: from.toString(),
				endDate: until.subtract({ days: 1 }).toString(),
				policyIds: resolution.policyIds,
				reason: resolution.reason,
			});
			continue;
		}
		if (resolution.status === "missing" || !resolution.policy) {
			missing.push({
				startDate: from.toString(),
				endDate: until.subtract({ days: 1 }).toString(),
			});
			continue;
		}
		const policy = resolution.policy;
		resolved ||= resolution.status === "resolved";
		if (
			selected &&
			(selected.accrualType !== policy.accrualType ||
				selected.prorateInStartAndExitYear !== policy.prorateInStartAndExitYear)
		) {
			conflicts.push({
				startDate: from.toString(),
				endDate: until.subtract({ days: 1 }).toString(),
				policyIds: [selected.id, policy.id],
				reason: "incompatible_transition",
			});
			continue;
		}
		selected = policy;
		const share = yearShare(from, until);
		annual += Number(policy.defaultAnnualDays) * share;
		minimum += Number(policy.statutoryMinimumDays) * share;
		for (const rate of workingWeekPeriodsBetween(workingWeeks, { from, until })) {
			if (rate.workingDaysPerWeek === 0) {
				conflicts.push({
					startDate: rate.startDate,
					endDate: rate.endDate,
					reason: "zero_working_days",
					workPolicyId: rate.workPolicyId,
				});
				continue;
			}
			allowanceRates.push({
				startDate: rate.startDate,
				endDate: rate.endDate,
				referenceAnnualDays: Number(policy.defaultAnnualDays),
				referenceStatutoryMinimumDays: Number(policy.statutoryMinimumDays),
				workingDaysPerWeek: rate.workingDaysPerWeek,
			});
		}
	}
	if (Temporal.PlainDate.compare(cursor, end) < 0)
		missing.push({
			startDate: cursor.toString(),
			endDate: end.subtract({ days: 1 }).toString(),
		});
	if (conflicts.length)
		return { configuration: { status: "conflict", periods: conflicts } };
	if (missing.length || !selected)
		return { configuration: { status: "missing", periods: missing } };
	return {
		policy: {
			...selected,
			defaultAnnualDays: annual.toFixed(2),
			statutoryMinimumDays: minimum.toFixed(2),
			allowanceRates,
		},
		configuration: { status: resolved ? "resolved" : "legacy" },
	};
}

/**
 * The working days per week from `startDate` through `endDate`, split where the working week
 * changes. Days the working weeks do not cover count five days; years before the working-week
 * rollout always count five days.
 */
export function workingWeeksWithin(
	workingWeeks: readonly WorkingWeekPeriod[],
	range: { startDate: string; endDate: string },
): WorkingWeekPeriod[] {
	const from = Temporal.PlainDate.from(range.startDate);
	const until = Temporal.PlainDate.from(range.endDate).add({ days: 1 });
	return workingWeekPeriodsBetween(from.year >= FIRST_WORKING_WEEK_YEAR ? workingWeeks : [], {
		from,
		until,
	});
}

/**
 * The working days per week over `[from, until)`, split where the working week changes. Days the
 * working weeks do not cover count five days.
 */
function workingWeekPeriodsBetween(
	workingWeeks: readonly WorkingWeekPeriod[],
	range: { from: Temporal.PlainDate; until: Temporal.PlainDate },
): WorkingWeekPeriod[] {
	const rates: WorkingWeekPeriod[] = [];
	const push = (
		from: Temporal.PlainDate,
		until: Temporal.PlainDate,
		workingDaysPerWeek: number,
		workPolicyId: string | null,
	) => {
		if (Temporal.PlainDate.compare(from, until) >= 0) return;
		rates.push({
			startDate: from.toString(),
			endDate: until.subtract({ days: 1 }).toString(),
			workingDaysPerWeek,
			workPolicyId,
		});
	};
	let cursor = range.from;
	const sorted = workingWeeks.toSorted((left, right) =>
		Temporal.PlainDate.compare(left.startDate, right.startDate),
	);
	for (const week of sorted) {
		const weekFrom = latest(Temporal.PlainDate.from(week.startDate), cursor);
		const weekUntil = earliest(
			Temporal.PlainDate.from(week.endDate).add({ days: 1 }),
			range.until,
		);
		if (Temporal.PlainDate.compare(weekFrom, weekUntil) >= 0) continue;
		push(cursor, weekFrom, REFERENCE_WORKING_DAYS_PER_WEEK, null);
		push(weekFrom, weekUntil, week.workingDaysPerWeek, week.workPolicyId);
		cursor = weekUntil;
	}
	push(cursor, range.until, REFERENCE_WORKING_DAYS_PER_WEEK, null);
	return rates;
}

function latest(left: Temporal.PlainDate, right: Temporal.PlainDate) {
	return Temporal.PlainDate.compare(left, right) >= 0 ? left : right;
}

function earliest(left: Temporal.PlainDate, right: Temporal.PlainDate) {
	return Temporal.PlainDate.compare(left, right) <= 0 ? left : right;
}
