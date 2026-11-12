import "server-only";
import { Effect } from "effect";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { isPersonnelFilesEnabled } from "./access-store";

/**
 * Personnel file administration in settings (#866, #1592): officer grants,
 * reminder lead time and retention periods. Settings access decides who
 * administers (org admins); these helpers decide when, and run the stores.
 */

/** The `refusal` code of personnel file administration while personnel files are off. */
export const PERSONNEL_FILES_OFF_REFUSAL = "personnel_files_off";

/**
 * Runs `work` only while personnel files are on in the organization. While
 * they are off it is refused with `message`, and nothing runs.
 */
export function whilePersonnelFilesOn<T, E, R>(
	organizationId: string,
	message: string,
	work: Effect.Effect<T, E, R>,
): Effect.Effect<T, E | ValidationError | DatabaseError, R | DatabaseService> {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const enabled = yield* dbService.query("personnelFile.isEnabled", () =>
			isPersonnelFilesEnabled(dbService.db, organizationId),
		);
		if (!enabled) {
			return yield* Effect.fail(
				new ValidationError({ message, refusal: PERSONNEL_FILES_OFF_REFUSAL }),
			);
		}
		return yield* work;
	});
}

/**
 * Promise-style personnel file store work with the runtime's database. The
 * stores refuse with a `ValidationError` or `NotFoundError` written for the
 * administrator; those fail as themselves, anything else stays a `DatabaseError`.
 */
export function personnelFileStoreWork<T>(
	name: string,
	work: (db: DatabaseClient) => Promise<T>,
): Effect.Effect<T, ValidationError | NotFoundError | DatabaseError, DatabaseService> {
	return DatabaseService.use((dbService) =>
		dbService
			.query(name, () => work(dbService.db))
			.pipe(
				Effect.catch((error) =>
					Effect.fail(
						error.cause instanceof ValidationError || error.cause instanceof NotFoundError
							? error.cause
							: error,
					),
				),
			),
	);
}
