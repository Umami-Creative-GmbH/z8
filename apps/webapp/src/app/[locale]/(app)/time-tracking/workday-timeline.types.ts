import type { DateTime } from "luxon";
import type { WorkPeriodAutoAdjustmentReason } from "@/db/schema";

export type WorkdayTimelineItemType =
	| "shift"
	| "work-period"
	| "break"
	| "absence"
	| "pending-request"
	| "warning";

export type WorkdayTimelineSeverity = "info" | "warning" | "danger";

export interface WorkdayTimelineLink {
	label: string;
	href: string;
}

interface WorkdayTimelineBaseItem {
	id: string;
	type: WorkdayTimelineItemType;
	title: string;
	subtitle?: string;
	startTime?: Date;
	endTime?: Date | null;
	startLabel?: string;
	endLabel?: string;
	badge?: string;
	severity?: WorkdayTimelineSeverity;
	link?: WorkdayTimelineLink;
}

export interface WorkdayTimelineShiftItem extends WorkdayTimelineBaseItem {
	type: "shift";
	status: string;
}

export interface WorkdayTimelineWorkPeriodItem extends WorkdayTimelineBaseItem {
	type: "work-period";
	isActive: boolean;
	durationMinutes: number | null;
	approvalStatus: "approved" | "pending" | "rejected";
	wasAutoAdjusted: boolean;
	autoAdjustmentReason: WorkPeriodAutoAdjustmentReason | null;
}

export interface WorkdayTimelineBreakItem extends WorkdayTimelineBaseItem {
	type: "break";
}

export interface WorkdayTimelineAbsenceItem extends WorkdayTimelineBaseItem {
	type: "absence";
	status: "pending" | "approved" | "rejected";
	color: string | null;
}

export interface WorkdayTimelinePendingRequestItem extends WorkdayTimelineBaseItem {
	type: "pending-request";
	sourceType: "time_correction" | "absence" | "travel_expense" | "shift";
	status: "pending" | "approved" | "rejected" | "cancelled";
}

export interface WorkdayTimelineWarningItem extends WorkdayTimelineBaseItem {
	type: "warning";
	severity: WorkdayTimelineSeverity;
}

export type WorkdayTimelineItem =
	| WorkdayTimelineShiftItem
	| WorkdayTimelineWorkPeriodItem
	| WorkdayTimelineBreakItem
	| WorkdayTimelineAbsenceItem
	| WorkdayTimelinePendingRequestItem
	| WorkdayTimelineWarningItem;

export interface SelectedWorkdayDate {
	dateKey: string;
	todayDateKey: string;
	previousDateKey: string;
	nextDateKey: string;
	label: string;
	startUtc: DateTime;
	endUtc: DateTime;
}

export interface WorkdayTimelineData {
	selectedDate: SelectedWorkdayDate;
	items: WorkdayTimelineItem[];
	dayWarnings: WorkdayTimelineWarningItem[];
	hasScheduledContext: boolean;
	hasRecordedActivity: boolean;
}

export type WorkdayTimelineResult =
	| { success: true; data: WorkdayTimelineData }
	| { success: false; selectedDate: SelectedWorkdayDate; error: string };
