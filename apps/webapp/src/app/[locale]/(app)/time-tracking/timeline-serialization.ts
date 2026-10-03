import "server-only";

import type {
	SerializableWorkdayTimelineItem,
	SerializableWorkdayTimelineResult,
} from "@/components/time-tracking/personal-workday-timeline";
import type {
	SelectedWorkdayDate,
	WorkdayTimelineItem,
	WorkdayTimelineResult,
} from "./workday-timeline.types";

export function serializeWorkdayTimelineResult(
	result: WorkdayTimelineResult,
): SerializableWorkdayTimelineResult {
	if (!result.success) {
		return {
			success: false,
			selectedDate: serializeSelectedDate(result.selectedDate),
			error: result.error,
		};
	}

	return {
		success: true,
		data: {
			...result.data,
			selectedDate: serializeSelectedDate(result.data.selectedDate),
			items: result.data.items.map(serializeTimelineItem),
			dayWarnings: result.data.dayWarnings.map(serializeTimelineItem),
		},
	};
}

function serializeSelectedDate({
	dateKey,
	todayDateKey,
	previousDateKey,
	nextDateKey,
	label,
}: SelectedWorkdayDate) {
	return { dateKey, todayDateKey, previousDateKey, nextDateKey, label };
}

function serializeTimelineItem({
	id,
	type,
	title,
	subtitle,
	startLabel,
	endLabel,
	badge,
	severity,
	link,
}: WorkdayTimelineItem): SerializableWorkdayTimelineItem {
	return {
		id,
		type,
		title,
		subtitle,
		startLabel,
		endLabel,
		badge,
		severity,
		link,
	};
}
