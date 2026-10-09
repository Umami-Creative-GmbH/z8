import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";

/** The break-relevant part of a work policy's regulation. */
export interface BreakDueRegulation {
	maxUninterruptedMinutes: number | null;
	breakRules: readonly { workingMinutesThreshold: number; requiredBreakMinutes: number }[];
}

export interface BreakDueInput {
	/** `null` when no regulated work policy applies. */
	regulation: BreakDueRegulation | null;
	/** Completed work on the live work's compliance day (its local start day), the live work left out. */
	completedMinutes: number;
	/** Breaks taken on that day so far: gaps of more than a minute between its periods. */
	breakMinutes: number;
	/** When the live work started. */
	liveStart: Instant;
	now: Instant;
}

/** A break rule of the policy that live work can break. */
export type BreakDueRule =
	| { kind: "max_uninterrupted"; limitMinutes: number }
	| { kind: "break_rule"; workingMinutesThreshold: number; requiredBreakMinutes: number };

/** When one rule is broken if the employee keeps working without a break. */
export interface BreakDue {
	rule: BreakDueRule;
	at: Instant;
}

export interface BreakDueStatus {
	/** Whole minutes the live work has run. */
	uninterruptedMinutes: number;
	/** Every rule the live work breaks without a break, earliest first; past breaches included. */
	breaches: BreakDue[];
	/** Minutes left until the uninterrupted-work limit, negative once passed; `null` without one. */
	minutesUntilUninterruptedLimit: number | null;
	/** The break the day's work requires now; `null` while no threshold has been passed. */
	requirement: { totalNeeded: number; taken: number; remaining: number } | null;
}

/** The rule with the highest threshold the worked minutes strictly exceed, if any. */
export function applicableBreakRule<Rule extends BreakDueRegulation["breakRules"][number]>(
	rules: readonly Rule[],
	workedMinutes: number,
): Rule | undefined {
	return rules.reduce<Rule | undefined>((best, rule) => {
		if (workedMinutes <= rule.workingMinutesThreshold) return best;
		return !best || rule.workingMinutesThreshold > best.workingMinutesThreshold ? rule : best;
	}, undefined);
}

function wholeMinutesBetween(from: Instant, to: Instant): number {
	return Math.floor(from.until(to).total({ unit: "minutes" }));
}

/**
 * When live work breaks the effective work policy's break rules if no break is taken. The web
 * break warning and the break-due reminder both read this, so they never disagree.
 */
export function breakDueStatus(input: BreakDueInput): BreakDueStatus {
	const uninterruptedMinutes = wholeMinutesBetween(input.liveStart, input.now);
	const limit = input.regulation?.maxUninterruptedMinutes ?? null;
	const breaches: BreakDue[] = [];
	if (limit) {
		breaches.push({
			rule: { kind: "max_uninterrupted", limitMinutes: limit },
			at: input.liveStart.add({ minutes: limit }),
		});
	}
	const rules = [...(input.regulation?.breakRules ?? [])].sort(
		(left, right) => left.workingMinutesThreshold - right.workingMinutesThreshold,
	);
	for (const rule of rules) {
		// Breaks already taken meet the rule; a new break ends the live work.
		if (rule.requiredBreakMinutes <= input.breakMinutes) continue;
		const minutesLeft = Math.max(0, rule.workingMinutesThreshold - input.completedMinutes);
		breaches.push({
			rule: {
				kind: "break_rule",
				workingMinutesThreshold: rule.workingMinutesThreshold,
				requiredBreakMinutes: rule.requiredBreakMinutes,
			},
			at: input.liveStart.add({ minutes: minutesLeft }),
		});
	}
	// Stable: on a tie the uninterrupted limit comes first, then the lower threshold.
	breaches.sort((left, right) => compareInstants(left.at, right.at));
	const required = applicableBreakRule(rules, input.completedMinutes + uninterruptedMinutes);
	return {
		uninterruptedMinutes,
		breaches,
		minutesUntilUninterruptedLimit: limit ? limit - uninterruptedMinutes : null,
		requirement: required
			? {
					totalNeeded: required.requiredBreakMinutes,
					taken: input.breakMinutes,
					remaining: Math.max(0, required.requiredBreakMinutes - input.breakMinutes),
				}
			: null,
	};
}
