"use client";

import type { DailyWorkHoursStatus, DailyWorkHoursSummary } from "@/lib/calendar/types";
import { formatSignedMinutes, formatTimeHours } from "@/lib/calendar/work-hours-summary";

export type RequirementTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string>,
) => string;

export interface RequirementHeaderContent {
	/** Null on a day without required hours. */
	requiredHours: string | null;
	actualHours: string;
	deltaHours: string | null;
	status: DailyWorkHoursStatus | null;
	/** Set while the total still counts running work. */
	liveLabel: string | null;
	accessibleLabel: string;
}

export function getRequirementStatusLabel(
	status: DailyWorkHoursStatus,
	t: RequirementTranslate,
): string {
	if (status === "under") {
		return t("calendar.requirements.status.under", "under requirement");
	}
	if (status === "missing") {
		return t("calendar.requirements.status.missing", "missing recorded time");
	}
	if (status === "over") {
		return t("calendar.requirements.status.over", "over requirement");
	}
	return t("calendar.requirements.status.met", "requirement met");
}

export function buildRequirementHeaderContent(
	summary: DailyWorkHoursSummary,
	dateLabel: string,
	t: RequirementTranslate,
): RequirementHeaderContent {
	const { requirement } = summary;
	const actualHours = formatTimeHours(summary.actualMinutes);
	const liveLabel = summary.includesLiveWork
		? t("calendar.requirements.includesRunningWork", "Includes running work")
		: null;
	let accessibleLabel: string;

	if (requirement) {
		const labelParams = {
			date: dateLabel,
			required: formatTimeHours(requirement.requiredMinutes),
			actual: actualHours,
			delta: formatSignedMinutes(requirement.deltaMinutes),
			status: getRequirementStatusLabel(requirement.status, t),
		};
		accessibleLabel = t(
			"calendar.requirements.dayLabel",
			"{date}: {required} required, {actual} recorded, {delta} delta, {status}",
			labelParams,
		);
	} else {
		const labelParams = { date: dateLabel, actual: actualHours };
		accessibleLabel = t(
			"calendar.requirements.recordedOnlyDayLabel",
			"{date}: {actual} recorded",
			labelParams,
		);
	}

	return {
		requiredHours: requirement ? formatTimeHours(requirement.requiredMinutes) : null,
		actualHours,
		deltaHours:
			requirement && requirement.status !== "met"
				? formatSignedMinutes(requirement.deltaMinutes)
				: null,
		status: requirement?.status ?? null,
		liveLabel,
		accessibleLabel: liveLabel ? `${accessibleLabel}. ${liveLabel}` : accessibleLabel,
	};
}
