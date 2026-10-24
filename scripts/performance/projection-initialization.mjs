/** Normal server-process loader and bounded diagnostics for the guarded fixture initializer. */
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
export function projectionInitializationArgs(manifest, progress, asOf) {
	return [
		"exec",
		"tsx",
		"--tsconfig",
		"./tsconfig.json",
		"--import",
		"./src/worker-preload.mjs",
		"scripts/initialize-performance-projections.ts",
		manifest,
		progress,
		asOf,
	];
}
export async function preserveProjectionProgress(directory) {
	const source = join(directory, "fixture-projection-progress.json");
	let text;
	try {
		text = await readFile(source, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	await writeFile(
		join(
			directory,
			`fixture-projection-progress-${randomBytes(8).toString("hex")}-previous-private.json`,
		),
		text,
		{ flag: "wx", mode: 0o600 },
	);
}
export function projectionFailure(error, stage) {
	const name =
		typeof error?.name === "string" &&
		/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
			? error.name
			: "Error";
	return {
		stage,
		name,
		code:
			typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
				? error.code
				: null,
		reason:
			typeof error?.message === "string" &&
			error.message.includes(
				"This module cannot be imported from a Client Component module",
			)
				? "server-only-loader"
				: "initializer-runtime",
	};
}
