import { Data } from "effect";

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

export class AppAccessDeniedError extends Data.TaggedError("AppAccessDeniedError")<{
	message: string;
	appType: "webapp" | "desktop" | "mobile";
	userId: string;
}> {}

export class StripeError extends Data.TaggedError("StripeError")<{
	message: string;
	operation: string;
	stripeCode?: string;
	cause?: unknown;
}> {}

export class BillingError extends Data.TaggedError("BillingError")<{
	message: string;
	reason: "subscription_required" | "trial_expired" | "payment_failed" | "canceled" | "billing_disabled";
	organizationId?: string;
}> {}

export type AnyAppError =
	| ValidationError
	| AuthenticationError
	| AuthorizationError
	| DatabaseError
	| EmailError
	| NotFoundError
	| ConflictError
	| AppAccessDeniedError
	| StripeError
	| BillingError;
