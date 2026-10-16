export interface SubscriptionInfo {
	id: string;
	hasStripeCustomer: boolean;
	hasStripeSubscription: boolean;
	status: string;
	isActive: boolean;
	isTrialing: boolean;
	isPastDue: boolean;
	/** Every billable seat, full and kiosk. */
	currentSeats: number;
	/** The kiosk seat part of `currentSeats` (#886). */
	currentKioskSeats?: number;
	/** Whether kiosk seats are on (both kiosk prices configured); off, every seat is a full seat. */
	kioskSeatsEnabled?: boolean;
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
	/** Whether kiosk seats are on; the pricing cards then show the kiosk seat price too (#886). */
	kioskSeatsEnabled?: boolean;
}
