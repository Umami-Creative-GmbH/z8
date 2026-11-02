import type { db } from "@/db";

type Database = typeof db;

/**
 * Runs reads in one read-only, repeatable-read transaction: every read sees one snapshot, and
 * PostgreSQL itself refuses any write inside. The transaction has the database's query surface,
 * so loaders that take the application database run through it unchanged.
 */
export function readOnlyTransaction<T>(
	database: Database,
	read: (reader: Database) => Promise<T>,
): Promise<T> {
	return database.transaction((tx) => read(tx as unknown as Database), {
		accessMode: "read only",
		isolationLevel: "repeatable read",
	});
}
