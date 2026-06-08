import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { getCurrentEmployee } from "@/app/[locale]/(app)/absences/actions";
import { db } from "@/db";
import { absenceEntry, approvalRequest, timeEntry, workPeriod } from "@/db/schema";
import type { SickDetail } from "@/lib/absences/types";
import type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "./types";

interface PendingRequestRecord {
	id: string;
	entityId: string;
	entityType: "absence_entry" | "time_entry";
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	metadata?: unknown;
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
	sickDetail: SickDetail | null;
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
		id: string;
		timestamp: Date;
	};
	clockOut: {
		id: string;
		timestamp: Date;
	} | null;
	correctionReviewEntries?: CorrectionEntryForReview[];
}

interface CorrectionEntryForReview {
	id: string;
	timestamp: Date;
	replacesEntryId: string | null;
	isSuperseded?: boolean;
}

type TimeCorrectionApprovalMetadata = {
	timeCorrection?: {
		clockInCorrectionId?: string;
		clockOutCorrectionId?: string;
	};
};

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

function correctionMetadataFromRequest(request: { metadata?: unknown }) {
	return (request.metadata as TimeCorrectionApprovalMetadata | null)?.timeCorrection;
}

function isOrphanedTimeCorrectionApproval(
	request: PendingRequestRecord,
	period: WorkPeriodLookupRecord,
): boolean {
	const metadata = correctionMetadataFromRequest(request);
	const correctionEntries = period.correctionReviewEntries ?? [];
	const correctionById = new Map(correctionEntries.map((entry) => [entry.id, entry]));
	const legacyCorrectionEntries = correctionEntries.filter((entry) => !entry.isSuperseded);
	const clockInCandidates = legacyCorrectionEntries.filter(
		(entry) => entry.replacesEntryId === period.clockIn.id,
	);
	const clockOutCandidates = period.clockOut
		? legacyCorrectionEntries.filter((entry) => entry.replacesEntryId === period.clockOut?.id)
		: [];
	const clockInCorrection = metadata?.clockInCorrectionId
		? correctionById.get(metadata.clockInCorrectionId)
		: clockInCandidates.length === 1
			? clockInCandidates[0]
			: undefined;
	const clockOutCorrection = metadata?.clockOutCorrectionId
		? correctionById.get(metadata.clockOutCorrectionId)
		: clockOutCandidates.length === 1
			? clockOutCandidates[0]
			: undefined;
	const matchingClockInCorrection =
		clockInCorrection?.replacesEntryId === period.clockIn.id ? clockInCorrection : null;
	const matchingClockOutCorrection =
		clockOutCorrection?.replacesEntryId === period.clockOut?.id ? clockOutCorrection : null;
	const hasMetadataCorrectionIds = Boolean(
		metadata?.clockInCorrectionId || metadata?.clockOutCorrectionId,
	);

	return hasMetadataCorrectionIds
		? Boolean(metadata?.clockInCorrectionId && !matchingClockInCorrection) ||
				Boolean(metadata?.clockOutCorrectionId && !matchingClockOutCorrection)
		: !matchingClockInCorrection || clockInCandidates.length > 1 || clockOutCandidates.length > 1;
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
					sickDetail: absence.category.type === "sick" ? absence.sickDetail : null,
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
		if (isOrphanedTimeCorrectionApproval(request, period)) {
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
			eq(approvalRequest.organizationId, currentEmployee.organizationId),
			eq(approvalRequest.approverId, currentEmployee.id),
			ne(approvalRequest.requestedBy, currentEmployee.id),
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
					where: and(
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
						inArray(absenceEntry.id, absenceIds),
					),
					with: { category: true },
				})
			: Promise.resolve([]),
		timeCorrectionIds.length > 0
			? db.query.workPeriod.findMany({
					where: and(
						eq(workPeriod.organizationId, currentEmployee.organizationId),
						inArray(workPeriod.id, timeCorrectionIds),
					),
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
	const originalEntryIds = (periods as WorkPeriodLookupRecord[]).flatMap((period) =>
		[period.clockIn?.id, period.clockOut?.id].filter((id): id is string => Boolean(id)),
	);
	const correctionEntries =
		originalEntryIds.length > 0
			? ((await db.query.timeEntry.findMany({
					where: and(
						eq(timeEntry.organizationId, currentEmployee.organizationId),
						eq(timeEntry.type, "correction"),
						inArray(timeEntry.replacesEntryId, originalEntryIds),
					),
				})) as CorrectionEntryForReview[])
			: [];
	const correctionEntriesByReplacedId = new Map<string, CorrectionEntryForReview[]>();
	for (const entry of correctionEntries) {
		if (!entry.replacesEntryId) continue;
		const entries = correctionEntriesByReplacedId.get(entry.replacesEntryId) ?? [];
		entries.push(entry);
		correctionEntriesByReplacedId.set(entry.replacesEntryId, entries);
	}
	for (const period of periods as WorkPeriodLookupRecord[]) {
		period.correctionReviewEntries = [
			...(correctionEntriesByReplacedId.get(period.clockIn.id) ?? []),
			...(period.clockOut?.id ? (correctionEntriesByReplacedId.get(period.clockOut.id) ?? []) : []),
		];
	}

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
				eq(approvalRequest.organizationId, currentEmployee.organizationId),
				eq(approvalRequest.approverId, currentEmployee.id),
				ne(approvalRequest.requestedBy, currentEmployee.id),
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
