/**
 * Coverage Adaptive Card Builder
 *
 * Builds the coverage report card showing staffing by subarea and time slot.
 * Color-codes coverage status: understaffed (red), adequate (green), overstaffed (blue).
 */

import { DateTime } from "luxon";
import type { CoverageSummary } from "@/lib/effect/services/coverage.service";
import { fmtFullDate } from "@/lib/bot-platform/i18n";

// ============================================
// TYPES
// ============================================

export interface CoverageCardInput {
	summary: CoverageSummary;
	appUrl: string;
	locale: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getStatusColor(status: "understaffed" | "adequate" | "overstaffed"): string {
	switch (status) {
		case "understaffed":
			return "attention"; // Red
		case "overstaffed":
			return "accent"; // Blue
		case "adequate":
		default:
			return "good"; // Green
	}
}

function getStatusIcon(status: "understaffed" | "adequate" | "overstaffed"): string {
	switch (status) {
		case "understaffed":
			return "🔴";
		case "overstaffed":
			return "🔵";
		case "adequate":
		default:
			return "🟢";
	}
}

function formatVariance(variance: number): string {
	if (variance > 0) return `+${variance}`;
	return variance.toString();
}

// ============================================
// CARD BUILDER
// ============================================

export function buildCoverageCard(input: CoverageCardInput): Record<string, unknown> {
	const { summary, appUrl, locale } = input;
	const dateFormatted = fmtFullDate(
		DateTime.fromJSDate(summary.date).setZone(summary.timezone),
		locale,
	);

	// Group snapshots by subarea for display
	const bySubarea = new Map<string, typeof summary.snapshots>();
	for (const snapshot of summary.snapshots) {
		const key = `${snapshot.locationName} - ${snapshot.subareaName}`;
		const existing = bySubarea.get(key) || [];
		existing.push(snapshot);
		bySubarea.set(key, existing);
	}

	const body: Array<Record<string, unknown>> = [
		// Header
		{
			type: "Container",
			style: "emphasis",
			items: [
				{
					type: "TextBlock",
					text: "📊 Coverage Report",
					weight: "bolder",
					size: "large",
				},
				{
					type: "TextBlock",
					text: dateFormatted,
					spacing: "none",
					isSubtle: true,
				},
			],
			bleed: true,
			padding: "default",
		},
		// Summary Stats
		{
			type: "Container",
			spacing: "medium",
			items: [
				{
					type: "ColumnSet",
					columns: [
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: "Scheduled",
									weight: "bolder",
									horizontalAlignment: "center",
								},
								{
									type: "TextBlock",
									text: summary.totalScheduled.toString(),
									size: "extraLarge",
									horizontalAlignment: "center",
									color: "default",
								},
							],
						},
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: "Clocked In",
									weight: "bolder",
									horizontalAlignment: "center",
								},
								{
									type: "TextBlock",
									text: summary.totalClockedIn.toString(),
									size: "extraLarge",
									horizontalAlignment: "center",
									color: summary.totalVariance >= 0 ? "good" : "attention",
								},
							],
						},
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: "Variance",
									weight: "bolder",
									horizontalAlignment: "center",
								},
								{
									type: "TextBlock",
									text: formatVariance(summary.totalVariance),
									size: "extraLarge",
									horizontalAlignment: "center",
									color: summary.totalVariance >= 0 ? "good" : "attention",
								},
							],
						},
					],
				},
			],
		},
	];

	// Coverage by subarea
	let subareaCount = 0;
	for (const [subareaKey, snapshots] of bySubarea) {
		if (subareaCount >= 5) {
			body.push({
				type: "TextBlock",
				text: `_+${bySubarea.size - 5} more locations..._`,
				isSubtle: true,
				spacing: "medium",
			});
			break;
		}

		// Calculate subarea totals
		const scheduled = snapshots.reduce((sum, s) => sum + s.scheduled, 0);
		const clockedIn = snapshots.reduce((sum, s) => sum + s.clockedIn, 0);
		const variance = clockedIn - scheduled;
		const status = variance < 0 ? "understaffed" : variance > 0 ? "overstaffed" : "adequate";

		body.push({
			type: "Container",
			spacing: subareaCount === 0 ? "medium" : "small",
			separator: subareaCount === 0,
			items: [
				{
					type: "ColumnSet",
					columns: [
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: `${getStatusIcon(status)} **${subareaKey}**`,
									wrap: true,
								},
							],
						},
						{
							type: "Column",
							width: "auto",
							items: [
								{
									type: "TextBlock",
									text: `${clockedIn}/${scheduled}`,
									color: getStatusColor(status),
								},
							],
						},
						{
							type: "Column",
							width: "auto",
							items: [
								{
									type: "TextBlock",
									text: `(${formatVariance(variance)})`,
									color: getStatusColor(status),
									isSubtle: true,
								},
							],
						},
					],
				},
				// Time slot breakdown (show first 3 slots only)
				...snapshots.slice(0, 3).map((snapshot) => ({
					type: "ColumnSet",
					spacing: "none",
					columns: [
						{
							type: "Column",
							width: "30px",
							items: [] as unknown[],
						},
						{
							type: "Column",
							width: "stretch",
							items: [
								{
									type: "TextBlock",
									text: snapshot.timeSlot,
									size: "small",
									isSubtle: true,
								},
							],
						},
						{
							type: "Column",
							width: "auto",
							items: [
								{
									type: "TextBlock",
									text: `${snapshot.clockedIn}/${snapshot.scheduled}`,
									size: "small",
									color: getStatusColor(snapshot.status),
								},
							],
						},
					],
				})),
				...(snapshots.length > 3
					? [
							{
								type: "TextBlock",
								text: `_+${snapshots.length - 3} more time slots_`,
								size: "small",
								isSubtle: true,
								spacing: "none",
							},
						]
					: []),
			],
		});

		subareaCount++;
	}

	// Legend
	body.push({
		type: "Container",
		spacing: "medium",
		separator: true,
		items: [
			{
				type: "TextBlock",
				text: "🟢 Adequate  🔴 Understaffed  🔵 Overstaffed",
				size: "small",
				isSubtle: true,
				horizontalAlignment: "center",
			},
		],
	});

	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body,
		actions: [
			{
				type: "Action.OpenUrl",
				title: "View Full Schedule",
				url: `${appUrl}/scheduling`,
			},
		],
	};
}

