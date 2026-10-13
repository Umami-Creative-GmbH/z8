import { describe, expect, it } from "vitest";
import { buildDailyDigestEmbed } from "@/lib/discord/formatters";
import { buildDailyDigestBlocks } from "@/lib/slack/formatters";
import type { BotTranslateFn } from "./i18n";
import type { DailyDigestData } from "./types";

/** Slack and Discord digests are in the recipient language, like Telegram's and Teams'. */
function digest(): DailyDigestData {
	return {
		date: new Date("2026-05-20T08:00:00.000Z"),
		timezone: "Europe/Paris",
		pendingApprovals: 0,
		employeesOut: Array.from({ length: 6 }, (_, index) => ({
			name: `Person ${index}`,
			category: "Congé",
			returnDate: "jeu. 21 mai",
			deputyName: index === 0 ? "Dana Deputy" : null,
		})),
		employeesClockedIn: Array.from({ length: 6 }, (_, index) => ({
			name: `Worker ${index}`,
			clockedInAt: "08:00",
			durationSoFar: "1h",
		})),
		coverageGaps: [
			{ locationName: "Paris", subareaName: "Caisse", scheduled: 3, actual: 1, shortage: 2 },
		],
		openShiftsToday: 2,
		openShiftsTomorrow: 1,
		compliancePending: 3,
	} as DailyDigestData;
}

const keysOnly: BotTranslateFn = (key) => `«${key}»`;

function collectStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(collectStrings);
	if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
	return [];
}

const ENGLISH_COPY =
	/Daily Digest|Pending Approvals|None|Who's Out|returns|Deputy|more|Clocked In|since|Coverage Gaps|Open Shifts|Today|Tomorrow|Compliance|pending exception|Dashboard|dashboard/;

describe("Slack and Discord digest language", () => {
	it.each([
		[
			"Slack",
			() => collectStrings(buildDailyDigestBlocks(digest(), "https://z8.test", "fr", keysOnly)),
		],
		[
			"Discord",
			() => collectStrings(buildDailyDigestEmbed(digest(), "https://z8.test", "fr", keysOnly)),
		],
	])("renders every %s digest label through the recipient's translator", (_platform, render) => {
		const strings = render();
		const copy = strings.map((text) => text.replace(/«[^»]+»/g, "").replace(/https:\/\/\S+/g, ""));

		expect(copy.filter((text) => ENGLISH_COPY.test(text))).toEqual([]);
		expect(strings.join("\n")).toContain("«bot.digest.title»");
	});

	it("formats the Slack digest date in the recipient language", () => {
		const translateWithParams: BotTranslateFn = (key, _fallback, params) =>
			`${key}${params ? JSON.stringify(params) : ""}`;
		const text = collectStrings(
			buildDailyDigestBlocks(digest(), "https://z8.test", "fr", translateWithParams),
		).join("\n");

		expect(text).toContain("mercredi 20 mai 2026");
	});
});
