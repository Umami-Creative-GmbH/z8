import { DateTime } from "luxon";
import { hasAttemptedOrdinaryTimeApprovalEvidence } from "@/lib/approvals/time-request-kind";
import { dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
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
	/** The organization-local calendar date, `YYYY-MM-DD`. */
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
	/** The zone shift dates and wall times are read in. */
	organizationTimezone: string;
	timeFormat?: TimeFormat;
	workPeriods: WorkdayWorkPeriodSource[];
	shifts: WorkdayShiftSource[];
	absences: WorkdayAbsenceSource[];
	pendingRequests: WorkdayPendingRequestSource[];
}

export function normalizeWorkdayTimeline({
	selectedDate,
	timezone,
	organizationTimezone,
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
		...absenceDayPeriodSubtitle(absencePeriodOn(absence, selectedDate.dateKey)),
		...statusBadge(absence.status),
		status: absence.status,
		color: absence.categoryColor,
		link: {
			label: "View absence",
			labelKey: "timeTracking.timeline.link.viewAbsence",
			href: "/absences",
		},
	}));
	const timedItems = [
		...shifts.map<WorkdayTimelineItem>((shift) => {
			const { startTime, endTime } = getShiftDateTimes(shift, organizationTimezone);

			return {
				id: `shift:${shift.id}`,
				type: "shift",
				title: "Scheduled shift",
				titleKey: "timeTracking.timeline.shift.title",
				subtitle: shift.notes ?? undefined,
				startTime,
				endTime,
				startLabel: formatTimeStringForPreference(shift.startTime, timeFormat),
				endLabel: formatTimeStringForPreference(shift.endTime, timeFormat),
				...statusBadge(shift.status),
				status: shift.status,
			};
		}),
		...workPeriods.map<WorkdayTimelineItem>((period) => ({
			id: `work-period:${period.id}`,
			type: "work-period",
			workPeriodId: period.id,
			title: "Recorded work",
			titleKey: "timeTracking.timeline.workPeriod.title",
			subtitle: formatDuration(period.durationMinutes),
			startTime: period.startTime,
			endTime: period.endTime,
			startLabel: formatTimeInZone(period.startTime, timezone, false, timeFormat),
			endLabel: period.endTime
				? formatTimeInZone(period.endTime, timezone, false, timeFormat)
				: undefined,
			...(period.endTime
				? statusBadge(period.approvalStatus)
				: { badge: "Active", badgeKey: "timeTracking.timeline.status.active" }),
			isActive: period.endTime === null,
			durationMinutes: period.durationMinutes,
			approvalStatus: period.approvalStatus,
			wasAutoAdjusted: period.wasAutoAdjusted,
			autoAdjustmentReason:
				period.autoAdjustmentReason as WorkdayTimelineWorkPeriodItem["autoAdjustmentReason"],
		})),
		...pendingRequests.flatMap<WorkdayTimelinePendingRequestItem>((request) =>
			request.status === "pending" && request.sourceType !== "travel_expense"
				? [
						{
							id: `pending-request:${request.id}`,
							type: "pending-request",
							...pendingRequestText(request),
							startTime: request.submittedAt,
							startLabel: formatTimeInZone(request.submittedAt, timezone, false, timeFormat),
							...statusBadge(request.status),
							severity: "info",
							link: {
								label: "Review request",
								labelKey: "timeTracking.timeline.link.reviewRequest",
								href: request.sourceHref,
							},
							sourceType: request.sourceType,
							status: request.status,
						},
					]
				: [],
		),
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
			titleKey: "timeTracking.timeline.warning.pendingEdit.title",
			subtitle: "This work period has changes awaiting approval.",
			subtitleKey: "timeTracking.timeline.warning.pendingEdit.description",
			severity: "info",
			...(hasRequestInMyRequests(period)
				? {
						link: {
							label: "Review request",
							labelKey: "timeTracking.timeline.link.reviewRequest",
							href: "/my-requests",
						},
					}
				: {}),
		});
	}

	if (period.endTime === null) {
		warnings.push({
			id: `warning:missing-clock-out:${period.id}`,
			type: "warning",
			title: "Missing clock-out",
			titleKey: "timeTracking.timeline.warning.missingClockOut.title",
			subtitle: "This work period is still active.",
			subtitleKey: "timeTracking.timeline.warning.missingClockOut.description",
			severity: "warning",
		});
	}

	if (period.wasAutoAdjusted) {
		warnings.push({
			id: `warning:auto-adjusted:${period.id}`,
			type: "warning",
			title: "Auto-adjusted record",
			titleKey: "timeTracking.timeline.warning.autoAdjusted.title",
			subtitle: "Break or compliance rules adjusted this work period.",
			subtitleKey: "timeTracking.timeline.warning.autoAdjusted.description",
			severity: "info",
		});
	}

	return warnings;
}

