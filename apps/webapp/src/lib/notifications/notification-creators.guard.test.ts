import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanNotificationCreators } from "./notification-creator-scan";

/**
 * Every place that creates a notification sets translation keys (#812, #1149), so each
 * channel can render it in the recipient language. A new creator without keys fails.
 */

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
	it("all set translation keys", { timeout: 120_000 }, () => {
		const sites = scanNotificationCreators(productionSources());
		expect(sites).toContainEqual({ id: KNOWN_CREATOR_WITH_KEYS, hasKeys: true });

		expect(
			sites
				.filter((site) => !site.hasKeys)
				.map((site) => site.id)
				.sort(),
			"Notification creators without translation keys (add metadata.i18n)",
		).toEqual([]);
	});
});
