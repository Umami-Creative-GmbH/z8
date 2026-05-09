import { DateTime } from "luxon";
import { formatTimeInZone } from "@/lib/time-tracking/timezone-utils";
import { formatTimeStringForPreference, type TimeFormat } from "@/lib/user-preferences/time-format";
import type {
	SelectedWorkdayDate,
	WorkdayTimelineData,
	WorkdayTimelineItem,
	WorkdayTimelinePendingRequestItem,
	WorkdayTimelineWarningItem,
	WorkdayTimelineWorkPeriodItem,
} from "./workday-timeline.types";

type ApprovalStatus = "approved" | "pending" | "rejected";
type PendingRequestStatus = ApprovalStatus | "cancelled";
type PendingRequestSourceType = "time_correction" | "absence" | "travel_expense" | "shift";

export interface WorkdayWorkPeriodSource {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: ApprovalStatus;
	pendingChanges: unknown;
	wasAutoAdjusted: boolean;
	autoAdjustmentReason: unknown;
}

export interface WorkdayShiftSource {
	id: string;
	date: string;
	startTime: string;
	endTime: string;
	status: string;
	notes: string | null;
}

export interface WorkdayAbsenceSource {
	id: string;
	startDate: string;
	endDate: string;
	startPeriod: string;
	endPeriod: string;
	status: ApprovalStatus;
	categoryName: string;
	categoryColor: string | null;
}

export interface WorkdayPendingRequestSource {
	id: string;
	sourceType: PendingRequestSourceType;
	status: PendingRequestStatus;
	title: string;
	subtitle: string;
	submittedAt: Date;
	sourceHref: string;
}

export interface NormalizeWorkdayTimelineInput {
	selectedDate: SelectedWorkdayDate;
	timezone: string;
	timeFormat?: TimeFormat;
	workPeriods: WorkdayWorkPeriodSource[];
	shifts: WorkdayShiftSource[];
	absences: WorkdayAbsenceSource[];
	pendingRequests: WorkdayPendingRequestSource[];
}

export function normalizeWorkdayTimeline({
	selectedDate,
	timezone,
	timeFormat = "24h",
	workPeriods,
	shifts,
	absences,
	pendingRequests,
}: NormalizeWorkdayTimelineInput): WorkdayTimelineData {
	const dayWarnings = workPeriods.flatMap((period) => getWorkPeriodWarnings(period));
	const absenceItems = absences.map<WorkdayTimelineItem>((absence) => ({
		id: `absence:${absence.id}`,
		type: "absence",
		title: absence.categoryName,
		subtitle: formatAbsencePeriod(absence),
		badge: absence.status,
		status: absence.status,
		color: absence.categoryColor,
		link: { label: "View absence", href: "/absences" },
	}));
	const timedItems = [
		...shifts.map<WorkdayTimelineItem>((shift) => {
			const { startTime, endTime } = getShiftDateTimes(shift, timezone);

			return {
				id: `shift:${shift.id}`,
				type: "shift",
				title: "Scheduled shift",
				subtitle: shift.notes ?? undefined,
				startTime,
				endTime,
				startLabel: formatTimeStringForPreference(shift.startTime, timeFormat),
				endLabel: formatTimeStringForPreference(shift.endTime, timeFormat),
				badge: shift.status,
				status: shift.status,
			};
		}),
		...workPeriods.map<WorkdayTimelineItem>((period) => ({
			id: `work-period:${period.id}`,
			type: "work-period",
			title: "Recorded work",
			subtitle: formatDuration(period.durationMinutes),
			startTime: period.startTime,
			endTime: period.endTime,
			startLabel: formatTimeInZone(period.startTime, timezone, false, timeFormat),
			endLabel: period.endTime
				? formatTimeInZone(period.endTime, timezone, false, timeFormat)
				: undefined,
			badge: period.endTime ? period.approvalStatus : "Active",
			isActive: period.endTime === null,
			durationMinutes: period.durationMinutes,
			approvalStatus: period.approvalStatus,
			wasAutoAdjusted: period.wasAutoAdjusted,
			autoAdjustmentReason:
				period.autoAdjustmentReason as WorkdayTimelineWorkPeriodItem["autoAdjustmentReason"],
		})),
		...pendingRequests
			.filter((request) => request.status === "pending" && request.sourceType !== "travel_expense")
			.map<WorkdayTimelinePendingRequestItem>((request) => ({
				id: `pending-request:${request.id}`,
				type: "pending-request",
				title: request.title,
				subtitle: request.subtitle,
				startTime: request.submittedAt,
				startLabel: formatTimeInZone(request.submittedAt, timezone, false, timeFormat),
				badge: request.status,
				severity: "info",
				link: { label: "Review request", href: request.sourceHref },
				sourceType: request.sourceType,
				status: request.status,
			})),
	].sort((left, right) => compareTimedItems(left, right, timezone));

	return {
		selectedDate,
		items: [...absenceItems, ...timedItems],
		dayWarnings,
		hasScheduledContext: shifts.length > 0 || absences.length > 0,
		hasRecordedActivity: workPeriods.length > 0,
	};
}

