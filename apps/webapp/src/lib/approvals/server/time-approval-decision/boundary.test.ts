import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The time approval decision is the only caller of its two owners (#1681):
 * nothing else may decide a time approval past the module's interface.
 */
const SOURCE_ROOT = "src";
const MODULE = "lib/approvals/server/time-approval-decision/";
const OWNERS = [
	"lib/approvals/server/time-correction-approvals.ts",
	"lib/approvals/server/work-period-approvals.ts",
];

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

const files = sourceFiles(SOURCE_ROOT).map((path) => ({
	path: relative(SOURCE_ROOT, path).replaceAll("\\", "/"),
	source: readFileSync(path, "utf8"),
}));

describe("time approval decision boundary", () => {
	it("leaves the owners' decision entry points to the module alone", () => {
		const callers = files
			.filter(({ path }) => !path.startsWith(MODULE) && !OWNERS.includes(path))
			.filter(({ source }) =>
				/\b(decideTimeCorrectionApproval|decideOrdinaryTimeApproval)\b/.test(source),
			)
			.map(({ path }) => path);

		expect(callers).toEqual([]);
	});

	it("is imported only through its interface, except by its owners", () => {
		const internals = files
			.filter(({ path }) => !path.startsWith(MODULE) && !OWNERS.includes(path))
			.filter(({ source }) => /time-approval-decision\/(decision|support)["']/.test(source))
			.map(({ path }) => path);

		expect(internals).toEqual([]);
	});
});
