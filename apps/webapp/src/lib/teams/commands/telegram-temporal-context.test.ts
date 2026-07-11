import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readCommandSource(name: string) {
	return readFileSync(fileURLToPath(new URL(`./${name}.ts`, import.meta.url)), "utf8");
}

function readTelegramFormatterSource() {
	return readFileSync(
		fileURLToPath(new URL("../../telegram/formatters.ts", import.meta.url)),
		"utf8",
	);
}

function readDailyDigestSource(platform: "teams" | "telegram" | "discord" | "slack") {
	return readFileSync(
		fileURLToPath(new URL(`../../${platform}/jobs/daily-digest.ts`, import.meta.url)),
		"utf8",
	);
}

describe("Telegram command temporal contexts", () => {
	it.each([
		"clock-in",
		"clock-out",
		"status",
		"clockedin",
		"pending",
	])("formats %s command responses from the explicit temporal context", (name) => {
		const source = readCommandSource(name);

		expect(source).toContain("ctx.temporal");
		expect(source).not.toContain("DateTime.now()");
		expect(source).not.toContain("DateTime.fromISO(");
	});

	it.each([
		"whos-out",
		"coverage",
		"open-shifts",
	])("resolves %s availability dates from the explicit temporal context", (name) => {
		const source = readCommandSource(name);

		expect(source).toContain("getCommandTemporalContext");
		expect(source).toContain("organizationTimezone");
		expect(source).toContain("toPlainDate()");
		expect(source).not.toContain("DateTime.now()");
		expect(source).not.toContain("DateTime.fromISO(");
	});

	it("formats Telegram approval audit endpoints with their captured offset", () => {
		expect(readTelegramFormatterSource()).toContain("formatCapturedOffsetInstant");
	});

	it.each(["teams", "discord", "slack"] as const)(
		"schedules %s digests in the digest timezone and renders each recipient in their timezone",
		(platform) => {
		const source = readDailyDigestSource(platform);

		expect(source).toMatch(/setZone\(|toZonedDateTimeISO\(/);
		expect(source).toContain("digestTimezone");
		expect(source).toContain("resolveBotTemporalContext");
		expect(source).toContain("effectiveTimezone");
		},
	);

	it("schedules Telegram digests with the digest timezone while rendering per-recipient Temporal content", () => {
		const source = readDailyDigestSource("telegram");

		expect(source).toContain("evaluateDigestOccurrence({");
		expect(source).toContain("timezone: bot.digestTimezone");
		expect(source).toContain("resolveRecipientDisplayContext");
		expect(source).toContain("toZonedDateTimeISO(display.timezone)");
		expect(source).toContain("claimTelegramDigestDelivery");
		expect(source).toContain("shouldSkipDigestForManager");
	});
});
