/**
 * Pure planning for an automatic break adjustment (#305): the break owed by one
 * completed work under a break regulation and where it goes. The caller supplies
 * the facts it read under its locks; nothing here reads the clock or the viewer's
 * zone, so a deferred adjustment recovered on a later date plans the same break
 * from the same facts.
 */
import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import { type BreakPolicyRegulation, calculateBreakDeficit } from "./break-policy-calculation";
import { deriveWorkDurationMinutes } from "./work-duration";

export interface WorkInterval {
	startAt: Instant;
	endAt: Instant;
}

/**
 * Break minutes already taken before `sourceEnd`: the whole-minute gaps longer than
 * one minute between the given work (the source's local day, including the source).
 * Work starting after `sourceEnd` does not count, and overlapping work covers its gap.
 */
export function breakMinutesTakenBefore(
	periods: readonly WorkInterval[],
	sourceEnd: Instant,
): number {
	const ordered = [...periods].sort(
		(left, right) =>
			compareInstants(left.startAt, right.startAt) || compareInstants(left.endAt, right.endAt),
	);
	let taken = 0;
	let previousEnd: Instant | null = null;
	for (const period of ordered) {
		if (compareInstants(period.startAt, sourceEnd) > 0) break;
		const boundedEnd = compareInstants(period.endAt, sourceEnd) > 0 ? sourceEnd : period.endAt;
		if (previousEnd && compareInstants(period.startAt, previousEnd) > 0) {
			const gapMinutes = Math.floor(period.startAt.since(previousEnd).total({ unit: "minutes" }));
			if (gapMinutes > 1) taken += gapMinutes;
		}
		if (!previousEnd || compareInstants(boundedEnd, previousEnd) > 0) previousEnd = boundedEnd;
	}
	return taken;
}

export interface AutomaticBreakPlan {
	breakMinutes: number;
	alreadyTakenBreakMinutes: number;
	rule: { workingMinutesThreshold: number; requiredBreakMinutes: number };
	regulation: { id: string; name: string };
	breakStartAt: Instant;
	breakEndAt: Instant;
	/** Each resulting segment rounds its own exact UTC elapsed time half up (#252). */
	retainedMinutes: number;
	generatedMinutes: number;
}

/**
 * The owed break, placed after the lower of the regulation's maximum uninterrupted
 * time and the applicable rule's threshold, or null when nothing is owed or the break
 * would not end strictly inside the work. A positive segment may round to zero minutes.
 */
export function planAutomaticBreak(input: {
	sourceStart: Instant;
	sourceEnd: Instant;
	/** The stored minutes the regulation's thresholds are compared with. */
	sourceDurationMinutes: number;
	alreadyTakenBreakMinutes: number;
	regulation: BreakPolicyRegulation | null;
}): AutomaticBreakPlan | null {
	const deficit = calculateBreakDeficit({
		sessionDurationMinutes: input.sourceDurationMinutes,
		alreadyTakenBreakMinutes: input.alreadyTakenBreakMinutes,
		regulation: input.regulation,
	});
	const rule = deficit.applicableRule;
	if (!input.regulation || !rule || deficit.deficit <= 0) return null;
	const insertAfterMinutes =
		deficit.maxUninterruptedMinutes !== null
			? Math.min(deficit.maxUninterruptedMinutes, rule.workingMinutesThreshold)
			: rule.workingMinutesThreshold;
	if (!Number.isSafeInteger(insertAfterMinutes) || insertAfterMinutes <= 0) return null;
	const breakStartAt = input.sourceStart.add({ minutes: insertAfterMinutes });
	const breakEndAt = breakStartAt.add({ minutes: deficit.deficit });
	if (
		compareInstants(breakStartAt, input.sourceStart) <= 0 ||
		compareInstants(breakEndAt, input.sourceEnd) >= 0
	) {
		return null;
	}
	return {
		breakMinutes: deficit.deficit,
		alreadyTakenBreakMinutes: input.alreadyTakenBreakMinutes,
		rule: {
			workingMinutesThreshold: rule.workingMinutesThreshold,
			requiredBreakMinutes: rule.requiredBreakMinutes,
		},
		regulation: { id: input.regulation.id, name: input.regulation.name },
		breakStartAt,
		breakEndAt,
		retainedMinutes: deriveWorkDurationMinutes(input.sourceStart, breakStartAt),
		generatedMinutes: deriveWorkDurationMinutes(breakEndAt, input.sourceEnd),
	};
}
