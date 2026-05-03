import { DateTime } from "luxon";
import { formatTimeInZone } from "@/lib/time-tracking/timezone-utils";
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

interface SourceWorkPeriod {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: ApprovalStatus;
	pendingChanges: unknown;
	wasAutoAdjusted: boolean;
	autoAdjustmentReason: unknown;
}

interface SourceShift {
	id: string;
	date: string;
	startTime: string;
	endTime: string;
	status: string;
	notes: string | null;
}

interface SourceAbsence {
	id: string;
	startDate: string;
	endDate: string;
	startPeriod: string;
	endPeriod: string;
	status: ApprovalStatus;
	categoryName: string;
	categoryColor: string | null;
}

interface SourcePendingRequest {
	id: string;
	sourceType: PendingRequestSourceType;
	status: PendingRequestStatus;
	title: string;
	subtitle: string;
	submittedAt: Date;
	sourceHref: string;
}

interface NormalizeWorkdayTimelineInput {
	selectedDate: SelectedWorkdayDate;
	timezone: string;
	workPeriods: SourceWorkPeriod[];
	shifts: SourceShift[];
	absences: SourceAbsence[];
	pendingRequests: SourcePendingRequest[];
}

export function normalizeWorkdayTimeline({
	selectedDate,
	timezone,
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
		...shifts.map<WorkdayTimelineItem>((shift) => ({
			id: `shift:${shift.id}`,
			type: "shift",
			title: "Scheduled shift",
			subtitle: shift.notes ?? undefined,
			startTime: getShiftDateTime(shift.date, shift.startTime, timezone),
			endTime: getShiftDateTime(shift.date, shift.endTime, timezone),
			startLabel: shift.startTime,
			endLabel: shift.endTime,
			badge: shift.status,
			status: shift.status,
		})),
		...workPeriods.map<WorkdayTimelineItem>((period) => ({
			id: `work-period:${period.id}`,
			type: "work-period",
			title: "Recorded work",
			subtitle: formatDuration(period.durationMinutes),
			startTime: period.startTime,
			endTime: period.endTime,
			startLabel: formatTimeInZone(period.startTime, timezone),
			endLabel: period.endTime ? formatTimeInZone(period.endTime, timezone) : undefined,
			badge: period.endTime ? period.approvalStatus : "Active",
			isActive: period.endTime === null,
			durationMinutes: period.durationMinutes,
			approvalStatus: period.approvalStatus,
			wasAutoAdjusted: period.wasAutoAdjusted,
			autoAdjustmentReason: period.autoAdjustmentReason as WorkdayTimelineWorkPeriodItem["autoAdjustmentReason"],
		})),
		...pendingRequests
			.filter(
				(request) => request.status === "pending" && request.sourceType !== "travel_expense",
			)
			.map<WorkdayTimelinePendingRequestItem>((request) => ({
				id: `pending-request:${request.id}`,
				type: "pending-request",
				title: request.title,
				subtitle: request.subtitle,
				startTime: request.submittedAt,
				startLabel: formatTimeInZone(request.submittedAt, timezone),
				badge: request.status,
				severity: "info",
				link: { label: "Review request", href: request.sourceHref },
				sourceType: request.sourceType,
				status: request.status,
			})),
	].sort((left, right) => getLocalSortTime(left, timezone) - getLocalSortTime(right, timezone));

	return {
		selectedDate,
		items: [...dayWarnings, ...absenceItems, ...timedItems],
		dayWarnings,
		hasScheduledContext: shifts.length > 0 || absences.length > 0,
		hasRecordedActivity: workPeriods.length > 0,
	};
}

function getWorkPeriodWarnings(period: SourceWorkPeriod): WorkdayTimelineWarningItem[] {
	const warnings: WorkdayTimelineWarningItem[] = [];

	if (period.approvalStatus === "pending" || Boolean(period.pendingChanges)) {
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

function getShiftDateTime(date: string, time: string, timezone: string): Date {
	const dateTime = DateTime.fromISO(`${date}T${time}`, { zone: timezone });
	return dateTime.isValid ? dateTime.toJSDate() : new Date(`${date}T${time}`);
}

function getLocalSortTime(item: WorkdayTimelineItem, timezone: string): number {
	if (!item.startTime) return Number.POSITIVE_INFINITY;
	return DateTime.fromJSDate(item.startTime).setZone(timezone).toMillis();
}

function formatDuration(durationMinutes: number | null): string | undefined {
	if (durationMinutes === null) return undefined;
	const hours = Math.floor(durationMinutes / 60);
	const minutes = durationMinutes % 60;

	if (hours === 0) return `${minutes}m`;
	if (minutes === 0) return `${hours}h`;
	return `${hours}h ${minutes}m`;
}

function formatAbsencePeriod(absence: SourceAbsence): string {
	if (absence.startDate === absence.endDate) {
		return `${absence.startPeriod} (${absence.status})`;
	}

	return `${absence.startDate} ${absence.startPeriod} - ${absence.endDate} ${absence.endPeriod} (${absence.status})`;
}
