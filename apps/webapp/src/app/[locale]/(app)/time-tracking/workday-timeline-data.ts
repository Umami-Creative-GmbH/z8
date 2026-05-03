import { and, asc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/db";
import { absenceEntry, shift, workPeriod } from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { getSelfServiceRequests } from "@/lib/self-service-requests/get-self-service-requests";
import type { SelfServiceRequestItem } from "@/lib/self-service-requests/types";
import { getSelectedWorkdayDate } from "./workday-timeline-date";
import { normalizeWorkdayTimeline } from "./workday-timeline-normalize";
import type {
	WorkdayAbsenceSource,
	WorkdayPendingRequestSource,
	WorkdayShiftSource,
	WorkdayWorkPeriodSource,
} from "./workday-timeline-normalize";
import type { WorkdayTimelineResult } from "./workday-timeline.types";

interface GetWorkdayTimelineDataInput {
	employeeId: string;
	organizationId: string;
	timezone: string;
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

export async function getWorkdayTimelineData({
	employeeId,
	organizationId,
	timezone,
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

		return {
			success: true,
			data: normalizeWorkdayTimeline({
				selectedDate,
				timezone,
				workPeriods,
				shifts,
				absences,
				pendingRequests: pendingRequests.items.map(mapPendingRequest),
			}),
		};
	} catch {
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
			gte(workPeriod.startTime, startBound),
			lte(workPeriod.startTime, endBound),
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
	})) as AbsenceRow[];

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

function normalizePendingChanges(pendingChanges: unknown): string | null {
	if (pendingChanges == null) return null;
	if (typeof pendingChanges === "string") return pendingChanges;

	return JSON.stringify(pendingChanges);
}

function formatLogicalDate(value: Date | string): string {
	if (typeof value === "string") return value;

	return value.toISOString().slice(0, 10);
}
