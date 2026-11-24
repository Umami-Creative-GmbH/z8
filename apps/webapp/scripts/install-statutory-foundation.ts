import { Pool } from "pg";
import { getPostgresSslConfig } from "../src/db/postgres-ssl";
import { withUtcPostgresSession } from "../src/db/postgres-utc";
import { installStatutoryFoundation } from "../src/db/install-statutory-foundation";

async function main() {
	for (const name of [
		"POSTGRES_HOST",
		"POSTGRES_PORT",
		"POSTGRES_DB",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
	]) {
		if (process.env[name] === undefined || (name !== "POSTGRES_PASSWORD" && !process.env[name])) {
			throw new Error(`Missing ${name}; run this command through Phase.`);
		}
	}
	const port = Number(process.env.POSTGRES_PORT);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("POSTGRES_PORT must be a valid port number.");
	}
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
		await installStatutoryFoundation(pool);
		console.log("Installed German statutory baselines, guards and overlap constraints.");
	} finally {
		await pool.end();
	}
}

main().catch(() => {
	console.error(
		"Could not install the statutory foundation. Check POSTGRES_* configuration, database permissions, and that schema push has completed.",
	);
	process.exitCode = 1;
});
