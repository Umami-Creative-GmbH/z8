export interface SubscriptionConversionRow {
	status: string;
	trialEnd: Date | null;
}

const CONVERTED_STATUSES = new Set(["active", "past_due"]);

/**
 * Percentage of resolved trials (ended trials, plus trials that already converted
 * or canceled early) that converted to a paid subscription (`active` or `past_due`).
 * In-progress trials (`trialing` with `trialEnd > now`) and direct subscriptions
 * with no trial (`trialEnd === null`) are excluded from the denominator.
 */
export function computeTrialConversionRate(
	subscriptions: readonly SubscriptionConversionRow[],
	now: Date = new Date(),
): number {
	const resolvedTrials = subscriptions.filter((sub) => {
		if (sub.trialEnd === null) return false;
		if (sub.status === "trialing" && sub.trialEnd > now) return false;
		return true;
	});

	if (resolvedTrials.length === 0) {
		return 0;
	}

	const convertedCount = resolvedTrials.filter((sub) => CONVERTED_STATUSES.has(sub.status)).length;
	return Math.round((convertedCount / resolvedTrials.length) * 100);
}
