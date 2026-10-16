/** Run from apps/webapp: phase run -- pnpm exec tsx scripts/apply-employment-wage-conversion.ts */
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { getPostgresSslConfig } from "../src/db/postgres-ssl";
import { withUtcPostgresSession } from "../src/db/postgres-utc";

async function main() {
	for (const name of [
		"POSTGRES_HOST",
		"POSTGRES_PORT",
		"POSTGRES_DB",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
	]) {
		if (
			process.env[name] === undefined ||
			(name !== "POSTGRES_PASSWORD" && !process.env[name])
		) {
			throw new Error(`Missing ${name}; run this command through Phase.`);
		}
	}
	const port = Number(process.env.POSTGRES_PORT);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("POSTGRES_PORT must be a valid port number.");
	}
	const migration = readFileSync(
		new URL(
			"../drizzle/0228_employment_terms_numeric_wage.sql",
			import.meta.url,
		),
		"utf8",
	);
	const pool = new Pool(
		withUtcPostgresSession({
			host: process.env.POSTGRES_HOST,
			port,
			database: process.env.POSTGRES_DB,
			user: process.env.POSTGRES_USER,
			password: process.env.POSTGRES_PASSWORD,
			ssl: getPostgresSslConfig(),
			options: process.env.PGOPTIONS,
			connectionTimeoutMillis: 10_000,
			max: 1,
		}),
	);
	try {
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("SET LOCAL search_path TO public");
			await client.query("SET LOCAL lock_timeout = '10s'");
			await client.query(
				"LOCK TABLE employee_employment_history IN ACCESS EXCLUSIVE MODE",
			);
			const {
				rows: [column],
			} = await client.query<{
				data_type: string;
				numeric_precision: number | null;
				numeric_scale: number | null;
			}>(`SELECT data_type, numeric_precision, numeric_scale
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'employee_employment_history'
					AND column_name = 'hourly_rate'`);
			if (
				column?.data_type === "numeric" &&
				column.numeric_precision === 10 &&
				column.numeric_scale === 2
			) {
				await client.query("COMMIT");
				console.log(
					"hourly_rate is already numeric(10,2); no conversion needed.",
				);
				return;
			}
			if (
				!column ||
				!["text", "character varying", "character"].includes(column.data_type)
			) {
				throw new Error(
					"Expected employee_employment_history.hourly_rate to be text or numeric(10,2).",
				);
			}
			await client.query(migration);
			await client.query("COMMIT");
			console.log(
				"Converted employee_employment_history.hourly_rate to numeric(10,2); blank wages became null. Retry drizzle-kit push.",
			);
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	} finally {
		await pool.end();
	}
}

main().catch((error: unknown) => {
	// PostgreSQL messages can include the wage value that failed to cast.
	if (error && typeof error === "object" && "code" in error) {
		const code = String(error.code);
		console.error(
			`Wage conversion failed (${/^[A-Z0-9]{5}$/.test(code) ? code : "database error"}); no changes committed. Check the column values and database access.`,
		);
	} else {
		console.error(
			error instanceof Error ? error.message : "Wage conversion failed.",
		);
	}
	process.exitCode = 1;
});
