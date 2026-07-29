import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { getCurrentEmployee } from "@/app/[locale]/(app)/absences/actions";
import { db } from "@/db";
import {
	absenceEntry,
	approvalRequest,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import type { SickDetail } from "@/lib/absences/types";
import { classifyTimeRequest } from "@/lib/approvals/time-request-metadata";
import type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "./types";

interface PendingRequestRecord {
	id: string;
	entityId: string;
	entityType: "absence_entry" | "time_entry";
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	metadata?: unknown;
	reason?: string | null;
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
	pendingChanges?: unknown;
	clockIn: {
		id: string;
		timestamp: Date;
		utcOffsetMinutes: number;
	};
	clockOut: {
		id: string;
		timestamp: Date;
		utcOffsetMinutes: number;
	} | null;
	correctionReviewEntries?: CorrectionEntryForReview[];
}

type WorkPeriodRow = Omit<WorkPeriodLookupRecord, "clockIn" | "clockOut"> & {
	employeeId: string;
	clockInId: string;
	clockOutId: string | null;
};

type OriginalEntryForReview = WorkPeriodLookupRecord["clockIn"] & {
	employeeId: string;
};

interface CorrectionEntryForReview {
	id: string;
	timestamp: Date;
	replacesEntryId: string | null;
	isSuperseded?: boolean;
	utcOffsetMinutes: number;
}

function requesterDto(requester: PendingRequestRecord["requester"]) {
	return {
		user: {
			id: requester.user.id,
			name: requester.user.name,
			email: requester.user.email,
			image: requester.user.image,
		},
	};
}

function timeEntryDto(entry: { timestamp: Date; utcOffsetMinutes: number }) {
	return {
		timestamp: entry.timestamp,
		utcOffsetMinutes: entry.utcOffsetMinutes,
	};
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

function classifyRequestForPeriod(
	request: PendingRequestRecord,
	period: WorkPeriodLookupRecord,
) {
	return classifyTimeRequest({
		metadata: request.metadata,
		reason: request.reason,
		pendingChanges: period.pendingChanges,
		clockInId: period.clockIn.id,
		clockOutId: period.clockOut?.id ?? null,
		correctionEntries: period.correctionReviewEntries ?? [],
	});
}

function isOrphanedTimeCorrectionApproval(
	request: PendingRequestRecord,
	period: WorkPeriodLookupRecord,
): boolean {
	const metadata = classifyRequestForPeriod(request, period);
	const explicitMetadata = metadata.kind === "correction" ? metadata : null;
	const correctionEntries = period.correctionReviewEntries ?? [];
	const correctionById = new Map(
		correctionEntries.map((entry) => [entry.id, entry]),
	);
	const legacyCorrectionEntries = correctionEntries.filter(
		(entry) => !entry.isSuperseded,
	);
	const clockInCandidates = legacyCorrectionEntries.filter(
		(entry) => entry.replacesEntryId === period.clockIn.id,
	);
	const clockOutCandidates = period.clockOut
		? legacyCorrectionEntries.filter(
				(entry) => entry.replacesEntryId === period.clockOut?.id,
			)
		: [];
	const clockInCorrection = explicitMetadata?.clockInCorrectionId
		? correctionById.get(explicitMetadata.clockInCorrectionId)
		: metadata.kind === "legacy" && clockInCandidates.length === 1
			? clockInCandidates[0]
			: undefined;
	const clockOutCorrection = explicitMetadata?.clockOutCorrectionId
		? correctionById.get(explicitMetadata.clockOutCorrectionId)
		: metadata.kind === "legacy" && clockOutCandidates.length === 1
			? clockOutCandidates[0]
			: undefined;
	const matchingClockInCorrection =
		clockInCorrection?.replacesEntryId === period.clockIn.id
			? clockInCorrection
			: null;
	const matchingClockOutCorrection =
		clockOutCorrection?.replacesEntryId === period.clockOut?.id
			? clockOutCorrection
			: null;
	const hasMetadataCorrectionIds =
		metadata.kind !== "legacy" && metadata.kind !== "unclassified";

	if (metadata.kind === "ordinary") return false;

	return hasMetadataCorrectionIds
		? metadata.kind === "invalid" ||
				Boolean(
					explicitMetadata?.clockInCorrectionId && !matchingClockInCorrection,
				) ||
				Boolean(
					explicitMetadata?.clockOutCorrectionId && !matchingClockOutCorrection,
				)
		: !matchingClockInCorrection ||
				clockInCandidates.length > 1 ||
				clockOutCandidates.length > 1;
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
				id: request.id,
				entityId: request.entityId,
				entityType: "absence_entry",
				status: request.status,
				createdAt: request.createdAt,
				requester: requesterDto(request.requester),
				absence: {
					id: absence.id,
					startDate: absence.startDate,
					startPeriod: absence.startPeriod,
					endDate: absence.endDate,
					endPeriod: absence.endPeriod,
					notes: absence.notes,
					sickDetail:
						absence.category.type === "sick" ? absence.sickDetail : null,
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
			id: request.id,
			entityId: request.entityId,
			entityType: "time_entry",
			status: request.status,
			createdAt: request.createdAt,
			requester: requesterDto(request.requester),
			workPeriod: {
				id: period.id,
				startTime: period.startTime,
				endTime: period.endTime,
				clockInEntry: timeEntryDto(period.clockIn),
				clockOutEntry: period.clockOut ? timeEntryDto(period.clockOut) : null,
				clockInCorrectionEntry: (() => {
					const entry = findCorrectionEntry(request, period, period.clockIn.id);
					return entry ? timeEntryDto(entry) : null;
				})(),
				clockOutCorrectionEntry: period.clockOut
					? (() => {
							const entry = findCorrectionEntry(
								request,
								period,
								period.clockOut.id,
							);
							return entry ? timeEntryDto(entry) : null;
						})()
					: null,
			},
		});
	}

	return { absenceApprovals, timeCorrectionApprovals };
}

