export type BillingSuspensionReason =
	| "subscription_required"
	| "trial_expired"
	| "payment_failed"
	| "canceled";

export type BillingAccessState =
	| "disabled"
	| "trialing"
	| "active"
	| "suspended";

export interface BillingAccessSubscriptionInput {
	status: string;
	trialEnd: Date | null;
	cancelAt: Date | null;
}

export interface BillingAccessResult {
	canAccess: boolean;
	state: BillingAccessState;
	reason?: BillingSuspensionReason;
	trialEndsAt?: Date | null;
	status?: string;
	daysRemaining?: number;
}

interface EvaluateBillingAccessInput {
	billingEnabled: boolean;
	subscription: BillingAccessSubscriptionInput | null;
	now?: Date;
}

export function getDaysRemaining(end: Date, now: Date = new Date()): number {
	return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function evaluateBillingAccess({
	billingEnabled,
	subscription,
	now = new Date(),
}: EvaluateBillingAccessInput): BillingAccessResult {
	if (!billingEnabled) {
		return { canAccess: true, state: "disabled" };
	}

	if (!subscription) {
		return {
			canAccess: false,
			state: "suspended",
			reason: "subscription_required",
		};
	}

	const { status, trialEnd } = subscription;

	if (status === "trialing") {
		if (!trialEnd || trialEnd.getTime() <= now.getTime()) {
			return {
				canAccess: false,
				state: "suspended",
				reason: "trial_expired",
				trialEndsAt: trialEnd,
				status,
			};
		}

		return {
			canAccess: true,
			state: "trialing",
			trialEndsAt: trialEnd,
			status,
			daysRemaining: getDaysRemaining(trialEnd, now),
		};
	}

	if (status === "active") {
		return { canAccess: true, state: "active", status };
	}

	if (status === "past_due") {
		return {
			canAccess: false,
			state: "suspended",
			reason: "payment_failed",
			status,
		};
	}

	if (status === "canceled" || status === "unpaid") {
		return {
			canAccess: false,
			state: "suspended",
			reason: "canceled",
			status,
		};
	}

	return {
		canAccess: false,
		state: "suspended",
		reason: "subscription_required",
		status,
	};
}