/**
 * Build text-only coverage summary (fallback for non-card clients)
 */
export function buildCoverageText(input: CoverageCardInput): string {
	const { summary, locale } = input;
	const dateFormatted = fmtFullDate(
		DateTime.fromJSDate(summary.date).setZone(summary.timezone),
		locale,
	);

	const lines: string[] = [
		`**📊 Coverage Report - ${dateFormatted}**`,
		"",
		`**Total:** ${summary.totalClockedIn}/${summary.totalScheduled} (${formatVariance(summary.totalVariance)})`,
		"",
	];

	// Group by subarea
	const bySubarea = new Map<string, typeof summary.snapshots>();
	for (const snapshot of summary.snapshots) {
		const key = `${snapshot.locationName} - ${snapshot.subareaName}`;
		const existing = bySubarea.get(key) || [];
		existing.push(snapshot);
		bySubarea.set(key, existing);
	}

	for (const [subareaKey, snapshots] of bySubarea) {
		const scheduled = snapshots.reduce((sum, s) => sum + s.scheduled, 0);
		const clockedIn = snapshots.reduce((sum, s) => sum + s.clockedIn, 0);
		const variance = clockedIn - scheduled;
		const status = variance < 0 ? "🔴" : variance > 0 ? "🔵" : "🟢";

		lines.push(`${status} **${subareaKey}**: ${clockedIn}/${scheduled}`);
	}

	return lines.join("\n");
}
