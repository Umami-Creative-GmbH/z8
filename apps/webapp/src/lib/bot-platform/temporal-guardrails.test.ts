import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const migratedSources = [
	"../telegram/approval-handler.ts",
	"../telegram/formatters.ts",
	"../telegram/jobs/daily-digest.ts",
	"../telegram/jobs/digest-schedule.ts",
	"../notifications/recipient-display-context.ts",
	"../notifications/telegram-channel.ts",
];

async function readMigratedSources(): Promise<string> {
	return Promise.all(
		migratedSources.map((source) => readFile(path.resolve(directory, source), "utf8")),
	).then((sources) => sources.join("\n"));
}

function expectLuxonConstructorsToSpecifyZone(source: string): void {
	const constructors = source.matchAll(/DateTime\.from(?:ISO|JSDate|Object)\(([\s\S]*?)\);/g);

	for (const luxonCall of constructors) {
		expect(luxonCall[1]).toContain("zone:");
	}
}

describe("migrated bot temporal guardrails", () => {
	it("does not derive display values from the host zone", async () => {
		const source = await readMigratedSources();

		expect(source).not.toMatch(/DateTime\.(?:local|now)\s*\(/);
		expectLuxonConstructorsToSpecifyZone(source);
		expect(source).not.toMatch(/new Date\(\s*["'`]\d{4}-\d{2}-\d{2}["'`]\s*\)/);
	});

	it("uses Temporal for Telegram digest recipient calendar dates", async () => {
		const source = await readFile(path.resolve(directory, "../telegram/jobs/daily-digest.ts"), "utf8");

		expect(source).toContain("Temporal.Instant.from(now.toISOString())");
		expect(source).toContain("toZonedDateTimeISO(display.timezone)");
		expect(source).not.toContain("DateTime.fromJSDate(now");
	});
});