function findCorrectionEntry(
	request: PendingRequestRecord,
	period: WorkPeriodLookupRecord,
	replacesEntryId: string,
): CorrectionEntryForReview | null {
	const metadata = classifyRequestForPeriod(request, period);
	const correctionId =
		replacesEntryId === period.clockIn.id
			? metadata.kind === "correction"
				? metadata.clockInCorrectionId
				: undefined
			: metadata.kind === "correction"
				? metadata.clockOutCorrectionId
				: undefined;
	const entries = (period.correctionReviewEntries ?? []).filter(
		(entry) => entry.replacesEntryId === replacesEntryId,
	);
	return correctionId
		? (entries.find((entry) => entry.id === correctionId) ?? null)
		: metadata.kind === "legacy" &&
				entries.filter((entry) => !entry.isSuperseded).length === 1
			? entries.filter((entry) => !entry.isSuperseded)[0]
			: null;
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
				columns: { id: true },
				with: {
					user: {
						columns: { id: true, name: true, email: true, image: true },
					},
				},
			},
		},
		columns: {
			id: true,
			entityId: true,
			entityType: true,
			status: true,
			createdAt: true,
			metadata: true,
			reason: true,
		},
		orderBy: [desc(approvalRequest.createdAt)],
	})) as PendingRequestRecord[];

	const { absenceIds, timeCorrectionIds } =
		splitPendingApprovalIds(pendingRequests);

	const [absences, periods] = await Promise.all([
		absenceIds.length > 0
			? db.query.absenceEntry.findMany({
					where: and(
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
						inArray(absenceEntry.id, absenceIds),
					),
					columns: {
						id: true,
						startDate: true,
						startPeriod: true,
						endDate: true,
						endPeriod: true,
						notes: true,
						sickDetail: true,
					},
					with: {
						category: { columns: { name: true, type: true, color: true } },
					},
				})
			: Promise.resolve([]),
		timeCorrectionIds.length > 0
			? db.query.workPeriod.findMany({
					where: and(
						eq(workPeriod.organizationId, currentEmployee.organizationId),
						inArray(workPeriod.id, timeCorrectionIds),
					),
					columns: {
						id: true,
						startTime: true,
						endTime: true,
						pendingChanges: true,
						employeeId: true,
						clockInId: true,
						clockOutId: true,
					},
				})
			: Promise.resolve([]),
	]);

	const absencesById = new Map(
		(absences as AbsenceLookupRecord[]).map(
			(absence) => [absence.id, absence] as const,
		),
	);
	const periodRows = periods as WorkPeriodRow[];
	const originalEntryIds = periodRows.flatMap((period) =>
		[period.clockInId, period.clockOutId].filter((id): id is string =>
			Boolean(id),
		),
	);
	const employeeIds = [
		...new Set(periodRows.map((period) => period.employeeId)),
	];
	const originalEntries =
		originalEntryIds.length > 0
			? ((await db.query.timeEntry.findMany({
					where: and(
						inArray(timeEntry.id, originalEntryIds),
						inArray(timeEntry.employeeId, employeeIds),
						eq(timeEntry.organizationId, currentEmployee.organizationId),
					),
					columns: {
						id: true,
						timestamp: true,
						utcOffsetMinutes: true,
						employeeId: true,
					},
				})) as OriginalEntryForReview[])
			: [];
	const originalEntriesById = new Map(
		originalEntries.map((entry) => [entry.id, entry]),
	);
	const hydratedPeriods: WorkPeriodLookupRecord[] = [];
	for (const period of periodRows) {
		const clockIn = originalEntriesById.get(period.clockInId);
		const clockOut = period.clockOutId
			? originalEntriesById.get(period.clockOutId)
			: null;
		if (!clockIn || clockIn.employeeId !== period.employeeId) continue;
		if (
			period.clockOutId &&
			(!clockOut || clockOut.employeeId !== period.employeeId)
		)
			continue;
		hydratedPeriods.push({ ...period, clockIn, clockOut: clockOut ?? null });
	}
	const periodsById = new Map(
		hydratedPeriods.map((period) => [period.id, period] as const),
	);
	const correctionPeriodIds = new Set(
		pendingRequests.flatMap((request) => {
			if (request.entityType !== "time_entry") return [];
			const period = periodsById.get(request.entityId);
			if (!period) return [];
			const classification = classifyRequestForPeriod(request, period);
			return classification.kind !== "ordinary" &&
				classification.kind !== "invalid"
				? [request.entityId]
				: [];
		}),
	);
	const correctionOriginalEntryIds = hydratedPeriods.flatMap((period) =>
		correctionPeriodIds.has(period.id)
			? [period.clockIn.id, period.clockOut?.id].filter((id): id is string =>
					Boolean(id),
				)
			: [],
	);
	const correctionEntries =
		correctionOriginalEntryIds.length > 0
			? ((await db.query.timeEntry.findMany({
					where: and(
						eq(timeEntry.organizationId, currentEmployee.organizationId),
						eq(timeEntry.type, "correction"),
						inArray(timeEntry.replacesEntryId, correctionOriginalEntryIds),
					),
					columns: {
						id: true,
						timestamp: true,
						utcOffsetMinutes: true,
						replacesEntryId: true,
						isSuperseded: true,
					},
				})) as CorrectionEntryForReview[])
			: [];
	const correctionEntriesByReplacedId = new Map<
		string,
		CorrectionEntryForReview[]
	>();
	for (const entry of correctionEntries) {
		if (!entry.replacesEntryId) continue;
		const entries =
			correctionEntriesByReplacedId.get(entry.replacesEntryId) ?? [];
		entries.push(entry);
		correctionEntriesByReplacedId.set(entry.replacesEntryId, entries);
	}
	for (const period of hydratedPeriods) {
		period.correctionReviewEntries = [
			...(correctionEntriesByReplacedId.get(period.clockIn.id) ?? []),
			...(period.clockOut?.id
				? (correctionEntriesByReplacedId.get(period.clockOut.id) ?? [])
				: []),
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
		absences:
			Number(counts.find((entry) => entry.type === "absence_entry")?.count) ||
			0,
		timeCorrections:
			Number(counts.find((entry) => entry.type === "time_entry")?.count) || 0,
	};
}

export { getCurrentEmployee };
