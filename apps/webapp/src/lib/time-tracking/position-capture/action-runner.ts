import "server-only";

import { Effect } from "effect";
import {
	AuthenticationError,
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";

type PositionCaptureActionError =
	| AuthenticationError
	| AuthorizationError
	| ConflictError
	| DatabaseError
	| NotFoundError
	| ValidationError;

/**
 * Runs a position capture server action with the client of the runtime's
 * `DatabaseService`. Typed failures thrown by the action keep their type, so
 * their safe messages reach the user.
 */
export async function runPositionCaptureAction<T>(
	name: string,
	action: (db: DatabaseClient) => Promise<T>,
): Promise<ServerActionResult<T>> {
	return runServerActionSafe(
		DatabaseService.use((dbService) => dbService.query(name, () => action(dbService.db))).pipe(
			Effect.mapError((error) => (isActionError(error.cause) ? error.cause : error)),
		),
	);
}

function isActionError(error: unknown): error is PositionCaptureActionError {
	return (
		error instanceof AuthenticationError ||
		error instanceof AuthorizationError ||
		error instanceof ConflictError ||
		error instanceof DatabaseError ||
		error instanceof NotFoundError ||
		error instanceof ValidationError
	);
}
