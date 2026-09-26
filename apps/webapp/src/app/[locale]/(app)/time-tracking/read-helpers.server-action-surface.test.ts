import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const timeTrackingDir = dirname(fileURLToPath(import.meta.url));

function readSource(file: string) {
	return readFileSync(join(timeTrackingDir, file), "utf8");
}

function exportsName(source: string, name: string) {
	return new RegExp(`^export\\b[^\\n]*\\b${name}\\b`, "m").test(source);
}

// #445: every export of a "use server" module can become a public endpoint, so
// reads that take employee or user IDs from the caller stay out of them.
describe("time-tracking read helper surface", () => {
	it.each(["actions/queries.ts", "actions/policy-helpers.ts", "actions/auth.ts"])(
		"keeps %s a server-only helper module",
		(file) => {
			const source = readSource(file);

			expect(source).toContain('import "server-only";');
			expect(source).not.toContain('"use server"');
		},
	);

	it.each(["getActiveWorkPeriod", "getWorkPeriods", "getTimeSummary"])(
		"exposes no unauthenticated %s from the actions module",
		(name) => {
			expect(exportsName(readSource("actions.ts"), name)).toBe(false);
		},
	);

	it("drops the uncalled presence status copy from the queries module", () => {
		expect(exportsName(readSource("actions/queries.ts"), "getPresenceStatus")).toBe(false);
	});

	it("loads page data through the guarded query helpers", () => {
		expect(readSource("page-data.ts")).toContain(
			'import { getActiveWorkPeriod, getTimeSummary, getWorkPeriods } from "./actions/queries";',
		);
	});
});
