/**
 * Time Regulation Presets Seed Data
 *
 * This file contains pre-defined time regulation presets based on various
 * labor laws and regulations. These are seeded into the timeRegulationPreset
 * table and can be imported by organizations.
 */

import { db } from "@/db";
import { type TimeRegulationBreakRulesPreset, timeRegulationPreset } from "@/db/schema";

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

export const timeRegulationPresetsData = [
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
 * Seeds the time regulation presets into the database
 * This function is idempotent - safe to run multiple times
 */
export async function seedTimeRegulationPresets() {
	console.log("  Seeding time regulation presets...");

	let created = 0;
	let skipped = 0;

	for (const preset of timeRegulationPresetsData) {
		// Check if preset already exists (idempotent)
		const existing = await db.query.timeRegulationPreset.findFirst({
			where: (table, { eq }) => eq(table.name, preset.name),
		});

		if (existing) {
			console.log(`    ○ "${preset.name}" already exists, skipping`);
			skipped++;
			continue;
		}

		await db.insert(timeRegulationPreset).values({
			name: preset.name,
			description: preset.description,
			countryCode: preset.countryCode,
			maxDailyMinutes: preset.maxDailyMinutes,
			maxWeeklyMinutes: preset.maxWeeklyMinutes,
			maxUninterruptedMinutes: preset.maxUninterruptedMinutes,
			breakRulesJson: preset.breakRulesJson,
			isActive: true,
		});

		console.log(`    + Created preset: ${preset.name}`);
		created++;
	}

	console.log(`  Done: ${created} created, ${skipped} skipped`);
}
