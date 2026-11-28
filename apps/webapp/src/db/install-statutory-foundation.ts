import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

/**
 * Schema push creates the statutory tables but not what lives only in SQL: the German baseline
 * seed, the baseline and acknowledgement guard triggers, `btree_gist` and the overlap exclusion
 * constraints. Migration 0333 is idempotent, so it is re-applied as their source of truth.
 */
export async function installStatutoryFoundation(pool: Pick<Pool, "connect">): Promise<void> {
	const migration = await readFile(
		new URL("../../drizzle/0333_statutory_foundation.sql", import.meta.url),
		"utf8",
	);
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("SET LOCAL search_path TO public");
		await client.query("SET LOCAL lock_timeout = '10s'");
		await client.query(migration);
		await client.query(
			await readFile(
				new URL("../../drizzle/0345_agricultural_short_term.sql", import.meta.url),
				"utf8",
			),
		);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
