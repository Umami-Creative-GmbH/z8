import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Vitest aliases server-only to a no-op, so exercise plain Node the way the worker runs.
const preloadUrl = pathToFileURL(path.resolve(__dirname, "worker-preload.mjs")).href;

function runNode(script: string, withPreload: boolean) {
	return spawnSync(
		process.execPath,
		[...(withPreload ? ["--import", preloadUrl] : []), "--input-type=module", "-e", script],
		{ cwd: path.resolve(__dirname, ".."), encoding: "utf8" },
	);
}

describe("worker preload", () => {
	it("plain Node rejects server-only without the preload", () => {
		const result = runNode('await import("server-only");', false);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("cannot be imported from a Client Component module");
	});

	it("loads server-only through both import and require", () => {
		const result = runNode(
			[
				'import { createRequire } from "node:module";',
				'await import("server-only");',
				'createRequire(import.meta.url)("server-only");',
			].join("\n"),
			true,
		);

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
	});

	it("keeps the client React build for email rendering", () => {
		const result = runNode(
			'const React = await import("react"); if (typeof React.useState !== "function") process.exit(3);',
			true,
		);

		expect(result.status).toBe(0);
	});
});
