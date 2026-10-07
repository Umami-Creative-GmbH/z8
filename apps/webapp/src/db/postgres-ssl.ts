import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

type PostgresSslMode = "disable" | "prefer" | "require" | "verify-ca" | "verify-full";

type PostgresSslEnv = {
	POSTGRES_SSL_MODE?: string;
	POSTGRES_SSL_CA_CERT?: string;
	POSTGRES_SSL_ROOT_CERT_PATH?: string;
};

type ReadCertificateFile = (path: string) => string;

export type PostgresSslConfig = false | ConnectionOptions;

const SSL_MODES = new Set<PostgresSslMode>([
	"disable",
	"prefer",
	"require",
	"verify-ca",
	"verify-full",
]);

// Reads process.env rather than @/env: drizzle.config.ts loads this module, and the
// migration image receives only POSTGRES_* variables, not the full app env.
// Empty values count as unset, matching the app env's emptyStringAsUndefined.
export function getPostgresSslConfig(
	env: PostgresSslEnv = {
		POSTGRES_SSL_MODE: process.env.POSTGRES_SSL_MODE,
		POSTGRES_SSL_CA_CERT: process.env.POSTGRES_SSL_CA_CERT,
		POSTGRES_SSL_ROOT_CERT_PATH: process.env.POSTGRES_SSL_ROOT_CERT_PATH,
	},
	readCertificateFile: ReadCertificateFile = (path) => readFileSync(path, "utf8"),
): PostgresSslConfig {
	const mode = (env.POSTGRES_SSL_MODE || "disable") as PostgresSslMode;

	if (!SSL_MODES.has(mode)) {
		throw new Error(`POSTGRES_SSL_MODE must be one of: ${Array.from(SSL_MODES).join(", ")}`);
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
