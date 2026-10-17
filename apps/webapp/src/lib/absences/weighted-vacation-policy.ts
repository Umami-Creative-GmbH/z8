/** Calendar-month weighting of dated policy terms before employment proration. */
import { Temporal } from "temporal-polyfill";
import type { VacationBalanceConfiguration } from "./types";
import type { EmployeeVacationPolicyPeriod } from "./vacation-policy-history";
import type { VacationPolicy } from "./vacation-policy-store";

export function resolveWeightedVacationPolicy(
	periods: readonly EmployeeVacationPolicyPeriod[],
	input: { year: number },
): { policy?: VacationPolicy; configuration: VacationBalanceConfiguration } {
	const start = Temporal.PlainDate.from({ year: input.year, month: 1, day: 1 });
	const end = start.add({ years: 1 });
	let cursor = start;
	let annual = 0;
	let minimum = 0;
	let selected: VacationPolicy | undefined;
	const missing: { startDate: string; endDate: string }[] = [];
	const conflicts: {
		startDate: string;
		endDate: string;
		policyIds?: string[];
		reason?: "incompatible_transition";
	}[] = [];
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
		for (let date = from; Temporal.PlainDate.compare(date, until) < 0; ) {
			const nextMonth = date.with({ day: 1 }).add({ months: 1 });
			const next =
				Temporal.PlainDate.compare(nextMonth, until) < 0 ? nextMonth : until;
			const share = date.until(next).days / date.daysInMonth / 12;
			annual += Number(policy.defaultAnnualDays) * share;
			minimum += Number(policy.statutoryMinimumDays) * share;
			date = next;
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
		},
		configuration: { status: resolved ? "resolved" : "legacy" },
	};
}
