import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
	parseDrainGateConfig,
	runBoundaryAwareMigrations,
	runCommandWithLockRetry,
} from "./boundary-migration-engine.js";
import { getMigrateCommand } from "./drizzle-migrate-command.js";

const utcPostgresOption = "-c timezone=UTC";

function withUtcPostgresOptions(options) {
	const existingOptions = options?.trim();
	return existingOptions ? `${existingOptions} ${utcPostgresOption}` : utcPostgresOption;
}

process.env.TZ ||= "UTC";
process.env.PGOPTIONS = withUtcPostgresOptions(process.env.PGOPTIONS);

const sslModes = new Set(["disable", "prefer", "require", "verify-ca", "verify-full"]);

function getPostgresSslConfig(
	env = process.env,
	readCertificateFile = (certPath) => readFileSync(certPath, "utf8"),
) {
	const mode = env.POSTGRES_SSL_MODE || "disable";

	if (!sslModes.has(mode)) {
		throw new Error(`POSTGRES_SSL_MODE must be one of: ${Array.from(sslModes).join(", ")}`);
	}

	if (mode === "disable") {
		return false;
	}

	const ca =
		env.POSTGRES_SSL_CA_CERT ||
		(env.POSTGRES_SSL_ROOT_CERT_PATH
			? readCertificateFile(env.POSTGRES_SSL_ROOT_CERT_PATH)
			: undefined);

	if (mode === "prefer" || mode === "require") {
		return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
	}

	return {
		...(ca ? { ca } : {}),
		...(mode === "verify-ca" ? { checkServerIdentity: () => undefined } : {}),
		rejectUnauthorized: true,
	};
}

const lockIdRaw = process.env.DB_MIGRATION_LOCK_ID ?? "74382643";
const lockId = Number.parseInt(lockIdRaw, 10);

if (!Number.isInteger(lockId)) {
	throw new Error("DB_MIGRATION_LOCK_ID must be an integer.");
}

const drainGateConfig = parseDrainGateConfig(process.env);

const databaseUrl =
	process.env.DATABASE_URL ||
	(() => {
		const host = process.env.POSTGRES_HOST;
		const port = process.env.POSTGRES_PORT;
		const database = process.env.POSTGRES_DB;
		const user = process.env.POSTGRES_USER;
		const password = process.env.POSTGRES_PASSWORD;

		if (!host || !port || !database || !user || !password) {
			return null;
		}

		return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
	})();

if (!databaseUrl) {
	throw new Error(
		"DATABASE_URL is required, or POSTGRES_HOST/POSTGRES_PORT/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD must all be set.",
	);
}

const hasExplicitSslConfig =
	process.env.POSTGRES_SSL_MODE ||
	process.env.POSTGRES_SSL_CA_CERT ||
	process.env.POSTGRES_SSL_ROOT_CERT_PATH;

const migrationsFolder =
	process.env.DRIZZLE_MIGRATIONS_FOLDER ||
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

const run = async () => {
	const clientConfig = {
		connectionString: databaseUrl,
		options: process.env.PGOPTIONS,
		...(hasExplicitSslConfig ? { ssl: getPostgresSslConfig() } : {}),
	};

	const lockClient = new Client(clientConfig);
	await lockClient.connect();

	try {
		await lockClient.query("SELECT pg_advisory_lock($1);", [lockId]);

		if (process.env.DRIZZLE_MIGRATE_COMMAND != null) {
			const migrateCommand = getMigrateCommand(process.env);
			await runCommandWithLockRetry(migrateCommand, {
				stepName: "custom-migrate-command",
				maxRetries: drainGateConfig.lockRetries,
				spawnSyncImpl: spawnSync,
			});
			return;
		}

		const workClient = new Client(clientConfig);
		await workClient.connect();
		try {
			await runBoundaryAwareMigrations({
				client: workClient,
				migrationsFolder,
				allowContractConstraints: drainGateConfig.allowContractConstraints,
				allowPolicyV1Seal: drainGateConfig.allowPolicyV1Seal,
				lockRetries: drainGateConfig.lockRetries,
			});
		} finally {
			await workClient.end();
		}
	} finally {
		try {
			await lockClient.query("SELECT pg_advisory_unlock($1);", [lockId]);
		} finally {
			await lockClient.end();
		}
	}
};

run().catch((error) => {
	// eslint-disable-next-line no-console
	console.error(error);
	process.exit(1);
});
