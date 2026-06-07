import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";

import { db } from "@/db";
import { absenceEntry, approvalRequest, shift, workPeriod } from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { createLogger } from "@/lib/logger";
import { getSelfServiceRequests } from "@/lib/self-service-requests/get-self-service-requests";
import type { SelfServiceRequestItem } from "@/lib/self-service-requests/types";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import type { WorkdayTimelineResult } from "./workday-timeline.types";
import { getSelectedWorkdayDate } from "./workday-timeline-date";
import type {
	WorkdayAbsenceSource,
	WorkdayPendingRequestSource,
	WorkdayShiftSource,
	WorkdayWorkPeriodSource,
} from "./workday-timeline-normalize";
import { normalizeWorkdayTimeline } from "./workday-timeline-normalize";

const logger = createLogger("WorkdayTimelineData");

interface GetWorkdayTimelineDataInput {
	employeeId: string;
	organizationId: string;
	timezone: string;
	timeFormat?: TimeFormat;
	dateParam: string | undefined;
	now?: Date;
}

interface WorkPeriodRow {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	approvalStatus: "approved" | "pending" | "rejected";
	pendingChanges: unknown;
	wasAutoAdjusted: boolean;
	autoAdjustmentReason: unknown;
}

interface ShiftRow {
	id: string;
	date: Date | string;
	startTime: string;
	endTime: string;
	status: string;
	notes: string | null;
}

interface AbsenceRow {
	id: string;
	startDate: Date | string;
	endDate: Date | string;
	startPeriod: string;
	endPeriod: string;
	status: "approved" | "pending" | "rejected";
	category?: { name: string; color: string | null } | null;
}

interface TimeCorrectionApprovalRow {
	id: string;
	entityId: string;
}

export async function getWorkdayTimelineData({
	employeeId,
	organizationId,
	timezone,
	timeFormat,
	dateParam,
	now,
}: GetWorkdayTimelineDataInput): Promise<WorkdayTimelineResult> {
	const selectedDate = getSelectedWorkdayDate({ dateParam, timezone, now });
	const startBound = dateToDB(selectedDate.startUtc)!;
	const endBound = dateToDB(selectedDate.endUtc)!;
	const selectedLogicalDate = selectedDate.dateKey;
	const selectedShiftDate = new Date(`${selectedLogicalDate}T00:00:00.000Z`);

	try {
		const [workPeriods, shifts, absences, pendingRequests] = await Promise.all([
			loadWorkPeriods({ employeeId, organizationId, startBound, endBound }),
			loadShifts({ employeeId, organizationId, selectedShiftDate }),
			loadAbsences({ employeeId, organizationId, selectedLogicalDate }),
			getSelfServiceRequests({
				employeeId,
				organizationId,
				filters: { status: "pending" },
			}),
		]);

		if (pendingRequests.sourceErrors.length > 0) {
			logger.warn(
				{ sourceErrors: pendingRequests.sourceErrors },
				"Workday timeline request sources partially failed",
			);
		}

		const relevantPendingRequests = await filterPendingRequestsForSelectedDate({
			pendingRequests: pendingRequests.items,
			employeeId,
			organizationId,
			selectedDateKey: selectedDate.dateKey,
			timezone,
			startBound,
			endBound,
		});

		return {
			success: true,
			data: normalizeWorkdayTimeline({
				selectedDate,
				timezone,
				timeFormat,
				workPeriods,
				shifts,
				absences,
				pendingRequests: relevantPendingRequests.map(mapPendingRequest),
			}),
		};
	} catch (error) {
		logger.error({ error }, "Workday timeline data could not be loaded");

		return { success: false, selectedDate, error: "Timeline unavailable" };
	}
}

async function loadWorkPeriods({
	employeeId,
	organizationId,
	startBound,
	endBound,
}: {
	employeeId: string;
	organizationId: string;
	startBound: Date;
	endBound: Date;
}): Promise<WorkdayWorkPeriodSource[]> {
	const rows = (await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.organizationId, organizationId),
			eq(workPeriod.employeeId, employeeId),
			isNull(workPeriod.deletedAt),
			lte(workPeriod.startTime, endBound),
			or(gte(workPeriod.endTime, startBound), isNull(workPeriod.endTime)),
		),
		orderBy: [asc(workPeriod.startTime)],
	})) as WorkPeriodRow[];

	return rows.map((row) => ({
		id: row.id,
		startTime: row.startTime,
		endTime: row.endTime,
		durationMinutes: row.durationMinutes,
		approvalStatus: row.approvalStatus,
		pendingChanges: normalizePendingChanges(row.pendingChanges),
		wasAutoAdjusted: row.wasAutoAdjusted,
		autoAdjustmentReason: row.autoAdjustmentReason,
	}));
}

async function loadShifts({
	employeeId,
	organizationId,
	selectedShiftDate,
}: {
	employeeId: string;
	organizationId: string;
	selectedShiftDate: Date;
}): Promise<WorkdayShiftSource[]> {
	const rows = (await db.query.shift.findMany({
		where: and(
			eq(shift.organizationId, organizationId),
			eq(shift.employeeId, employeeId),
			eq(shift.date, selectedShiftDate),
			eq(shift.status, "published"),
		),
		orderBy: [asc(shift.startTime)],
	})) as ShiftRow[];

	return rows.map((row) => ({
		id: row.id,
		date: formatLogicalDate(row.date),
		startTime: row.startTime,
		endTime: row.endTime,
		status: row.status,
		notes: row.notes,
	}));
}

