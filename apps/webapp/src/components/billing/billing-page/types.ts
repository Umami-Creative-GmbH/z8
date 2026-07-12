export interface SubscriptionInfo {
	id: string;
	hasStripeCustomer: boolean;
	hasStripeSubscription: boolean;
	status: string;
	isActive: boolean;
	isTrialing: boolean;
	isPastDue: boolean;
	currentSeats: number;
	trialEnd: string | null;
	currentPeriodEnd: string | null;
	billingInterval: string | null;
	cancelAt: string | null;
}

export interface AccessResult {
	canAccess: boolean;
	reason?: string;
	trialEndsAt?: string | null;
	status?: string;
}

export interface BillingPageClientProps {
	subscription: SubscriptionInfo | null;
	accessResult: AccessResult;
	isOwner: boolean;
}
