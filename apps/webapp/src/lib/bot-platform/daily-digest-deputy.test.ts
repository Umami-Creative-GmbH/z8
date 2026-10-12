import { describe, expect, it } from "vitest";
import { buildDailyDigestEmbed } from "@/lib/discord/formatters";
import { buildDailyDigestBlocks } from "@/lib/slack/formatters";
import { buildDailyDigestCard, buildDailyDigestText } from "@/lib/teams/cards/daily-digest-card";
import { buildDailyDigestMessage } from "@/lib/telegram/formatters";
import type { DailyDigestData } from "./types";

/** The daily digest's "Who's out" names each absence's deputy (#1012), on every platform. */
function digest(): DailyDigestData {
	return {
		date: new Date("2026-05-20T08:00:00.000Z"),
		timezone: "Europe/Berlin",
		pendingApprovals: 0,
		employeesOut: [
			{ name: "Anna Away", category: "Vacation", returnDate: "Thu, May 21", deputyName: "Dana Deputy" },
			{ name: "Ben Away", category: "Vacation", returnDate: "Fri, May 22", deputyName: null },
		],
		employeesClockedIn: [],
	};
}

function collectStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(collectStrings);
	if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
	return [];
}

describe("daily digest deputies (#1012)", () => {
	it.each([
		["Telegram", () => buildDailyDigestMessage(digest(), "https://z8.test").replace(/\\/g, "")],
		["Slack", () => collectStrings(buildDailyDigestBlocks(digest(), "https://z8.test")).join("\n")],
		["Discord", () => collectStrings(buildDailyDigestEmbed(digest(), "https://z8.test")).join("\n")],
		["Teams card", () => collectStrings(buildDailyDigestCard(digest(), "https://z8.test")).join("\n")],
		["Teams text", () => buildDailyDigestText(digest())],
	])("names the deputy of an absent employee on %s, and none where nobody covers", (_platform, render) => {
		const text = render();
		expect(text).toContain("Deputy: Dana Deputy");
		expect(text.match(/Deputy:/g)).toHaveLength(1);
	});
});
