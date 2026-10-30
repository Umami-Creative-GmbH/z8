import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	preserveProjectionProgress,
	projectionFailure,
	projectionInitializationArgs,
} from "./projection-initialization.mjs";

const app = fileURLToPath(new URL("../../apps/webapp/", import.meta.url));
const require = createRequire(
	new URL("../../apps/webapp/package.json", import.meta.url),
);
test("normal initializer loader reaches real server-only dependencies with its supported worker preload", () => {
	const args = projectionInitializationArgs(
		"manifest",
		"progress",
		"2026-10-24T12:00:00Z",
	);
	const entry = args.indexOf("scripts/initialize-performance-projections.ts");
	assert.ok(entry > 2);
	const loader = args.slice(2, entry);
	const missingPreload = spawnSync(
		process.execPath,
		[require.resolve("tsx/cli"), "-e", "import('server-only')"],
		{ cwd: app, encoding: "utf8" },
	);
	assert.notEqual(missingPreload.status, 0);
	assert.match(
		missingPreload.stderr,
		/cannot be imported from a Client Component/,
	);
	const output = execFileSync(
		process.execPath,
		[
			require.resolve("tsx/cli"),
			...loader,
			"-e",
			"import('server-only').then(()=>console.log('server-runtime-ready'))",
		],
		{ cwd: app, encoding: "utf8" },
	);
	assert.match(output, /server-runtime-ready/);
});
test("a new initializer attempt retains the exact previous failed progress without resetting it", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-projection-progress-"));
	try {
		const previous = JSON.stringify({
			status: "failed",
			total: 208,
			rebuilt: 3,
		});
		await writeFile(
			join(directory, "fixture-projection-progress.json"),
			previous,
		);
		await preserveProjectionProgress(directory);
		const backup = (await readdir(directory)).find((name) =>
			name.endsWith("-previous-private.json"),
		);
		assert.ok(backup);
		assert.equal(await readFile(join(directory, backup), "utf8"), previous);
		assert.equal(
			await readFile(
				join(directory, "fixture-projection-progress.json"),
				"utf8",
			),
			previous,
		);
	} finally {
		await rm(directory, { recursive: true });
	}
});
test("private initializer failure classification never exports raw SQL or fixture credentials", () => {
	const loader = projectionFailure(
		new Error(
			"This module cannot be imported from a Client Component module. It should only be used from a Server Component.",
		),
		"load-work-balance-api",
	);
	assert.equal(loader.reason, "server-only-loader");
	const hidden = projectionFailure(
		new Error("postgresql://private:secret@db select protected_values"),
		"rebuild-projection",
	);
	assert.equal(JSON.stringify(hidden).includes("secret"), false);
	assert.equal(JSON.stringify(hidden).includes("select"), false);
	assert.equal(hidden.stage, "rebuild-projection");
});
