import { describe, expect, it } from "vitest";
import {
	buildPresetReviewValues,
	filterWorkPolicyPresets,
	getPresetSource,
	parsePresetBreakRules,
	summarizeBreakRules,
	summarizeMinutes,
} from "./work-policy-preset-utils";

describe("work policy preset utilities", () => {
	it("classifies system and custom presets", () => {
		expect(getPresetSource({ organizationId: null })).toBe("system");
		expect(getPresetSource({ organizationId: "" })).toBe("system");
		expect(getPresetSource({ organizationId: "org-1" })).toBe("custom");
	});

	it("filters by source, country, name, and description", () => {
		const presets = [
			{
				id: "system-de",
				organizationId: null,
				name: "German Labor Law",
				description: "ArbZG",
				countryCode: "DE",
			},
			{
				id: "custom-retail",
				organizationId: "org-1",
				name: "Retail 38h",
				description: "Store teams",
				countryCode: "DE",
			},
		];

		expect(
			filterWorkPolicyPresets(presets, { search: "retail", source: "custom", countryCode: "DE" }),
		).toEqual([presets[1]]);
	});

	it("builds editable review values from a system preset", () => {
		const values = buildPresetReviewValues({
			id: "system-1",
			organizationId: null,
			name: "German Labor Law",
			description: "ArbZG",
			countryCode: "DE",
			scheduleCycle: "weekly",
			workingDaysPreset: "weekdays",
			hoursPerCycle: "40",
			maxDailyMinutes: 600,
			maxWeeklyMinutes: 2880,
			maxUninterruptedMinutes: 360,
			breakRulesJson: JSON.stringify({
				rules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [] }],
			}),
		});

		expect(values).toMatchObject({
			name: "German Labor Law",
			scheduleEnabled: true,
			regulationEnabled: true,
			countryCode: "DE",
		});
		expect(values.regulation?.breakRules).toHaveLength(1);
	});

	it("formats minutes and break summaries", () => {
		expect(summarizeMinutes(null)).toBe("-");
		expect(summarizeMinutes(600)).toBe("10h");
		expect(summarizeMinutes(615)).toBe("10h 15m");
		expect(summarizeBreakRules([])).toBe("No break rules");
		expect(summarizeBreakRules([{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [] }])).toBe(
			"30m after 6h",
		);
	});

	it("parses break rules safely", () => {
		const rules = [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [] }];

		expect(parsePresetBreakRules(JSON.stringify({ rules }))).toEqual(rules);
		expect(parsePresetBreakRules({ rules })).toEqual(rules);
		expect(parsePresetBreakRules(null)).toEqual([]);
		expect(parsePresetBreakRules("not-json")).toEqual([]);
	});

	it("rejects break rules with malformed options", () => {
		expect(
			parsePresetBreakRules({
				rules: [
					{
						workingMinutesThreshold: 360,
						requiredBreakMinutes: 30,
						options: [
							{
								splitCount: "2",
								minimumSplitMinutes: 15,
								minimumLongestSplitMinutes: null,
							},
						],
					},
				],
			}),
		).toEqual([]);
	});
});
