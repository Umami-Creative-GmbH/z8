#!/usr/bin/env node
/** Explicit operator run through the existing label-owned PostgreSQL suite runner. Never targets an app database. */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const output = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
if (!output || !isAbsolute(output)) {
	console.error(
		"Provide an absolute reviewed output file with --out before starting index measurements; acceptance remains unfulfilled.",
	);
	process.exitCode = 2;
} else {
	const destination = resolve(output);
	try {
		await access(destination).then(
			() => {
				throw new Error("Evidence already exists; choose a fresh output.");
			},
			() => {},
		);
		if (!process.env.npm_execpath)
			throw new Error("Use pnpm to run this operator command.");
		const log = createWriteStream(`${destination}.operator-private.log`, {
			flags: "wx",
			mode: 0o600,
		});
		await new Promise((done, reject) => {
			log.once("open", done);
			log.once("error", reject);
		});
		try {
			const code = await new Promise((done, reject) => {
				const child = spawn(
					process.env.npm_execpath,
					[
						"--config.verifyDepsBeforeRun=false",
						"--filter",
						"webapp",
						"test:integration",
						"src/lib/analytics/absence-pattern-indexes.integration.test.ts",
						"--reporter",
						"verbose",
					],
					{
						cwd: fileURLToPath(new URL("../../", import.meta.url)),
						env: { ...process.env, Z8_ABSENCE_INDEX_EVIDENCE: destination },
						stdio: ["ignore", log, log],
						windowsHide: true,
					},
				);
				child.once("error", reject);
				child.once("exit", done);
			});
			if (code !== 0)
				throw new Error(
					"Fixture measurement failed; inspect the private operator log.",
				);
		} finally {
			log.end();
		}
		const evidence = JSON.parse(await readFile(destination, "utf8"));
		if (evidence.variants?.length !== 5 || evidence.conditions?.length !== 24)
			throw new Error("Representative evidence is incomplete.");
		console.log(
			"Recorded 24 scoped caller conditions, 4 index configurations and an ending baseline repeat. Fixture evidence is ready for review; the schema decision remains unreviewed.",
		);
	} catch (error) {
		console.error(
			error.message?.startsWith("Evidence") ||
				error.message?.startsWith("Use pnpm") ||
				error.message?.startsWith("Fixture") ||
				error.message?.startsWith("Representative")
				? error.message
				: "Index measurement unavailable; inspect the private operator log. Acceptance remains unfulfilled.",
		);
		process.exitCode = 1;
	}
}