type StatusBadge = Pick<WorkdayTimelineItem, "badge" | "badgeKey">;

/** A status badge's English copy and translation key; an unknown status shows as stored. */
function statusBadge(status: string): StatusBadge {
	switch (status) {
		case "approved":
			return {
				badge: "Approved",
				badgeKey: "timeTracking.timeline.status.approved",
			};
		case "pending":
			return {
				badge: "Pending",
				badgeKey: "timeTracking.timeline.status.pending",
			};
		case "rejected":
			return {
				badge: "Rejected",
				badgeKey: "timeTracking.timeline.status.rejected",
			};
		case "cancelled":
			return {
				badge: "Cancelled",
				badgeKey: "timeTracking.timeline.status.cancelled",
			};
		case "published":
			return {
				badge: "Published",
				badgeKey: "timeTracking.timeline.status.published",
			};
		case "draft":
			return { badge: "Draft", badgeKey: "timeTracking.timeline.status.draft" };
		default:
			return { badge: status };
	}
}

type ItemText = Pick<
	WorkdayTimelineItem,
	"title" | "titleKey" | "subtitle" | "subtitleKey" | "subtitleParams"
>;

/** A pending request's copy: a fixed request kind is translated, a category name is not. */
function pendingRequestText(request: WorkdayPendingRequestSource): ItemText {
	if (request.sourceType === "time_correction") {
		return {
			title: "Time correction request",
			titleKey: "timeTracking.timeline.request.timeCorrection.title",
			subtitle: "Correction for a time entry",
			subtitleKey: "timeTracking.timeline.request.timeCorrection.subtitle",
		};
	}

	if (request.sourceType === "absence") {
		const range = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(request.subtitle);
		const title =
			request.title === "absence"
				? {
						title: "Absence request",
						titleKey: "timeTracking.timeline.request.absence.title",
					}
				: { title: request.title };
		return range
			? {
					...title,
					subtitle: "{startDate} – {endDate}",
					subtitleKey: "timeTracking.timeline.request.absence.dateRange",
					subtitleParams: { startDate: range[1], endDate: range[2] },
				}
			: { ...title, subtitle: request.subtitle };
	}

	return { title: request.title, subtitle: request.subtitle };
}

/** The part of the selected day an absence covers. */
function absencePeriodOn(absence: WorkdayAbsenceSource, dateKey: string): string {
	if (dateKey === absence.startDate) return absence.startPeriod;
	if (dateKey === absence.endDate) return absence.endPeriod;
	return "full_day";
}

function absenceDayPeriodSubtitle(period: string): Pick<ItemText, "subtitle" | "subtitleKey"> {
	switch (period) {
		case "am":
			return {
				subtitle: "Morning",
				subtitleKey: "timeTracking.timeline.absence.morning",
			};
		case "pm":
			return {
				subtitle: "Afternoon",
				subtitleKey: "timeTracking.timeline.absence.afternoon",
			};
		default:
			return {
				subtitle: "Full day",
				subtitleKey: "timeTracking.timeline.absence.fullDay",
			};
	}
}

/**
 * Only a requested change to work that already counts has a request in My Requests. Pending
 * manual work and a pending policy clock-out wait as ordinary submissions with no request view
 * (their pending changes carry the ordinary submission's marker), so they get no link.
 */
function hasRequestInMyRequests(period: WorkdayWorkPeriodSource): boolean {
	if (!period.pendingChanges || period.approvalStatus === "pending") return false;
	if (
		hasAttemptedOrdinaryTimeApprovalEvidence({
			pendingChanges: period.pendingChanges,
		})
	) {
		return false;
	}
	const changes = parsePendingChanges(period.pendingChanges);
	return changes !== null && !Object.hasOwn(changes, "ordinarySubmission");
}

/** Pending changes are stored as JSON text; null when they are not an object. */
function parsePendingChanges(value: unknown): object | null {
	let parsed: unknown = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			return null;
		}
	}
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
}

function getShiftDateTimes(
	shift: WorkdayShiftSource,
	organizationTimezone: string,
): { startTime: Date; endTime: Date } {
	const interval = shiftInterval(
		{
			date: parsePlainDate(shift.date),
			startTime: shift.startTime,
			endTime: shift.endTime,
		},
		organizationTimezone,
	);

	return {
		startTime: dateFromInstant(interval.start),
		endTime: dateFromInstant(interval.end),
	};
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
