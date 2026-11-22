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
	"components/calendar/calendar-work-event.test.tsx",
	"components/calendar/schedule-x-calendar.test.tsx",
	"components/calendar/schedule-x-wrapper.tsx",
	"components/scheduling/scheduler/employee-shift-schedule.tsx",
	"components/scheduling/scheduler/shift-scheduler-calendar.test.tsx",
	"components/scheduling/scheduler/shift-scheduler.tsx",
	"lib/calendar/schedule-x-adapter.test.ts",
]);
const TEMPORAL_GLOBAL_IMPORT =
	/(?:import\s+["']temporal-polyfill\/global["']|from\s+["']temporal-polyfill\/global["'])/;
const CHAMPION_POLYFILL = /["']@js-temporal\/polyfill(?:\/[^"']*)?["']/;
const LUXON_IMPORT =
	/(?:from\s+["']luxon["']|import\s*\(\s*["']luxon["']\s*\)|import\s+["']luxon["']|require\s*\(\s*["']luxon["']\s*\))/;
const LUXON_OR_UTILS_IMPORT =
	/(?:from\s+["']luxon["']|import\s*\(\s*["']luxon["']\s*\)|import\s+["']luxon["']|require\s*\(\s*["']luxon["']\s*\)|["'](?:[^"']*\/|\.\.?\/)luxon-utils["'])/;
const TEMPORAL_IMPORT_OR_SYMBOL =
	/(?:from\s+["']temporal-polyfill(?:\/[^"']*)?["']|import\s+["']temporal-polyfill(?:\/[^"']*)?["']|["'](?:[^"']*\/|\.\.?\/)(?:temporal-core|temporal-boundaries|temporal-format|temporal-wire|drizzle-adapter)["']|\bTemporal\b)/;

/**
 * Shrinking allowlist of remaining legacy pure-Luxon production modules (#1973).
 *
 * Rules enforced by CI:
 * - Never add a new file here; migrate or write new code with Temporal.
 * - Never mix Luxon and Temporal in the same production file.
 * - When you remove Luxon from a listed file, delete its entry here to tighten the ratchet.
 */
const PURE_LUXON_LEGACY_ALLOWLIST = [
	"app/[locale]/(admin)/platform-admin/billing/page.tsx",
	"app/[locale]/(admin)/platform-admin/organizations/page.tsx",
	"app/[locale]/(admin)/platform-admin/worker-queue/page.tsx",
	"app/[locale]/(admin)/platform-admin/worker-queue/recent-executions.tsx",
	"app/[locale]/(admin)/platform-admin/worker-queue/reliability-charts.tsx",
	"app/[locale]/(app)/absences/holiday-expansion.ts",
	"app/[locale]/(app)/team/absences/manager-absence-action-helpers.ts",
	"app/[locale]/(app)/team/absences/manager-absence-calendar-helpers.ts",
	"app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx",
	"app/[locale]/(app)/time-tracking/actions/presence-status-read.ts",
	"app/[locale]/(app)/time-tracking/actions/presence-status.ts",
	"app/api/calendar/ics/[secret]/route.ts",
	"app/api/wellness/water-action/route.ts",
	"components/billing/billing-page/subscription-summary.tsx",
	"components/calendar/day-details.tsx",
	"components/dashboard/format-dashboard-date.ts",
	"components/dashboard/return-date-calculations.ts",
	"components/header-timezone-control-utils.ts",
	"components/header-timezone-control.tsx",
	"components/nav-user-preferences.tsx",
	"components/organization/organization-danger-zone-card.tsx",
	"components/organization/organization-deletion-banner.tsx",
	"components/time-tracking/project-selector.tsx",
	"lib/absences/date-utils.ts",
	"lib/absences/duration.ts",
	"lib/analytics/approval-performance.ts",
	"lib/analytics/overtime-burndown.ts",
	"lib/approvals/domain/sla-calculator.ts",
	"lib/approvals/handlers/absence-request.handler.ts",
	"lib/approvals/handlers/base-handler.ts",
	"lib/approvals/inbox/serialization.ts",
	"lib/audit-pack/application/audit-pack-orchestrator.ts",
	"lib/audit-pack/domain/approval-evidence-builder.ts",
	"lib/audit-pack/domain/audit-timeline-builder.ts",
	"lib/audit-pack/domain/entry-chain-builder.ts",
	"lib/audit/cleanup.ts",
	"lib/bot-platform/digest-settings.ts",
	"lib/bot-platform/i18n.ts",
	"lib/calendar/absence-adjusted-requirements.ts",
	"lib/calendar/absence-service.ts",
	"lib/coverage/domain/entities/coverage-rule.ts",
	"lib/datetime/birthday.ts",
	"lib/datetime/format.ts",
	"lib/datetime/luxon-utils.ts",
	"lib/discord/formatters.ts",
	"lib/discord/jobs/daily-digest.ts",
	"lib/discord/jobs/escalation-checker.ts",
	"lib/enterprise-identity/setup-state.ts",
	"lib/export-operations/get-export-operations-cockpit.ts",
	"lib/import-review/clockin-adapter.ts",
	"lib/import-review/clockodo-adapter.ts",
	"lib/import-review/detection.ts",
	"lib/import-review/partitioning.ts",
	"lib/notifications/recipient-display-context.ts",
	"lib/platform-admin-users-page-sections.tsx",
	"lib/platform-analytics/range.ts",
	"lib/platform-analytics/service.ts",
	"lib/platform-diagnostics/collector.ts",
	"lib/slack/formatters.ts",
	"lib/slack/jobs/daily-digest.ts",
	"lib/slack/jobs/escalation-checker.ts",
	"lib/superjson.ts",
	"lib/teams/cards/approval-card.ts",
	"lib/teams/cards/coverage-card.ts",
	"lib/teams/cards/daily-digest-card.ts",
	"lib/teams/cards/open-shifts-card.ts",
	"lib/teams/jobs/escalation-checker.ts",
	"lib/telegram/jobs/digest-schedule.ts",
	"lib/telegram/jobs/escalation-checker.ts",
	"lib/time-record/actions.ts",
	"lib/time-record/migration/backfill.ts",
	"lib/time-record/migration/reconciliation.ts",
	"lib/time-record/types.ts",
	"lib/time-tracking/time-utils.ts",
	"lib/time-tracking/timezone-utils.ts",
	"lib/user-preferences/week-start.ts",
	"lib/wellness/actions/mutations.ts",
	"lib/wellness/actions/queries.ts",
	"lib/wellness/actions/shared.ts",
	"lib/wellness/streak-calculator.ts",
	"lib/work-balance/period-aggregation.ts",
	"lib/work-balance/periods.ts",
	"lib/work-balance/service.ts",
] as const;
const NATIVE_DATE_CALENDAR_OR_TIMEZONE_MATH =
	/\bDate\.(?:now|parse|UTC)\b|\.(?:get|set)(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|TimezoneOffset)\b/;
const DATE_TO_ISO_DATE_KEY = /\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/;
const UNZONED_LUXON_NOW = /\bDateTime\.now\(\)(?!\s*\.setZone\s*\()/;
const UNZONED_LUXON_FROM_ISO = /\bDateTime\.fromISO\(\s*[^,)]*\)(?!\s*\.setZone\s*\()/;
const NATIVE_SCHEDULING_HOUR_MATH = /\.setHours\s*\(/;
const DATE_FNS_P_FORMAT = /\bformat\s*\([^,]+,\s*["']P{1,4}p{0,2}["']\s*\)/;
const APPLICATION_DRIZZLE_ADAPTER_IMPORT = /from\s+["']@\/lib\/datetime\/drizzle-adapter["']/;

function collectSourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const filePath = join(directory, entry);
		if (statSync(filePath).isDirectory()) {
			return collectSourceFiles(filePath);
		}

		return /\.(?:ts|tsx)$/.test(entry) ? [filePath] : [];
	});
}

function isTestFile(relativePath: string): boolean {
	return /(?:^|\/)__tests__(?:\/|$)|\.(?:test|spec)\.tsx?$/.test(relativePath);
}

function collectProductionSourceFiles(directory: string): string[] {
	return collectSourceFiles(directory)
		.map((filePath) => relative(SOURCE_ROOT, filePath).replace(/\\/g, "/"))
		.filter((relativePath) => !isTestFile(relativePath))
		.sort();
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

		expect(
			sourceOffenders.map((filePath) => relative(SOURCE_ROOT, filePath).replace(/\\/g, "/")),
		).toEqual([]);
		expect(packageSource).not.toMatch(CHAMPION_POLYFILL);
	});

	it("limits global Temporal patching to Schedule-X integration modules", () => {
		const offenders = collectSourceFiles(SOURCE_ROOT)
			.filter((filePath) => TEMPORAL_GLOBAL_IMPORT.test(readFileSync(filePath, "utf8")))
			.map((filePath) => relative(SOURCE_ROOT, filePath).replace(/\\/g, "/"))
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
			.map((filePath) => relative(SOURCE_ROOT, filePath).replace(/\\/g, "/"));

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

	it("bans mixing Luxon and Temporal in any production module", () => {
		const mixedFiles = collectProductionSourceFiles(SOURCE_ROOT).filter((relativePath) => {
			const content = source(relativePath);
			return LUXON_OR_UTILS_IMPORT.test(content) && TEMPORAL_IMPORT_OR_SYMBOL.test(content);
		});

		expect(mixedFiles).toEqual([]);
	});

	it("enforces a shrinking allowlist of remaining legacy pure-Luxon production modules", () => {
		const productionFiles = collectProductionSourceFiles(SOURCE_ROOT);
		const actualLuxonFiles = productionFiles.filter((relativePath) =>
			LUXON_IMPORT.test(source(relativePath)),
		);
		const allowlistSet = new Set<string>(PURE_LUXON_LEGACY_ALLOWLIST);
		const actualSet = new Set(actualLuxonFiles);

		const unexpectedLuxonFiles = actualLuxonFiles.filter(
			(relativePath) => !allowlistSet.has(relativePath),
		);
		const staleAllowlistEntries = PURE_LUXON_LEGACY_ALLOWLIST.filter(
			(relativePath) => !actualSet.has(relativePath),
		);

		expect(unexpectedLuxonFiles).toEqual([]);
		expect(staleAllowlistEntries).toEqual([]);
	});
});
