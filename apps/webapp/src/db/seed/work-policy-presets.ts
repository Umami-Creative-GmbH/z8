/**
 * Work Policy Presets Seed Data
 *
 * This file contains pre-defined work policy presets based on various
 * labor laws and regulations. These are seeded into the workPolicyPreset
 * table and can be imported by organizations.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "..";
import { workPolicyPreset } from "../schema";
import type { TimeRegulationBreakRulesPreset } from "../schema/types";

// German Labor Law (Arbeitszeitgesetz - ArbZG)
const germanLaborLaw: TimeRegulationBreakRulesPreset = {
	rules: [
		{
			// More than 6 hours: 30 min break
			workingMinutesThreshold: 360,
			requiredBreakMinutes: 30,
			options: [
				{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null },
				{ splitCount: 2, minimumSplitMinutes: 15, minimumLongestSplitMinutes: null },
			],
		},
		{
			// More than 9 hours: 45 min break total
			workingMinutesThreshold: 540,
			requiredBreakMinutes: 45,
			options: [
				{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null },
				{ splitCount: 2, minimumSplitMinutes: 15, minimumLongestSplitMinutes: null },
				{ splitCount: 3, minimumSplitMinutes: 15, minimumLongestSplitMinutes: null },
			],
		},
	],
};

// EU Working Time Directive (2003/88/EC)
const euWorkingTimeDirective: TimeRegulationBreakRulesPreset = {
	rules: [
		{
			// More than 6 hours: break required (duration varies by member state)
			workingMinutesThreshold: 360,
			requiredBreakMinutes: 20,
			options: [{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null }],
		},
	],
};

// French Labor Code (Code du travail)
const frenchLaborCode: TimeRegulationBreakRulesPreset = {
	rules: [
		{
			// More than 6 hours: 20 min break minimum
			workingMinutesThreshold: 360,
			requiredBreakMinutes: 20,
			options: [{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null }],
		},
	],
};

// UK Working Time Regulations 1998
const ukWorkingTimeRegs: TimeRegulationBreakRulesPreset = {
	rules: [
		{
			// More than 6 hours: 20 min break
			workingMinutesThreshold: 360,
			requiredBreakMinutes: 20,
			options: [{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null }],
		},
	],
};

// Swiss SECO Guidelines (ArG - Arbeitsgesetz)
const swissSecoGuidelines: TimeRegulationBreakRulesPreset = {
	rules: [
		{
			// More than 5.5 hours: 15 min break
			workingMinutesThreshold: 330,
			requiredBreakMinutes: 15,
			options: [{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null }],
		},
		{
			// More than 7 hours: 30 min break
			workingMinutesThreshold: 420,
			requiredBreakMinutes: 30,
			options: [
				{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null },
				{ splitCount: 2, minimumSplitMinutes: 15, minimumLongestSplitMinutes: null },
			],
		},
		{
			// More than 9 hours: 60 min break
			workingMinutesThreshold: 540,
			requiredBreakMinutes: 60,
			options: [
				{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null },
				{ splitCount: 2, minimumSplitMinutes: 15, minimumLongestSplitMinutes: null },
				{ splitCount: null, minimumSplitMinutes: null, minimumLongestSplitMinutes: 30 },
			],
		},
	],
};

// Austrian Labor Code (Arbeitszeitgesetz)
const austrianLaborCode: TimeRegulationBreakRulesPreset = {
	rules: [
		{
			// More than 6 hours: 30 min break
			workingMinutesThreshold: 360,
			requiredBreakMinutes: 30,
			options: [
				{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null },
				{ splitCount: 2, minimumSplitMinutes: 15, minimumLongestSplitMinutes: null },
				{ splitCount: 3, minimumSplitMinutes: 10, minimumLongestSplitMinutes: null },
			],
		},
	],
};

export const workPolicyPresetsData = [
	{
		name: "German Labor Law (ArbZG)",
		description:
			"Based on Arbeitszeitgesetz - German Working Time Act. Max 8h/day (up to 10h with compensation), max 48h/week, 11h minimum rest between shifts.",
		countryCode: "DE",
		maxDailyMinutes: 600, // 10 hours (max with compensation)
		maxWeeklyMinutes: 2880, // 48 hours
		maxUninterruptedMinutes: 360, // 6 hours
		breakRulesJson: germanLaborLaw,
	},
	{
		name: "EU Working Time Directive",
		description:
			"Based on Directive 2003/88/EC. Framework for EU member states. Max 48h/week (averaged), 11h daily rest, 20 min break after 6h.",
		countryCode: "EU",
		maxDailyMinutes: null, // Not specified at EU level
		maxWeeklyMinutes: 2880, // 48 hours (averaged over reference period)
		maxUninterruptedMinutes: 360, // 6 hours
		breakRulesJson: euWorkingTimeDirective,
	},
	{
		name: "French Labor Code",
		description:
			"Based on Code du travail. 35h standard week, max 10h/day, max 48h/week (44h averaged over 12 weeks).",
		countryCode: "FR",
		maxDailyMinutes: 600, // 10 hours
		maxWeeklyMinutes: 2640, // 44 hours (averaged)
		maxUninterruptedMinutes: 360, // 6 hours
		breakRulesJson: frenchLaborCode,
	},
	{
		name: "UK Working Time Regulations",
		description:
			"Based on Working Time Regulations 1998. Max 48h/week (opt-out available), 11h daily rest, 20 min break after 6h.",
		countryCode: "GB",
		maxDailyMinutes: null, // No daily max specified
		maxWeeklyMinutes: 2880, // 48 hours (can opt out)
		maxUninterruptedMinutes: 360, // 6 hours
		breakRulesJson: ukWorkingTimeRegs,
	},
	{
		name: "Swiss SECO Guidelines (ArG)",
		description:
			"Based on Arbeitsgesetz - Swiss Labor Act. Max 45h/week for industrial workers, 50h for others. Graduated break requirements.",
		countryCode: "CH",
		maxDailyMinutes: null, // Not strictly limited
		maxWeeklyMinutes: 2700, // 45 hours (industrial)
		maxUninterruptedMinutes: 330, // 5.5 hours
		breakRulesJson: swissSecoGuidelines,
	},
	{
		name: "Austrian Labor Code",
		description:
			"Based on Arbeitszeitgesetz. Similar to German law. Max 10h/day, max 50h/week, 11h daily rest.",
		countryCode: "AT",
		maxDailyMinutes: 600, // 10 hours
		maxWeeklyMinutes: 3000, // 50 hours
		maxUninterruptedMinutes: 360, // 6 hours
		breakRulesJson: austrianLaborCode,
	},
];

/**
 * Seeds the work policy presets into the database
 * Upserts system presets while preserving organization-owned custom presets
 */