async function loadAbsences({
	employeeId,
	organizationId,
	selectedLogicalDate,
}: {
	employeeId: string;
	organizationId: string;
	selectedLogicalDate: string;
}): Promise<WorkdayAbsenceSource[]> {
	const rows = (await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.organizationId, organizationId),
			eq(absenceEntry.employeeId, employeeId),
			lte(absenceEntry.startDate, selectedLogicalDate),
			gte(absenceEntry.endDate, selectedLogicalDate),
		),
		with: { category: true },
		orderBy: [asc(absenceEntry.startDate)],
	})) as unknown as AbsenceRow[];

	return rows.map((row) => ({
		id: row.id,
		startDate: formatLogicalDate(row.startDate),
		endDate: formatLogicalDate(row.endDate),
		startPeriod: row.startPeriod,
		endPeriod: row.endPeriod,
		status: row.status,
		categoryName: row.category?.name ?? "Absence",
		categoryColor: row.category?.color ?? null,
	}));
}

async function filterPendingRequestsForSelectedDate({
	pendingRequests,
	employeeId,
	organizationId,
	selectedDateKey,
	timezone,
	startBound,
	endBound,
}: {
	pendingRequests: SelfServiceRequestItem[];
	employeeId: string;
	organizationId: string;
	selectedDateKey: string;
	timezone: string;
	startBound: Date;
	endBound: Date;
}): Promise<SelfServiceRequestItem[]> {
	const timeCorrectionRequests = pendingRequests.filter(
		(request) => request.sourceType === "time_correction",
	);
	const relevantTimeCorrectionIds = await getRelevantTimeCorrectionRequestIds({
		requestIds: timeCorrectionRequests.map((request) => request.sourceId),
		employeeId,
		organizationId,
		startBound,
		endBound,
	});

	return pendingRequests.filter((request) => {
		if (request.sourceType === "time_correction") {
			return relevantTimeCorrectionIds.has(request.sourceId);
		}

		return isRequestRelevantToSelectedDate(request, selectedDateKey, timezone);
	});
}

export async function getRelevantTimeCorrectionRequestIds({
	requestIds,
	employeeId,
	organizationId,
	startBound,
	endBound,
}: {
	requestIds: string[];
	employeeId: string;
	organizationId: string;
	startBound: Date;
	endBound: Date;
}): Promise<Set<string>> {
	if (requestIds.length === 0) return new Set();

	const approvals = (await db.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.organizationId, organizationId),
			eq(approvalRequest.requestedBy, employeeId),
			eq(approvalRequest.entityType, "time_entry"),
			eq(approvalRequest.status, "pending"),
			inArray(approvalRequest.id, requestIds),
		),
	})) as TimeCorrectionApprovalRow[];

	if (approvals.length === 0) return new Set();

	const entityIds = approvals.map((approval) => approval.entityId);
	const overlappingWorkPeriods = (await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.organizationId, organizationId),
			eq(workPeriod.employeeId, employeeId),
			inArray(workPeriod.id, entityIds),
			lte(workPeriod.startTime, endBound),
			or(gte(workPeriod.endTime, startBound), isNull(workPeriod.endTime)),
		),
	})) as Pick<WorkPeriodRow, "id">[];
	const overlappingWorkPeriodIds = new Set(overlappingWorkPeriods.map((period) => period.id));

	return new Set(
		approvals.flatMap((approval) =>
			overlappingWorkPeriodIds.has(approval.entityId) ? [approval.id] : [],
		),
	);
}

function mapPendingRequest(request: SelfServiceRequestItem): WorkdayPendingRequestSource {
	return {
		id: request.id,
		sourceType: request.sourceType,
		status: request.status,
		title: request.title,
		subtitle: request.subtitle,
		submittedAt: request.submittedAt,
		sourceHref: request.sourceHref,
	};
}

export function isRequestRelevantToSelectedDate(
	request: SelfServiceRequestItem,
	selectedDateKey: string,
	timezone: string,
): boolean {
	const submittedDateKey = DateTime.fromJSDate(request.submittedAt).setZone(timezone).toISODate();

	if (submittedDateKey === selectedDateKey) return true;
	if (request.subtitle.includes(selectedDateKey)) return true;

	return getDateRanges(request.subtitle).some(
		({ startDateKey, endDateKey }) =>
			startDateKey <= selectedDateKey && selectedDateKey <= endDateKey,
	);
}

export function isWorkPeriodRelevantToSelectedDate(
	period: Pick<WorkPeriodRow, "startTime" | "endTime">,
	selectedDate: Pick<ReturnType<typeof getSelectedWorkdayDate>, "startUtc" | "endUtc">,
): boolean {
	const selectedStart = selectedDate.startUtc.toJSDate();
	const selectedEnd = selectedDate.endUtc.toJSDate();

	return (
		period.startTime <= selectedEnd && (period.endTime === null || period.endTime >= selectedStart)
	);
}

function getDateRanges(subtitle: string): Array<{ startDateKey: string; endDateKey: string }> {
	const ranges: Array<{ startDateKey: string; endDateKey: string }> = [];
	const rangePattern = /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/g;

	for (const match of subtitle.matchAll(rangePattern)) {
		const [, startDateKey, endDateKey] = match;
		if (startDateKey && endDateKey) ranges.push({ startDateKey, endDateKey });
	}

	return ranges;
}

function normalizePendingChanges(pendingChanges: unknown): string | null {
	if (pendingChanges == null) return null;
	if (typeof pendingChanges === "string") return pendingChanges;

	return JSON.stringify(pendingChanges);
}

function formatLogicalDate(value: Date | string): string {
	if (typeof value === "string") return value;

	return value.toISOString().slice(0, 10);
}
