/** Explicit opt-in real caller suite. Missing operator runtime is a failure, never a skip. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const cli = fileURLToPath(
	new URL("./ingress-stream-probe.mjs", import.meta.url),
);

test("real local ingress releases useful Dashboard content and full header clock before held secondary reads", {
	timeout: 600000,
}, async () => {
	const directory = process.env.Z8_PERFORMANCE_MULTI_DIRECTORY;
	const source = process.env.Z8_INGRESS_EXPECTED_SOURCE;
	assert.ok(
		directory && source,
		"Parent must supply the isolated running multi-instance fixture and final compiled source after the capture window.",
	);
	for (const viewport of ["desktop", "mobile"]) {
		for (const mode of ["first-document", "repeat-link"]) {
			for (const scenario of ["held", "failed"]) {
				const result = await execute(
					process.execPath,
					[cli, "run", directory, source, viewport, mode, scenario],
					{ timeout: 90000, windowsHide: true },
				);
				assert.equal(JSON.parse(result.stdout).passed, true);
				const evidence = JSON.parse(
					await readFile(
						join(directory, `ingress-${viewport}-${mode}-${scenario}.json`),
						"utf8",
					),
				);
				assert.equal(evidence.early.clockReady, true);
				assert.equal(evidence.early.usefulSibling, true);
				assert.equal(evidence.early.secondaryPending, true);
				assert.equal(evidence.after.secondaryComplete, true);
				assert.ok(
					evidence.earlyNetwork.some(
						(response) =>
							response.usefulContentMs < evidence.releasedAtMs &&
							response.completeMs === null,
					),
				);
				assert.equal(evidence.nativePaintMeasured, false);
			}
		}
		for (const scenario of ["signed-out", "mfa", "sso"]) {
			const result = await execute(
				process.execPath,
				[cli, "admission", directory, source, viewport, scenario],
				{ timeout: 90000, windowsHide: true },
			);
			assert.equal(JSON.parse(result.stdout).passed, true);
			const evidence = JSON.parse(
				await readFile(
					join(directory, `ingress-admission-${viewport}-${scenario}.json`),
					"utf8",
				),
			);
			assert.equal(evidence.protectedContentEmitted, false);
			assert.equal(evidence.clockStatusDenied, true);
		}
	}
});