export async function seedWorkPolicyPresets() {
	console.log("  Seeding work policy presets...");

	let upserted = 0;

	for (const preset of workPolicyPresetsData) {
		const values = {
			organizationId: null,
			name: preset.name,
			description: preset.description,
			countryCode: preset.countryCode,
			maxDailyMinutes: preset.maxDailyMinutes,
			maxWeeklyMinutes: preset.maxWeeklyMinutes,
			maxUninterruptedMinutes: preset.maxUninterruptedMinutes,
			breakRulesJson: JSON.stringify(
				preset.breakRulesJson,
			) as unknown as typeof preset.breakRulesJson,
			isActive: true,
		};

		const existingSystemPreset = await db.query.workPolicyPreset.findFirst({
			where: and(isNull(workPolicyPreset.organizationId), eq(workPolicyPreset.name, preset.name)),
		});

		if (existingSystemPreset) {
			await db
				.update(workPolicyPreset)
				.set(values)
				.where(eq(workPolicyPreset.id, existingSystemPreset.id));
			console.log(`    ~ Updated preset: ${preset.name}`);
		} else {
			await db.insert(workPolicyPreset).values(values);
			console.log(`    + Created preset: ${preset.name}`);
		}

		upserted++;
	}

	console.log(`  Done: ${upserted} system presets upserted`);
}
