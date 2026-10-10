/**
 * The outcome of sending one notification by push. `sendPushToUser()` in
 * push-service.ts sums the results of its two channels, web push and native
 * push (#843), which both return this shape.
 */
export interface PushDeliveryResult {
	sent: number;
	failed: number;
	/** Ids of subscriptions or device tokens that were deactivated as dead. */
	expired: string[];
}

/** Shared result of a channel that sent nothing; callers never mutate it. */
export const NOTHING_SENT: PushDeliveryResult = { sent: 0, failed: 0, expired: [] };
