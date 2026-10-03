import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/** Resolve the installed Node CLI without executing a platform-specific package-manager shim. */
export function installedCli(name: "vitest" | "tsx"): string {
	const manifest = createRequire(import.meta.url).resolve(`${name}/package.json`);
	const { bin } = JSON.parse(readFileSync(manifest, "utf8")) as {
		bin: string | Record<string, string>;
	};
	return resolve(dirname(manifest), typeof bin === "string" ? bin : bin[name]);
}
