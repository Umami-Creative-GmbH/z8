import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// drizzle-kit does not export its package.json, so walk up from its main entry.
function findDrizzleKitPackageDirectory() {
	let directory = path.dirname(require.resolve("drizzle-kit"));

	for (;;) {
		try {
			const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
			if (manifest.name === "drizzle-kit") {
				return { directory, manifest };
			}
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}

		const parent = path.dirname(directory);
		if (parent === directory) {
			throw new Error("Could not find the installed drizzle-kit package.");
		}
		directory = parent;
	}
}

export function resolveDrizzleKitCli() {
	const { directory, manifest } = findDrizzleKitPackageDirectory();
	const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.["drizzle-kit"];

	if (!bin) {
		throw new Error("The installed drizzle-kit package declares no drizzle-kit bin.");
	}

	return path.join(directory, bin);
}

// Runs drizzle-kit through Node rather than `pnpm exec`: as a non-root user,
// pnpm tries to re-link the root-owned bin shim and fails with ERR_PNPM_CMD_SHIM_CHMOD.
export function getMigrateCommand(env = process.env) {
	if (env.DRIZZLE_MIGRATE_COMMAND != null) {
		return { command: env.DRIZZLE_MIGRATE_COMMAND, args: [], shell: true };
	}

	return {
		command: process.execPath,
		args: [resolveDrizzleKitCli(), "migrate", "--config", "./drizzle.config.ts"],
		shell: false,
	};
}
