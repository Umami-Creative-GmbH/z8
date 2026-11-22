export interface SubscriptionConversionRow {
	status: string;
}

/**
 * Percentage of all tracked subscriptions (active, trialing, past_due, canceled,
 * unpaid, paused) that are currently active paid subscriptions.
 */
export function computeTrialConversionRate(
	subscriptions: readonly SubscriptionConversionRow[],
): number {
	if (subscriptions.length === 0) {
		return 0;
	}

	const activeCount = subscriptions.filter((sub) => sub.status === "active").length;
	return Math.round((activeCount / subscriptions.length) * 100);
}
