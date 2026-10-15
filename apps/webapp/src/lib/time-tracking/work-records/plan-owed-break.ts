/**
 * The plan step of an owed-break division (ADR 0010, #1220): from the locked
 * pair, the regulation and the breaks already taken, where the owed break goes
 * and what each half carries. Pure, no I/O, no server-only imports.
 *
 * Record agreement is checked first, before anything is decided about the
 * break, so a pair that disagrees is reported even when nothing is owed; then
 * on both planned halves. Placement is the automatic-break planner's; each
 * half rounds its own exact elapsed time in the admission's arithmetic.
 */
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { planAutomaticBreak } from "../automatic-break-plan";
import type { BreakPolicyRegulation } from "../break-policy-calculation";
import { vehicleUseAcrossAutomaticBreak } from "../vehicle-use/split-vehicle-use";
import type { WorkRecordRefusal } from "./change";
import type { OwedBreak, OwedBreakNotRequired } from "./owed-break";
import { agreeingPair, plannedPairsRefusal } from "./pair-agreement";
import {
	type PlannedHalf,
	plannedHalf,
	type WorkDurationArithmetic,
	type WorkRecordPair,
	workDurationMinutes,
} from "./plan";
import { WorkAttribution } from "./work-attribution";

export type OwedBreakPlan = {
	kind: "divide_owed_break";
	owedBreak: OwedBreak;
	retained: PlannedHalf;
	generated: PlannedHalf;
};

export function planOwedBreakDivision(
	pair: WorkRecordPair,
	input: { regulation: BreakPolicyRegulation | null; alreadyTakenBreakMinutes: number },
	arithmetic: WorkDurationArithmetic,
): OwedBreakPlan | OwedBreakNotRequired | WorkRecordRefusal {
	const locked = agreeingPair(pair);
	if ("kind" in locked) return locked;
	const { period, canonical } = locked;

	const startAt = instantFromDate(period.startTime);
	const endAt = instantFromDate(period.endTime);
	const owed = planAutomaticBreak({
		sourceStart: startAt,
		sourceEnd: endAt,
		sourceDurationMinutes: period.durationMinutes,
		alreadyTakenBreakMinutes: input.alreadyTakenBreakMinutes,
		regulation: input.regulation,
	});
	if (!owed) return { kind: "not_required" };

	// Nobody read the odometer at the break: one half keeps the kilometres (#1126).
	const source = WorkAttribution.fromWorkPeriod(period);
	const vehicle = vehicleUseAcrossAutomaticBreak(source.vehicleUse);
	const approval = { period: period.approvalStatus, record: canonical.record.approvalState };
	const plan: OwedBreakPlan = {
		kind: "divide_owed_break",
		owedBreak: {
			breakMinutes: owed.breakMinutes,
			alreadyTakenBreakMinutes: owed.alreadyTakenBreakMinutes,
			rule: owed.rule,
			regulation: owed.regulation,
			startAt: owed.breakStartAt,
			endAt: owed.breakEndAt,
		},
		retained: plannedHalf(
			{
				startAt,
				endAt: owed.breakStartAt,
				durationMinutes: workDurationMinutes(arithmetic, startAt, owed.breakStartAt),
			},
			source.apply({ vehicleUse: vehicle.retained }),
			canonical.allocations,
			approval,
		),
		generated: plannedHalf(
			{
				startAt: owed.breakEndAt,
				endAt,
				durationMinutes: workDurationMinutes(arithmetic, owed.breakEndAt, endAt),
			},
			source.apply({ vehicleUse: vehicle.generated }),
			canonical.allocations,
			approval,
		),
	};
	return plannedPairsRefusal([plan.retained, plan.generated], "planned_half") ?? plan;
}
