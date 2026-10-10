import { Data } from "effect";
import type { AbsenceDaysRefusal } from "@/lib/absences/absence-days";

export class ValidationError extends Data.TaggedError("ValidationError")<{
	message: string;
	field?: string;
	value?: unknown;
}> {}

export class AuthenticationError extends Data.TaggedError("AuthenticationError")<{
	message: string;
	userId?: string;
}> {}

export class AuthorizationError extends Data.TaggedError("AuthorizationError")<{
	message: string;
	userId?: string;
	resource?: string;
	action?: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
	message: string;
	operation: string;
	table?: string;
	cause?: unknown;
}> {}

export class EmailError extends Data.TaggedError("EmailError")<{
	message: string;
	recipient?: string;
	cause?: unknown;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
	message: string;
	entityType: string;
	entityId?: string;
}> {}

export class ConflictError extends Data.TaggedError("ConflictError")<{
	message: string;
	conflictType: string;
	details?: Record<string, unknown>;
}> {}

export class StripeError extends Data.TaggedError("StripeError")<{
	message: string;
	operation: string;
	stripeCode?: string;
	cause?: unknown;
}> {}

export class BillingError extends Data.TaggedError("BillingError")<{
	message: string;
	reason:
		| "subscription_required"
		| "trial_expired"
		| "payment_failed"
		| "canceled"
		| "billing_disabled";
	organizationId?: string;
}> {}

/** A failed job-queue (BullMQ/Redis) call. */
export class QueueError extends Data.TaggedError("QueueError")<{
	message: string;
	operation: string;
	cause?: unknown;
}> {}

/**
 * A failed call to an outside service that has no error of its own here, such
 * as an accounting tool or the organization secret store. `message` is shown
 * to users: keep it generic and never copy the cause's message into it.
 */
export class ExternalServiceError extends Data.TaggedError("ExternalServiceError")<{
	message: string;
	service: string;
	operation: string;
	cause?: unknown;
}> {}

/**
 * A change refused because it touches a closed month (#762, Time Tracking
 * ADR-0004). `month` is `YYYY-MM`. Writers raise it before writing; the
 * database refusal behind them surfaces as the same error
 * (`closed-months/refusal.ts`).
 */
export class MonthClosedError extends Data.TaggedError("MonthClosedError")<{
	message: string;
	month: string;
}> {}

/** An absence request refused for its absence days, such as vacation on no working day (#979). */
export class AbsenceDaysRefusedError extends Data.TaggedError("AbsenceDaysRefusedError")<{
	message: string;
	reason: AbsenceDaysRefusal;
}> {}

export type AnyAppError =
	| ValidationError
	| AuthenticationError
	| AuthorizationError
	| DatabaseError
	| EmailError
	| NotFoundError
	| ConflictError
	| StripeError
	| BillingError
	| QueueError
	| ExternalServiceError
	| MonthClosedError
	| AbsenceDaysRefusedError;
