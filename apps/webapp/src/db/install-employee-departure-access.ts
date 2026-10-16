import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

/** Schema push cannot install SQL functions; reuse the migration as their source of truth. */
export async function installEmployeeDepartureAccess(
	pool: Pick<Pool, "connect">,
): Promise<void> {
	const migration = await readFile(
		new URL(
			"../../drizzle/0072_employee_departure_access.sql",
			import.meta.url,
		),
		"utf8",
	);
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("SET LOCAL search_path TO public");
		await client.query("SET LOCAL lock_timeout = '10s'");
		await client.query(migration);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
