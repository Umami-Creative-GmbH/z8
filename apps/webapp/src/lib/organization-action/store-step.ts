import { Effect } from "effect";
import {
	AbsenceDaysRefusedError,
	type AnyAppError,
	AuthenticationError,
	AuthorizationError,
	BillingError,
	ConflictError,
	DatabaseError,
	EmailError,
	ExternalServiceError,
	KioskSeatsNotConfiguredError,
	MonthClosedError,
	NotFoundError,
	QueueError,
	StripeError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ActionRefusal } from "@/lib/effect/refusal-action";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";

const APP_ERRORS = [
	ValidationError,
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	EmailError,
	NotFoundError,
	ConflictError,
	StripeError,
	BillingError,
	KioskSeatsNotConfiguredError,
	QueueError,
	ExternalServiceError,
	MonthClosedError,
	AbsenceDaysRefusedError,
];

function isAppError(error: unknown): error is AnyAppError {
	return APP_ERRORS.some((errorClass) => error instanceof errorClass);
}

export interface StoreStepOptions<Code extends string, Details extends object> {
	/**
	 * The store's refusal class. A refusal of it becomes a `ValidationError` whose
	 * `refusal` is its stable code (the client's `result.refusal`) and whose
	 * `value` holds its details, if any (the client's `result.details`).
	 */
	readonly refusal?: abstract new (
		...args: never[]
	) => ActionRefusal<Code, Details>;
	/** The message of a `DatabaseError` for any other failure; the query's own by default. */
	readonly failure?: string;
}

type Outcome<T> = { ok: true; data: T } | { ok: false; error: AnyAppError };

/**
 * The one way an `organizationAction` handler runs Promise-style store work
 * (#1592): with the runtime's database client, inside a `db.query.<name>` span.
 *
 * - A tagged error the store throws (`ValidationError`, `NotFoundError`, …)
 *   keeps its type and message.
 * - A refusal of `options.refusal`'s class (thrown after any transaction it
 *   ran in has rolled back) becomes a `ValidationError` with its code.
 * - Anything else is a `DatabaseError`, worded by `options.failure` when given.
 */
export function storeStep<T, Code extends string = string, Details extends object = object>(
	name: string,
	run: (db: DatabaseClient) => Promise<T>,
	options: StoreStepOptions<Code, Details> = {},
): Effect.Effect<T, AnyAppError, DatabaseService> {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService
			.query(name, () =>
				// Async, so a refusal thrown before `run`'s first await is caught too.
				(async () => run(dbService.db))().then(
					(data): Outcome<T> => ({ ok: true, data }),
					(error: unknown): Outcome<T> => {
						if (options.refusal && error instanceof options.refusal) {
							return { ok: false, error: refusalError(error) };
						}
						if (isAppError(error)) return { ok: false, error };
						throw error;
					},
				),
			)
			.pipe(
				Effect.mapError((error) =>
					options.failure
						? new DatabaseError({ message: options.failure, operation: name, cause: error.cause })
						: error,
				),
			);
		if (!outcome.ok) return yield* Effect.fail(outcome.error);
		return outcome.data;
	});
}

function refusalError(refused: ActionRefusal<string, object>): ValidationError {
	const details =
		refused.details && Object.keys(refused.details).length > 0 ? refused.details : undefined;
	return new ValidationError({
		message: refused.message,
		refusal: refused.code,
		...(details ? { value: details } : {}),
	});
}
