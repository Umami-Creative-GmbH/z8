import { describe, expect, it } from "vitest";
import { buildDailyDigestEmbed } from "@/lib/discord/formatters";
import { buildDailyDigestBlocks } from "@/lib/slack/formatters";
import { buildDailyDigestCard } from "@/lib/teams/cards/daily-digest-card";
import { buildDailyDigestMessage } from "@/lib/telegram/formatters";
import type { BotTranslateFn } from "./i18n";
import type { DailyDigestData } from "./types";

/**
 * #1977: a digest that counts pending compliance exceptions links to the Approval inbox
 * filtered to them, where its recipient decides them, on every platform it is sent to.
 */
const APP_URL = "https://z8.test";
const INBOX_URL = "https://z8.test/approvals/inbox?types=compliance_exception";

function digest(compliancePending?: number): DailyDigestData {
	return {
		date: new Date("2026-05-20T08:00:00.000Z"),
		timezone: "Europe/Berlin",
		pendingApprovals: 0,
		employeesOut: [],
		employeesClockedIn: [],
		compliancePending,
	};
}

const fallback: BotTranslateFn = (_key, defaultValue) => defaultValue;

function collectStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(collectStrings);
	if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
	return [];
}

/** Telegram's MarkdownV2 escapes every punctuation mark, the link's URL included. */
const unescapeMarkdownV2 = (text: string) => text.replace(/\\(.)/g, "$1");

const PLATFORMS = [
	[
		"Teams",
		(data: DailyDigestData) => collectStrings(buildDailyDigestCard(data, APP_URL, "en", fallback)),
	],
	[
		"Slack",
		(data: DailyDigestData) =>
			collectStrings(buildDailyDigestBlocks(data, APP_URL, "en", fallback)),
	],
	[
		"Discord",
		(data: DailyDigestData) => collectStrings(buildDailyDigestEmbed(data, APP_URL, "en", fallback)),
	],
	[
		"Telegram",
		(data: DailyDigestData) => [
			unescapeMarkdownV2(buildDailyDigestMessage(data, APP_URL, fallback, "en")),
		],
	],
] as const;

describe("daily digest compliance exception link", () => {
	it.each(PLATFORMS)(
		"links the %s digest to the compliance exceptions in the Approval inbox",
		(_platform, render) => {
			expect(render(digest(2)).join("\n")).toContain(INBOX_URL);
		},
	);

	it.each(PLATFORMS)(
		"offers no such link in a %s digest without pending exceptions",
		(_platform, render) => {
			expect(render(digest(undefined)).join("\n")).not.toContain("types=compliance_exception");
		},
	);
});
