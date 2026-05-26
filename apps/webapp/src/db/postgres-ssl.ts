import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
import { env as appEnv } from "@/env";

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

export function getPostgresSslConfig(
	env: PostgresSslEnv = appEnv,
	readCertificateFile: ReadCertificateFile = (path) => readFileSync(path, "utf8")
): PostgresSslConfig {
	const mode = (env.POSTGRES_SSL_MODE ?? "disable") as PostgresSslMode;

	if (!SSL_MODES.has(mode)) {
		throw new Error(
			`POSTGRES_SSL_MODE must be one of: ${Array.from(SSL_MODES).join(", ")}`
		);
	}

	if (mode === "disable") {
		return false;
	}

	const ca = env.POSTGRES_SSL_CA_CERT ??
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
