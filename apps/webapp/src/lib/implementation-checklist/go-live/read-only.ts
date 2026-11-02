import type { DatabaseClient } from "@/lib/effect/services/database.service";

/**
 * Runs go-live reads in one read-only, repeatable-read transaction: PostgreSQL itself refuses
 * any write inside, and every read sees one snapshot.
 */
export function readOnlyGoLive<T>(
	db: DatabaseClient,
	read: (reader: DatabaseClient) => Promise<T>,
): Promise<T> {
	return db.transaction((tx) => read(tx as unknown as DatabaseClient), {
		accessMode: "read only",
		isolationLevel: "repeatable read",
	});
}
