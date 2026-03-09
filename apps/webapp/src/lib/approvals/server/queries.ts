import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { absenceEntry, approvalRequest, workPeriod } from "@/db/schema";
import { getCurrentEmployee } from "@/app/[locale]/(app)/absences/actions";
import type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "./types";

interface PendingRequestRecord {
	id: string;
	entityId: string;
	entityType: "absence_entry" | "time_entry";
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	requester: {
		user: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		};
	};
}

interface AbsenceLookupRecord {
	id: string;
	startDate: string;
	startPeriod: "full_day" | "am" | "pm";
	endDate: string;
	endPeriod: "full_day" | "am" | "pm";
	notes: string | null;
	category: {
		name: string;
		type: string;
		color: string | null;
	};
}

interface WorkPeriodLookupRecord {
	id: string;
	startTime: Date;
	endTime: Date | null;
	clockIn: {
		timestamp: Date;
	};
	clockOut: {
		timestamp: Date;
	} | null;
}

function splitPendingApprovalIds(pendingRequests: PendingRequestRecord[]) {
	const absenceIds: string[] = [];
	const timeCorrectionIds: string[] = [];

	for (const request of pendingRequests) {
		if (request.entityType === "absence_entry") {
			absenceIds.push(request.entityId);
			continue;
		}

		timeCorrectionIds.push(request.entityId);
	}

	return { absenceIds, timeCorrectionIds };
}

export function buildPendingApprovalResult({
	pendingRequests,
	absencesById,
	periodsById,
}: {
	pendingRequests: PendingRequestRecord[];
	absencesById: Map<string, AbsenceLookupRecord>;
	periodsById: Map<string, WorkPeriodLookupRecord>;
}): {
	absenceApprovals: ApprovalWithAbsence[];
	timeCorrectionApprovals: ApprovalWithTimeCorrection[];
} {
	const absenceApprovals: ApprovalWithAbsence[] = [];
	const timeCorrectionApprovals: ApprovalWithTimeCorrection[] = [];

	for (const request of pendingRequests) {
		if (request.entityType === "absence_entry") {
			const absence = absencesById.get(request.entityId);
			if (!absence) {
				continue;
			}

			absenceApprovals.push({
				...request,
				entityType: "absence_entry",
				absence: {
					id: absence.id,
					startDate: absence.startDate,
					startPeriod: absence.startPeriod,
					endDate: absence.endDate,
					endPeriod: absence.endPeriod,
					notes: absence.notes,
					category: {
						name: absence.category.name,
						type: absence.category.type,
						color: absence.category.color,
					},
				},
			});
			continue;
		}

		const period = periodsById.get(request.entityId);
		if (!period?.clockIn) {
			continue;
		}

		timeCorrectionApprovals.push({
			...request,
			entityType: "time_entry",
			workPeriod: {
				id: period.id,
				startTime: period.startTime,
				endTime: period.endTime,
				clockInEntry: period.clockIn,
				clockOutEntry: period.clockOut ?? null,
			},
		});
	}

	return { absenceApprovals, timeCorrectionApprovals };
}

export async function getPendingApprovals(): Promise<{
	absenceApprovals: ApprovalWithAbsence[];
	timeCorrectionApprovals: ApprovalWithTimeCorrection[];
}> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { absenceApprovals: [], timeCorrectionApprovals: [] };
	}

	const pendingRequests = (await db.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.approverId, currentEmployee.id),
			eq(approvalRequest.status, "pending"),
		),
		with: {
			requester: {
				with: { user: true },
			},
		},
		orderBy: [desc(approvalRequest.createdAt)],
	})) as PendingRequestRecord[];

	const { absenceIds, timeCorrectionIds } = splitPendingApprovalIds(pendingRequests);

	const [absences, periods] = await Promise.all([
		absenceIds.length > 0
			? db.query.absenceEntry.findMany({
					where: inArray(absenceEntry.id, absenceIds),
					with: { category: true },
				})
			: Promise.resolve([]),
		timeCorrectionIds.length > 0
			? db.query.workPeriod.findMany({
					where: inArray(workPeriod.id, timeCorrectionIds),
					with: {
						clockIn: true,
						clockOut: true,
					},
				})
			: Promise.resolve([]),
	]);

	const absencesById = new Map(
		(absences as AbsenceLookupRecord[]).map((absence) => [absence.id, absence] as const),
	);
	const periodsById = new Map(
		(periods as WorkPeriodLookupRecord[]).map((period) => [period.id, period] as const),
	);

	return buildPendingApprovalResult({
		pendingRequests,
		absencesById,
		periodsById,
	});
}

export async function getPendingApprovalCounts() {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { absences: 0, timeCorrections: 0 };
	}

	const counts = await db
		.select({
			type: approvalRequest.entityType,
			count: count(),
		})
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.approverId, currentEmployee.id),
				eq(approvalRequest.status, "pending"),
			),
		)
		.groupBy(approvalRequest.entityType);

	return {
		absences: Number(counts.find((entry) => entry.type === "absence_entry")?.count) || 0,
		timeCorrections: Number(counts.find((entry) => entry.type === "time_entry")?.count) || 0,
	};
}

export { getCurrentEmployee };
