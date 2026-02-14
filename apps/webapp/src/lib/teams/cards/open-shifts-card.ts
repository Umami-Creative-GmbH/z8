/**
 * Open Shifts Adaptive Card Builder
 *
 * Builds the open shifts card with interactive "Request Pickup" buttons.
 * Uses Action.Submit for direct pickup requests via bot invoke handler.
 */

import { DateTime } from "luxon";
import type { OpenShiftWithDetails } from "@/lib/effect/services/open-shifts.service";
import { fmtWeekdayShortDate } from "@/lib/bot-platform/i18n";

// ============================================
// TYPES
// ============================================

export interface OpenShiftsCardInput {
	shifts: OpenShiftWithDetails[];
	timezone: string;
	appUrl: string;
	requesterId: string;
	locale: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatShiftTime(startTime: string, endTime: string): string {
	return `${startTime} - ${endTime}`;
}

function formatShiftDate(date: Date, timezone: string, locale: string): string {
	const dt = DateTime.fromJSDate(date).setZone(timezone);
	const now = DateTime.now().setZone(timezone);

	if (dt.hasSame(now, "day")) {
		return "Today";
	}

	if (dt.hasSame(now.plus({ days: 1 }), "day")) {
		return "Tomorrow";
	}

	return fmtWeekdayShortDate(dt, locale);
}

function calculateShiftDuration(startTime: string, endTime: string): string {
	const [startH, startM] = startTime.split(":").map(Number);
	const [endH, endM] = endTime.split(":").map(Number);

	let durationMins = (endH * 60 + endM) - (startH * 60 + startM);
	if (durationMins < 0) durationMins += 24 * 60; // Handle overnight shifts

	const hours = Math.floor(durationMins / 60);
	const mins = durationMins % 60;

	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

// ============================================
// CARD BUILDER
// ============================================

export function buildOpenShiftsCard(input: OpenShiftsCardInput): Record<string, unknown> {
	const { shifts, timezone, appUrl, requesterId, locale } = input;

	// Group shifts by date
	const shiftsByDate = new Map<string, OpenShiftWithDetails[]>();
	for (const shift of shifts) {
		const dateKey = DateTime.fromJSDate(shift.date).setZone(timezone).toISODate();
		if (!dateKey) continue; // Skip shifts with invalid dates
		const existing = shiftsByDate.get(dateKey) || [];
		existing.push(shift);
		shiftsByDate.set(dateKey, existing);
	}

	const body: Array<Record<string, unknown>> = [
		// Header
		{
			type: "Container",
			style: "emphasis",
			items: [
				{
					type: "TextBlock",
					text: "📋 Open Shifts",
					weight: "bolder",
					size: "large",
				},
				{
					type: "TextBlock",
					text: `${shifts.length} shift${shifts.length !== 1 ? "s" : ""} available for pickup`,
					spacing: "none",
					isSubtle: true,
				},
			],
			bleed: true,
			padding: "default",
		},
	];

	// Shifts grouped by date
	let dateCount = 0;
	let shiftsDisplayed = 0;
	for (const [dateKey, dateShifts] of shiftsByDate) {
		if (dateCount >= 4) {
			const remainingShifts = shifts.length - shiftsDisplayed;
			if (remainingShifts > 0) {
				body.push({
					type: "TextBlock",
					text: `_+${remainingShifts} more shifts..._`,
					isSubtle: true,
					spacing: "medium",
				});
			}
			break;
		}

		const dateFormatted = formatShiftDate(DateTime.fromISO(dateKey).toJSDate(), timezone, locale);

		body.push({
			type: "Container",
			spacing: dateCount === 0 ? "medium" : "default",
			separator: dateCount > 0,
			items: [
				{
					type: "TextBlock",
					text: `**${dateFormatted}**`,
					weight: "bolder",
					size: "medium",
				},
				...dateShifts.slice(0, 3).map((shift) => ({
					type: "Container",
					spacing: "small",
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
											text: `**${shift.subarea.location.name}** - ${shift.subarea.name}`,
											wrap: true,
										},
										{
											type: "TextBlock",
											text: `🕐 ${formatShiftTime(shift.startTime, shift.endTime)} (${calculateShiftDuration(shift.startTime, shift.endTime)})`,
											size: "small",
											isSubtle: true,
											spacing: "none",
										},
										...(shift.pendingRequestsCount > 0
											? [
													{
														type: "TextBlock",
														text: `👥 ${shift.pendingRequestsCount} pending request${shift.pendingRequestsCount !== 1 ? "s" : ""}`,
														size: "small",
														isSubtle: true,
														spacing: "none",
													},
												]
											: []),
									],
								},
								{
									type: "Column",
									width: "auto",
									verticalContentAlignment: "center",
									items: [
										{
											type: "ActionSet",
											actions: [
												{
													type: "Action.Submit",
													title: "Request",
													style: "positive",
													data: {
														msteams: {
															type: "messageBack",
															displayText: "Requesting shift pickup...",
															text: "shift_pickup",
															value: {
																action: "shift_pickup",
																shiftId: shift.id,
																requesterId,
															},
														},
													},
												},
											],
										},
									],
								},
							],
						},
					],
				})),
				...(dateShifts.length > 3
					? [
							{
								type: "TextBlock",
								text: `_+${dateShifts.length - 3} more on this day_`,
								size: "small",
								isSubtle: true,
							},
						]
					: []),
			],
		});

		dateCount++;
		shiftsDisplayed += Math.min(dateShifts.length, 3);
	}

	// Notes
	body.push({
		type: "Container",
		spacing: "medium",
		separator: true,
		items: [
			{
				type: "TextBlock",
				text: "💡 Requests require manager approval",
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
				title: "View All Shifts",
				url: `${appUrl}/scheduling`,
			},
		],
	};
}

/**
 * Build text-only open shifts list (fallback for non-card clients)
 */
export function buildOpenShiftsText(input: OpenShiftsCardInput): string {
	const { shifts, timezone, locale } = input;

	const lines: string[] = [
		`**📋 Open Shifts**`,
		`${shifts.length} shift${shifts.length !== 1 ? "s" : ""} available`,
		"",
	];

	// Group by date
	const shiftsByDate = new Map<string, OpenShiftWithDetails[]>();
	for (const shift of shifts) {
		const dateKey = formatShiftDate(shift.date, timezone, locale);
		const existing = shiftsByDate.get(dateKey) || [];
		existing.push(shift);
		shiftsByDate.set(dateKey, existing);
	}

	for (const [dateLabel, dateShifts] of shiftsByDate) {
		lines.push(`**${dateLabel}:**`);
		for (const shift of dateShifts.slice(0, 5)) {
			lines.push(
				`• ${shift.subarea.location.name} - ${shift.subarea.name}: ${formatShiftTime(shift.startTime, shift.endTime)}`,
			);
		}
		if (dateShifts.length > 5) {
			lines.push(`  +${dateShifts.length - 5} more`);
		}
		lines.push("");
	}

	lines.push("_Use the web app to request shift pickups_");

	return lines.join("\n");
}
