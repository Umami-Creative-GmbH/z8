/**
 * Queueing a personal data export's build from a server action (#811). The
 * queue is not database work, so its failure is a `QueueError`, not a
 * `DatabaseError` (docs/refs/effect.md › Database Access). A failed enqueue
 * has already marked the export failed, so the requester can try again at once.
 */

import { Effect } from "effect";
import type { db } from "@/db";
import { QueueError } from "@/lib/effect/errors";
import { enqueuePersonalDataExport, type PersonalDataExportJobInput } from "./processor";

export function enqueuePersonalDataExportBuild(
	database: typeof db,
	input: PersonalDataExportJobInput,
): Effect.Effect<void, QueueError> {
	const failure = (cause?: unknown) =>
		new QueueError({
			message: "The export could not be started. Please try again.",
			operation: "personalDataExport.enqueue",
			cause,
		});
	return Effect.tryPromise({
		try: () => enqueuePersonalDataExport(database, input),
		catch: failure,
	}).pipe(Effect.flatMap((queued) => (queued ? Effect.void : Effect.fail(failure()))));
}
