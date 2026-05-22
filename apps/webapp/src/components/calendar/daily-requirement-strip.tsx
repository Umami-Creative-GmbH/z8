"use client";

import type { DailyWorkHoursStatus, DailyWorkHoursSummary } from "@/lib/calendar/types";
import { formatSignedMinutes, formatTimeHours } from "@/lib/calendar/work-hours-summary";

export type RequirementTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string>,
) => string;

export interface RequirementHeaderContent {
	requiredHours: string;
	actualHours: string;
	deltaHours: string | null;
	status: DailyWorkHoursStatus;
	accessibleLabel: string;
}

function formatRequirementLabel(fallback: string, params: Record<string, string>): string {
	return Object.entries(params).reduce(
		(text, [key, value]) => text.replaceAll(`{${key}}`, value),
		fallback,
	);
}

export function getRequirementStatusLabel(
	summary: DailyWorkHoursSummary,
	t: RequirementTranslate,
): string {
	if (summary.status === "under") {
		return t("calendar.requirements.status.under", "under requirement");
	}
	if (summary.status === "missing") {
		return t("calendar.requirements.status.missing", "missing recorded time");
	}
	if (summary.status === "over") {
		return t("calendar.requirements.status.over", "over requirement");
	}
	return t("calendar.requirements.status.met", "requirement met");
}

export function buildRequirementHeaderContent(
	summary: DailyWorkHoursSummary,
	dateLabel: string,
	t: RequirementTranslate,
): RequirementHeaderContent {
	const requiredHours = formatTimeHours(summary.requiredMinutes);
	const actualHours = formatTimeHours(summary.actualMinutes);
	const deltaHours = summary.status === "met" ? null : formatSignedMinutes(summary.deltaMinutes);
	const labelParams = {
		date: dateLabel,
		required: requiredHours,
		actual: actualHours,
		delta: formatSignedMinutes(summary.deltaMinutes),
		status: getRequirementStatusLabel(summary, t),
	};
	const accessibleLabel = t(
		"calendar.requirements.dayLabel",
		formatRequirementLabel(
			"{date}: {required} required, {actual} recorded, {delta} delta, {status}",
			labelParams,
		),
		labelParams,
	);

	return {
		requiredHours,
		actualHours,
		deltaHours,
		status: summary.status,
		accessibleLabel,
	};
}
