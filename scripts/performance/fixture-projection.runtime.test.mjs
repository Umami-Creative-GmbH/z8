/** Explicit first-missing production-API setup proof; run only on a freshly prepared disposable fixture. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("normal guarded CLI initializes missing fixture projections then preserves all 208 on retry", {
	timeout: 900000,
}, async () => {
	const directory = process.env.Z8_PERFORMANCE_RUNTIME_DIRECTORY;
	assert.ok(
		directory,
		"A freshly prepared disposable fixture directory is required.",
	);
	const progressPath = join(directory, "fixture-projection-progress.json");
	let previous;
	try {
		previous = JSON.parse(await readFile(progressPath, "utf8"));
	} catch (error) {
		// A genuinely fresh fixture has no previous attempt to preserve.
		if (error.code !== "ENOENT") throw error;
	}
	if (previous) {
		assert.equal(previous.total, 208);
		assert.ok(
			previous.rebuilt + previous.preserved < 208,
			"First-missing proof requires incomplete initialization; existing rows must never be reset.",
		);
	}
	const fixture = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
	const run = () =>
		new Promise((done) =>
			execFile(
				process.execPath,
				[
					fixture,
					"initialize-projections",
					directory,
					"--as-of",
					"2026-10-24T12:00:00Z",
				],
				{ timeout: 420000 },
				(error, stdout) => done({ code: error?.code ?? 0, stdout }),
			),
		);
	const cold = await run();
	assert.equal(
		cold.code,
		0,
		"Normal first-missing CLI must succeed; inspect private diagnostics on failure.",
	);
	const initialized = JSON.parse(await readFile(progressPath, "utf8"));
	assert.equal(initialized.status, "complete");
	assert.equal(initialized.total, 208);
	assert.ok(initialized.rebuilt > 0);
	assert.equal(initialized.rebuilt + initialized.preserved, 208);
	const warm = await run();
	assert.equal(warm.code, 0);
	assert.match(warm.stdout, /208 total, 208 preserved, 0 rebuilt/);
});