function getWorkPeriodWarnings(period: WorkdayWorkPeriodSource): WorkdayTimelineWarningItem[] {
	const warnings: WorkdayTimelineWarningItem[] = [];

	if (period.approvalStatus === "pending" || period.pendingChanges) {
		warnings.push({
			id: `warning:pending-edit:${period.id}`,
			type: "warning",
			title: "Pending edit request",
			subtitle: "This work period has changes awaiting approval.",
			severity: "info",
			link: { label: "Review request", href: "/my-requests" },
		});
	}

	if (period.endTime === null) {
		warnings.push({
			id: `warning:missing-clock-out:${period.id}`,
			type: "warning",
			title: "Missing clock-out",
			subtitle: "This work period is still active.",
			severity: "warning",
		});
	}

	if (period.wasAutoAdjusted) {
		warnings.push({
			id: `warning:auto-adjusted:${period.id}`,
			type: "warning",
			title: "Auto-adjusted record",
			subtitle: "Break or compliance rules adjusted this work period.",
			severity: "info",
		});
	}

	return warnings;
}

function getShiftDateTimes(
	shift: WorkdayShiftSource,
	timezone: string,
): { startTime: Date; endTime: Date } {
	const startDateTime = getShiftDateTime(shift.date, shift.startTime, timezone);
	const parsedEndDateTime = getShiftDateTime(shift.date, shift.endTime, timezone);
	const endDateTime =
		parsedEndDateTime <= startDateTime ? parsedEndDateTime.plus({ days: 1 }) : parsedEndDateTime;

	return {
		startTime: startDateTime.toJSDate(),
		endTime: endDateTime.toJSDate(),
	};
}

function getShiftDateTime(date: string, time: string, timezone: string): DateTime {
	const dateTime = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
	return dateTime.isValid ? dateTime : DateTime.fromISO(`${date}T${time}`);
}

function compareTimedItems(
	left: WorkdayTimelineItem,
	right: WorkdayTimelineItem,
	timezone: string,
): number {
	const timeDifference = getLocalSortTime(left, timezone) - getLocalSortTime(right, timezone);
	if (timeDifference !== 0) return timeDifference;

	const priorityDifference = getTypeSortPriority(left) - getTypeSortPriority(right);
	if (priorityDifference !== 0) return priorityDifference;

	return left.id.localeCompare(right.id);
}

function getLocalSortTime(item: WorkdayTimelineItem, timezone: string): number {
	if (!item.startTime) return Number.POSITIVE_INFINITY;
	return DateTime.fromJSDate(item.startTime).setZone(timezone).toMillis();
}

function getTypeSortPriority(item: WorkdayTimelineItem): number {
	switch (item.type) {
		case "shift":
			return 0;
		case "work-period":
			return 1;
		case "pending-request":
			return 2;
		default:
			return 3;
	}
}

function formatDuration(durationMinutes: number | null): string | undefined {
	if (durationMinutes === null) return undefined;
	const hours = Math.floor(durationMinutes / 60);
	const minutes = durationMinutes % 60;

	if (hours === 0) return `${minutes}m`;
	if (minutes === 0) return `${hours}h`;
	return `${hours}h ${minutes}m`;
}

function formatAbsencePeriod(absence: WorkdayAbsenceSource): string {
	if (absence.startDate === absence.endDate) {
		return `${absence.startPeriod} (${absence.status})`;
	}

	return `${absence.startDate} ${absence.startPeriod} - ${absence.endDate} ${absence.endPeriod} (${absence.status})`;
}
