import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanNotificationCreators } from "./notification-creator-scan";

/**
 * Every place that creates a notification sets translation keys (#812, #1149), so each
 * channel can render it in the recipient language. The creators below have none yet.
 * This list may only shrink: a new creator without keys fails, and so does an entry
 * that has keys by now or no longer exists. #1153 and #1154 empty it.
 */
const CREATORS_WITHOUT_KEYS = new Set<string>([
	// #1153: absence, time-correction and clocking triggers. "dead" = no production caller yet.
	"lib/notifications/triggers.ts::onAbsenceRecordedByManager",
	"lib/notifications/triggers.ts::onAbsenceRequestApproved",
	"lib/notifications/triggers.ts::onAbsenceRequestPendingApproval",
	"lib/notifications/triggers.ts::onAbsenceRequestRejected",
	"lib/notifications/triggers.ts::onApprovedAbsenceCancelledByEmployee",
	"lib/notifications/triggers.ts::onClockOutApproved",
	"lib/notifications/triggers.ts::onClockOutPendingApproval",
	"lib/notifications/triggers.ts::onClockOutPendingApprovalToManager",
	"lib/notifications/triggers.ts::onClockOutRejected",
	"lib/notifications/triggers.ts::onManualEntryApproved",
	"lib/notifications/triggers.ts::onManualEntryRejected",
	"lib/notifications/triggers.ts::onTimeCorrectionApproved",
	"lib/notifications/triggers.ts::onTimeCorrectionPendingApproval", // dead
	"lib/notifications/triggers.ts::onTimeCorrectionRejected",
	"lib/notifications/triggers.ts::onTimeCorrectionSubmitted", // dead
]);

/** Direct writes that never get keys, with the reason. */
const EXEMPT = new Map<string, string>([
	[
		"lib/demo/demo-data.service.ts::generateDemoPendingAbsenceApprovals",
		"demo seed rows inserted as fixed English sample data",
	],
	[
		"lib/demo/demo-data.service.ts::generateDemoPendingTimeCorrectionApprovals",
		"demo seed rows inserted as fixed English sample data",
	],
]);

/** A creator known to have keys, so a scan that finds nothing cannot pass. */
const KNOWN_CREATOR_WITH_KEYS =
	"lib/time-tracking/automatic-clock-out/notifications.ts::buildAutoClockOutNotification";

const SOURCE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
// Same test-file rule as the Tolgee extractor: tests and fixtures are not production creators.
const TEST_FILE = /(?:\.test\.|\.fixture\.|[\\/]__tests__[\\/])/;
const DIRECT_WRITE = /\bsendPushToUser\s*\(|\.insert\(\s*notification\s*\)/;

/** Cheap pre-filter: only files that could hold a creator are parsed. */
function mayCreate(source: string): boolean {
	return DIRECT_WRITE.test(source) || (/\btitle\b/.test(source) && /\bmessage\b/.test(source));
}

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry) && !TEST_FILE.test(path) ? [path] : [];
	});
}

function productionSources(): Map<string, string> {
	const sources = new Map<string, string>();
	for (const file of sourceFiles(SOURCE_ROOT)) {
		const fileName = relative(SOURCE_ROOT, file).replaceAll("\\", "/");
		// The Drizzle table definition has the same columns but creates nothing.
		if (fileName.startsWith("db/")) continue;
		const source = readFileSync(file, "utf8");
		if (mayCreate(source)) sources.set(fileName, source);
	}
	return sources;
}

describe("notification creators", () => {
	it("all set translation keys, apart from the shrinking list", { timeout: 120_000 }, () => {
		const sites = scanNotificationCreators(productionSources());
		const found = new Set(sites.map((site) => site.id));
		expect(sites).toContainEqual({ id: KNOWN_CREATOR_WITH_KEYS, hasKeys: true });
		const withoutKeys = sites
			.filter((site) => !site.hasKeys && !EXEMPT.has(site.id))
			.map((site) => site.id);

		expect(
			withoutKeys.filter((id) => !CREATORS_WITHOUT_KEYS.has(id)).sort(),
			"New notification creators without translation keys (add metadata.i18n)",
		).toEqual([]);
		expect(
			[...CREATORS_WITHOUT_KEYS].filter((id) => !found.has(id) || !withoutKeys.includes(id)).sort(),
			"Listed creators that have keys by now or no longer exist (remove them from the list)",
		).toEqual([]);
		expect(
			[...EXEMPT.keys()].filter((id) => !found.has(id)).sort(),
			"Exempt writes that no longer exist",
		).toEqual([]);
	});
});
