import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { assertPrimitiveDateTimePayload } from "./temporal-wire";

const SOURCE_ROOT = join(process.cwd(), "src");
const FOUNDATION_SOURCE_FILES = [
	"lib/datetime/temporal-core.ts",
	"lib/datetime/temporal-boundaries.ts",
	"lib/datetime/temporal-format.ts",
	"lib/datetime/temporal-wire.ts",
	"lib/timezone/resolve-timezone.ts",
	"lib/timezone/validation.ts",
] as const;
const SCHEDULE_X_GLOBAL_POLYFILL_ALLOWLIST = new Set([
	"components/calendar/schedule-x-calendar.test.tsx",
	"components/calendar/schedule-x-wrapper.tsx",
	"components/scheduling/scheduler/shift-scheduler.tsx",
	"lib/calendar/schedule-x-adapter.test.ts",
]);
const TEMPORAL_GLOBAL_IMPORT =
	/(?:import\s+["']temporal-polyfill\/global["']|from\s+["']temporal-polyfill\/global["'])/;
const CHAMPION_POLYFILL = /["']@js-temporal\/polyfill(?:\/[^"']*)?["']/;
const LUXON_IMPORT = /(?:from\s+["']luxon["']|import\s+["']luxon["'])/;
const NATIVE_DATE_CALENDAR_OR_TIMEZONE_MATH =
	/\bDate\.(?:now|parse|UTC)\b|\.(?:get|set)(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|TimezoneOffset)\b/;

function collectSourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const filePath = join(directory, entry);
		if (statSync(filePath).isDirectory()) {
			return collectSourceFiles(filePath);
		}

		return /\.(?:ts|tsx)$/.test(entry) ? [filePath] : [];
	});
}

function source(relativePath: string): string {
	return readFileSync(join(SOURCE_ROOT, relativePath), "utf8");
}

describe("Temporal source guard", () => {
	it("does not restore the retired global Temporal provider", () => {
		expect(existsSync(join(SOURCE_ROOT, "components/temporal-polyfill-provider.tsx"))).toBe(false);
	});

	it("rejects the champion Temporal polyfill from source and direct dependencies", () => {
		const sourceOffenders = collectSourceFiles(SOURCE_ROOT).filter((filePath) =>
			CHAMPION_POLYFILL.test(readFileSync(filePath, "utf8")),
		);
		const packageSource = readFileSync(join(process.cwd(), "package.json"), "utf8");

		expect(sourceOffenders.map((filePath) => relative(SOURCE_ROOT, filePath))).toEqual([]);
		expect(packageSource).not.toMatch(CHAMPION_POLYFILL);
	});

	it("limits global Temporal patching to Schedule-X integration modules", () => {
		const offenders = collectSourceFiles(SOURCE_ROOT)
			.filter((filePath) => TEMPORAL_GLOBAL_IMPORT.test(readFileSync(filePath, "utf8")))
			.map((filePath) => relative(SOURCE_ROOT, filePath))
			.filter((filePath) => !SCHEDULE_X_GLOBAL_POLYFILL_ALLOWLIST.has(filePath));

		expect(offenders).toEqual([]);
	});

	it("keeps migrated foundation modules free of Luxon and native Date calendar math", () => {
		const luxonOffenders = FOUNDATION_SOURCE_FILES.filter((filePath) =>
			LUXON_IMPORT.test(source(filePath)),
		);
		const nativeDateOffenders = FOUNDATION_SOURCE_FILES.filter((filePath) =>
			NATIVE_DATE_CALENDAR_OR_TIMEZONE_MATH.test(source(filePath)),
		);

		expect(luxonOffenders).toEqual([]);
		expect(nativeDateOffenders).toEqual([]);
	});

	it("rejects Temporal class instances from primitive wire payloads", () => {
		expect(() =>
			assertPrimitiveDateTimePayload({ instant: Temporal.Instant.from("2026-07-10T12:30:00Z") }),
		).toThrowError(/Temporal\.Instant/);
	});
});
