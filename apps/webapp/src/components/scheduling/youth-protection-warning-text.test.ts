import { describe, expect, it } from "vitest";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import deCatalog from "../../../messages/scheduling/de.json";
import enCatalog from "../../../messages/scheduling/en.json";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { youthProtectionWarningText } from "./youth-protection-warning-text";

function catalogText(catalog: unknown, key: string): unknown {
	return key
		.replace(/^scheduling:/, "")
		.split(".")
		.reduce<unknown>(
			(node, part) =>
				node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
			catalog,
		);
}

const base: StatutoryComplianceFinding = {
	type: "statutory",
	employeeId: "e1",
	findingId: "f1",
	statutoryKind: "jarbschg_shift_span",
	domain: "youth_protection",
	severity: "critical",
	subjectKey: "shift:s1",
	legalReference: "§ 12 JArbSchG",
	summary: {
		tier: "exceeded",
		used: { unit: "minutes", value: 720 },
		limit: { unit: "minutes", value: 600 },
	},
	day: "2027-03-02",
	acknowledgementStatus: null,
	blocksPublication: true,
};

/** The key asked for, the values it was given, and the English default. */
function textOf(finding: StatutoryComplianceFinding, timeFormat?: TimeFormat) {
	const calls: { key: string; fallback: string; params?: Record<string, unknown> }[] = [];
	const t = ((key: string, fallback: string, params?: Record<string, unknown>) => {
		calls.push({ key, fallback, params });
		return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ""));
	}) as Parameters<typeof youthProtectionWarningText>[1];
	const text = youthProtectionWarningText(finding, t, "en-US", timeFormat);
	return { text, call: calls[0], calls };
}

