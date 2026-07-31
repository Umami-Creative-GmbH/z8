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
const CORE_DATE_KEY_SOURCE_FILES = [
	"app/[locale]/(app)/reports/actions.ts",
	"components/calendar/calendar-view.tsx",
	"components/calendar/schedule-x-calendar.tsx",
	"components/reports/date-range-picker.tsx",
	"components/scheduling/scheduler/shift-scheduler-utils.ts",
	"lib/reports/date-ranges.ts",
	"lib/reports/report-date-range.ts",
	"lib/scheduling/schedule-local-input.ts",
] as const;
const CORE_LUXON_ENTRY_POINTS = [
	"app/[locale]/(app)/approvals/actions.ts",
	"app/[locale]/(app)/reports/actions.ts",
	"components/calendar/schedule-x-calendar.tsx",
	"components/scheduling/scheduler/shift-scheduler-utils.ts",
	"components/scheduling/shifts/use-shift-dialog-form.ts",
	"lib/reports/date-ranges.ts",
	"lib/reports/report-date-range.ts",
	"lib/scheduling/schedule-local-input.ts",
] as const;
const TELEGRAM_LUXON_ENTRY_POINTS = [
	"lib/telegram/formatters.ts",
	"lib/telegram/jobs/escalation-checker.ts",
] as const;
const MIGRATED_CALENDAR_DIALOGS = [
	"components/calendar/delete-work-period-dialog.tsx",
	"components/calendar/split-work-period-dialog.tsx",
	"components/calendar/work-period-edit-dialog.tsx",
	"components/calendar/work-period-edit-sections.tsx",
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
const DATE_TO_ISO_DATE_KEY = /\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/;
const UNZONED_LUXON_NOW = /\bDateTime\.now\(\)(?!\s*\.setZone\s*\()/;
const UNZONED_LUXON_FROM_ISO = /\bDateTime\.fromISO\(\s*[^,)]*\)(?!\s*\.setZone\s*\()/;
const NATIVE_SCHEDULING_HOUR_MATH = /\.setHours\s*\(/;
const DATE_FNS_P_FORMAT = /\bformat\s*\([^,]+,\s*["']P{1,4}p{0,2}["']\s*\)/;
const APPLICATION_DRIZZLE_ADAPTER_IMPORT =
	/from\s+["']@\/lib\/datetime\/drizzle-adapter["']/;

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

	it("keeps Drizzle schema modules free of application datetime runtime dependencies", () => {
		const schemaRoot = join(SOURCE_ROOT, "db/schema");
		const offenders = collectSourceFiles(schemaRoot)
			.filter((filePath) => {
				const relativePath = relative(schemaRoot, filePath);
				return !/(?:^|[/\\])__tests__(?:[/\\]|$)|\.test\.tsx?$/.test(relativePath);
			})
			.filter((filePath) => APPLICATION_DRIZZLE_ADAPTER_IMPORT.test(readFileSync(filePath, "utf8")))
			.map((filePath) => relative(SOURCE_ROOT, filePath));

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

	it("keeps migrated Core date keys and Luxon entry points host-zone independent", () => {
		const dateKeyOffenders = CORE_DATE_KEY_SOURCE_FILES.filter((filePath) =>
			DATE_TO_ISO_DATE_KEY.test(source(filePath)),
		);
		const unzonedNowOffenders = CORE_LUXON_ENTRY_POINTS.filter((filePath) =>
			UNZONED_LUXON_NOW.test(source(filePath)),
		);
		const unzonedFromIsoOffenders = CORE_LUXON_ENTRY_POINTS.filter((filePath) =>
			UNZONED_LUXON_FROM_ISO.test(source(filePath)),
		);
		const schedulingHourMathOffenders = CORE_LUXON_ENTRY_POINTS.filter(
			(filePath) =>
				filePath.includes("scheduling") && NATIVE_SCHEDULING_HOUR_MATH.test(source(filePath)),
		);

		expect(dateKeyOffenders).toEqual([]);
		expect(unzonedNowOffenders).toEqual([]);
		expect(unzonedFromIsoOffenders).toEqual([]);
		expect(schedulingHourMathOffenders).toEqual([]);
	});

	it("keeps Telegram instant origins explicitly in UTC", () => {
		const unzonedNowOffenders = TELEGRAM_LUXON_ENTRY_POINTS.filter((filePath) =>
			UNZONED_LUXON_NOW.test(source(filePath)),
		);
		const unzonedFromJsDateOffenders = TELEGRAM_LUXON_ENTRY_POINTS.filter((filePath) =>
			/\bDateTime\.fromJSDate\(\s*[^,)]*\)/.test(source(filePath)),
		);

		expect(unzonedNowOffenders).toEqual([]);
		expect(unzonedFromJsDateOffenders).toEqual([]);
	});

	it("keeps migrated calendar dialogs off date-fns P-format tokens", () => {
		const offenders = MIGRATED_CALENDAR_DIALOGS.filter((filePath) =>
			DATE_FNS_P_FORMAT.test(source(filePath)),
		);

		expect(offenders).toEqual([]);
	});

	it("rejects Temporal class instances from primitive wire payloads", () => {
		expect(() =>
			assertPrimitiveDateTimePayload({ instant: Temporal.Instant.from("2026-07-10T12:30:00Z") }),
		).toThrowError(/Temporal\.Instant/);
	});
});
