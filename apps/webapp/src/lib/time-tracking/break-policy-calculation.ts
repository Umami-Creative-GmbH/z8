export interface BreakPolicyRule {
	workingMinutesThreshold: number;
	requiredBreakMinutes: number;
}

export interface BreakPolicyRegulation {
	id: string;
	name: string;
	maxUninterruptedMinutes: number | null;
	breakRules: readonly BreakPolicyRule[];
}

export interface BreakDeficitResult {
	deficit: number;
	applicableRule: BreakPolicyRule | null;
	regulationId: string | null;
	regulationName: string | null;
	maxUninterruptedMinutes: number | null;
}

export function calculateBreakDeficit(input: {
	sessionDurationMinutes: number;
	alreadyTakenBreakMinutes: number;
	regulation: BreakPolicyRegulation | null;
}): BreakDeficitResult {
	if (!input.regulation) {
		return {
			deficit: 0,
			applicableRule: null,
			regulationId: null,
			regulationName: null,
			maxUninterruptedMinutes: null,
		};
	}

	const applicableRule = input.regulation.breakRules.reduce<
		BreakPolicyRule | undefined
	>((best, rule) => {
		if (input.sessionDurationMinutes <= rule.workingMinutesThreshold)
			return best;
		return !best || rule.workingMinutesThreshold > best.workingMinutesThreshold
			? rule
			: best;
	}, undefined);

	return {
		deficit: applicableRule
			? Math.max(
					0,
					applicableRule.requiredBreakMinutes - input.alreadyTakenBreakMinutes,
				)
			: 0,
		applicableRule: applicableRule
			? {
					workingMinutesThreshold: applicableRule.workingMinutesThreshold,
					requiredBreakMinutes: applicableRule.requiredBreakMinutes,
				}
			: null,
		regulationId: input.regulation.id,
		regulationName: input.regulation.name,
		maxUninterruptedMinutes: input.regulation.maxUninterruptedMinutes,
	};
}