describe("youthProtectionWarningText (#1993)", () => {
	it("names the day, span and limit of a § 12 shift span, in English and German", () => {
		const { text, call } = textOf(base);
		expect(text).not.toBeNull();
		expect(call?.params).toEqual({ used: 720, limit: 600, date: "Mar 2, 2027" });
		expect(catalogText(enCatalog, call?.key ?? "")).toBe(call?.fallback);
		expect(catalogText(deCatalog, call?.key ?? "")).not.toBe(call?.fallback);
		expect(typeof catalogText(deCatalog, call?.key ?? "")).toBe("string");
	});

	it("words work past a block week's training allowance as the week's total", () => {
		// 100 min Monday, 60 Thursday, 90 Friday: Thursday's and Friday's findings both hold 250.
		const { text, call } = textOf({
			...base,
			statutoryKind: "bbig_release_day_shift",
			domain: "apprenticeship",
			legalReference: "§ 9 Abs. 1 Nr. 3 JArbSchG",
			summary: {
				tier: "exceeded",
				used: { unit: "minutes", value: 250 },
				limit: { unit: "minutes", value: 120 },
			},
			day: undefined,
			releaseDay: "2027-03-11",
		});
		expect(call?.params).toEqual({ used: 250, limit: 120, date: "Mar 11, 2027" });
		expect(text).toBe(
			"Block-release week: 250 min of work on this week's school days, 120 min of in-company training allowed; past the allowance on Mar 11, 2027. The allowed training (§ 9 Abs. 1 Nr. 3 JArbSchG, § 15 Abs. 1 Satz 3 BBiG) comes on top of the block week, which counts with the average weekly working time (§ 9 Abs. 2 Nr. 2 JArbSchG), and does not count towards an under-18's § 8 daily and weekly limits",
		);
		expect(catalogText(enCatalog, call?.key ?? "")).toBe(call?.fallback);
		expect(typeof catalogText(deCatalog, call?.key ?? "")).toBe("string");
		expect(catalogText(deCatalog, call?.key ?? "")).not.toBe(call?.fallback);
	});

	it("has an English and a German text for the block-week training note (#2023)", () => {
		const { calls } = textOf({
			...base,
			statutoryKind: "bbig_release_day_shift",
			domain: "apprenticeship",
			summary: {
				tier: "exceeded",
				used: { unit: "minutes", value: 250 },
				limit: { unit: "minutes", value: 120 },
			},
			day: undefined,
			releaseDay: "2027-03-11",
		});
		const note = calls.find(
			(entry) =>
				entry.key === "scheduling:scheduling.statutory.apprenticeship.blockWeekTrainingNote",
		);
		expect(note).toBeDefined();
		expect(catalogText(enCatalog, note?.key ?? "")).toBe(note?.fallback);
		expect(typeof catalogText(deCatalog, note?.key ?? "")).toBe("string");
		expect(catalogText(deCatalog, note?.key ?? "")).not.toBe(note?.fallback);
	});

	it("says how much night work no sector exception can cover (§ 14 JArbSchG)", () => {
		// A 16-year-old 16:00–23:45: 225 night minutes, 15 of them past the 23:30 § 14 Abs. 5 allows.
		const night = {
			...base,
			statutoryKind: "jarbschg_night_work",
			legalReference: "§ 14 JArbSchG",
			summary: { tier: "exceeded" as const, used: { unit: "minutes" as const, value: 225 } },
			beyondSectorHours: 15,
		};
		const acknowledgeable = textOf({
			...night,
			beyondSectorHours: undefined,
			acknowledgementStatus: "none",
		});
		expect(acknowledgeable.call?.key).toBe("scheduling:scheduling.statutory.jarbschg.nightWork");
		const hard = textOf(night);
		expect(hard.call?.key).toBe("scheduling:scheduling.statutory.jarbschg.nightWorkBeyondSector");
		expect(hard.call?.params).toMatchObject({ minutes: 15 });
		expect(hard.text).toContain("15 min");
		expect(hard.text).not.toContain("225");
		expect(catalogText(enCatalog, hard.call?.key ?? "")).toBe(hard.call?.fallback);
		expect(typeof catalogText(deCatalog, hard.call?.key ?? "")).toBe("string");
		expect(catalogText(deCatalog, hard.call?.key ?? "")).not.toBe(hard.call?.fallback);
	});

	it("writes the night-work hours in the reader's time format", () => {
		const night = {
			...base,
			statutoryKind: "jarbschg_night_work",
			legalReference: "§ 14 JArbSchG",
			summary: { tier: "exceeded" as const, used: { unit: "minutes" as const, value: 90 } },
			acknowledgementStatus: "none" as const,
		};

		expect(textOf(night).text).toBe("Under 18: 90 min of night work between 20:00 and 06:00");
		expect(textOf(night, "12h").text).toBe(
			"Under 18: 90 min of night work between 8:00 PM and 6:00 AM",
		);

		const beyond = textOf({ ...night, acknowledgementStatus: null, beyondSectorHours: 15 }, "12h");
		expect(beyond.text).toBe(
			"Under 18: 15 min of night work outside the hours a sector exception allows (from 15: 5:00 AM to 9:00 PM; from 16 until 11:30 PM; from 17 in bakeries from 4:00 AM; none under 15); no exception allows it",
		);
		for (const { key, fallback, params } of [textOf(night).call, beyond.call]) {
			expect(catalogText(enCatalog, key)).toBe(fallback);
			const german = catalogText(deCatalog, key);
			expect(typeof german).toBe("string");
			// Every value the text is given has a place in the German text too.
			for (const name of Object.keys(params ?? {})) expect(german).toContain(`{${name}}`);
		}
	});

	it("writes the 24 and 31 December cut-off in the reader's time format", () => {
		const holiday = {
			...base,
			statutoryKind: "jarbschg_holiday_prohibited",
			legalReference: "§ 18 Abs. 1 JArbSchG",
			summary: { tier: "exceeded" as const, used: { unit: "minutes" as const, value: 120 } },
		};

		expect(textOf(holiday).text).toContain("none after 14:00 on 24 or 31 December");
		const twelveHour = textOf(holiday, "12h");
		expect(twelveHour.text).toContain("none after 2:00 PM on 24 or 31 December");
		expect(twelveHour.call?.params).toEqual({ used: 120, cutoff: "2:00 PM" });
		expect(catalogText(enCatalog, twelveHour.call?.key ?? "")).toBe(twelveHour.call?.fallback);
		const german = catalogText(deCatalog, twelveHour.call?.key ?? "");
		expect(german).toContain("{cutoff}");
		expect(german).not.toContain("14 Uhr");
	});

	it.each([
		["jarbschg_daily_max", "Under 18: 720 min of work this day exceeds the 600 min youth limit"],
		["jarbschg_weekly_max", "Under 18: 720 min of work this week exceeds the 600 min youth limit"],
		[
			"jarbschg_shift_span",
			"Under 18: the shift span is 720 min, from the first work to the end of the last; at most 600 min allowed (11 h in hospitality, agriculture, animal husbandry and on construction sites)",
		],
	])(
		"leaves the date of a %s finding to a list that shows it beside the text",
		(kind, expected) => {
			const calls: { key: string; fallback: string; params?: Record<string, unknown> }[] = [];
			const t = ((key: string, fallback: string, params?: Record<string, unknown>) => {
				calls.push({ key, fallback, params });
				return fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ""));
			}) as Parameters<typeof youthProtectionWarningText>[1];
			const finding = { ...base, statutoryKind: kind };

			const text = youthProtectionWarningText(finding, t, "en-US", "24h", { dayShownBeside: true });

			expect(text).toBe(expected);
			expect(text).not.toContain("2027");
			const [{ key, fallback, params }] = calls;
			expect(catalogText(enCatalog, key)).toBe(fallback);
			const german = catalogText(deCatalog, key);
			expect(typeof german).toBe("string");
			expect(german).not.toBe(fallback);
			expect(german).not.toContain("{date}");
			for (const name of Object.keys(params ?? {})) expect(german).toContain(`{${name}}`);
			// Without a date beside it, the text still names the day or week.
			expect(textOf(finding).text).toContain(
				kind === "jarbschg_weekly_max" ? "Mar 1, 2027" : "Mar 2, 2027",
			);
		},
	);

	it("keeps the release-day wording for other release conflicts", () => {
		const { call } = textOf({
			...base,
			statutoryKind: "bbig_release_day_shift",
			domain: "apprenticeship",
			summary: { tier: "exceeded" },
			day: undefined,
			releaseDay: "2027-03-03",
		});
		expect(call?.key).toBe("scheduling:scheduling.statutory.apprenticeship.releaseDayShiftOn");
	});
});
