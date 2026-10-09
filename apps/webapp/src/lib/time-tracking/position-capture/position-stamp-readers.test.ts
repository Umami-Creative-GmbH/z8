import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Positions appear only on a single work period's detail behind "Show
 * positions" (#831, spec #766), and in the permitted data export (#835). No
 * list, calendar, dashboard or analytics code may read stamps. This guard lists
 * every source file that touches the `position_stamp` table or its raw reader;
 * a new reader must go through `positionStampAccess` and the access log, and be
 * added here deliberately.
 */
const ALLOWED_READERS = new Set([
	"db/schema/position-capture.ts",
	"lib/time-tracking/clocking/position-stamp.ts",
	// The org data export (#835): only for viewers of everyone's stamps, logged per export.
	"lib/time-tracking/position-capture/export-positions.ts",
	// The purge (#829) deletes stamps and moves purge dates; it never returns positions.
	"lib/time-tracking/position-capture/purge.ts",
	// Record retention only checks that no stamp still refers to a consent before deleting it.
	"lib/time-tracking/position-capture/record-retention.ts",
	"lib/time-tracking/position-capture/stamps.ts",
	"lib/time-tracking/position-capture/store.ts",
	"lib/time-tracking/position-capture/work-period-positions.ts",
]);

const SOURCE_ROOT = path.resolve(__dirname, "../../..");
const TOUCHES_STAMPS =
	/\bpositionStamp\b(?!Access)|\bposition_stamp\b(?!_access)|readPositionStampsForEntries/;

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const full = path.join(directory, name);
		if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full);
		return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
	});
}

describe("position stamp readers", () => {
	it("are limited to the clocking writer, the purge/withdrawal store and Show positions", () => {
		const readers = sourceFiles(SOURCE_ROOT)
			.filter((file) => TOUCHES_STAMPS.test(readFileSync(file, "utf8")))
			.map((file) => path.relative(SOURCE_ROOT, file).split(path.sep).join("/"))
			.filter((file) => !ALLOWED_READERS.has(file));

		expect(readers).toEqual([]);
	});
});
