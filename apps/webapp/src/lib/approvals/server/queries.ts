import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { getCurrentEmployee } from "@/app/[locale]/(app)/absences/actions";
import { db } from "@/db";
import {
	absenceEntry,
	approvalRequest,
	timeEntry,
	workCategory,
	workPeriod,
} from "@/db/schema";
import type { SickDetail } from "@/lib/absences/types";
import { classifyTimeApprovalRequest } from "@/lib/approvals/time-request-kind";
import {
	categoryIdsFromTimeCorrectionMetadata,
	categoryNamesForOrganization,
	parseTimeCorrectionReviewMetadata,
	timeCorrectionMetadataChanges,
} from "./time-correction-review-metadata";
import type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "./types";

interface PendingRequestRecord {
	id: string;
	entityId: string;
	entityType: "absence_entry" | "time_entry";
	status: "pending" | "approved" | "rejected";
	reason?: string | null;
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
		utcOffsetMinutes: number;
	};
	clockOut: {
		id: string;
		timestamp: Date;
		utcOffsetMinutes: number;
	} | null;
	correctionReviewEntries?: CorrectionEntryForReview[];
}

interface CorrectionEntryForReview {
	id: string;
	timestamp: Date;
	replacesEntryId: string | null;
	isSuperseded?: boolean;
	utcOffsetMinutes: number;
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

function correctionMetadataFromRequest(request: { metadata?: unknown }) {
	const metadata = parseTimeCorrectionReviewMetadata(request.metadata);
	return metadata.kind === "valid_current" || metadata.kind === "valid_legacy"
		? metadata.requested
		: undefined;
}

function metadataChangesFromRequest(
	request: PendingRequestRecord,
	categoryNamesById: Map<string, string>,
) {
	return timeCorrectionMetadataChanges(
		parseTimeCorrectionReviewMetadata(request.metadata),
		categoryNamesById,
	);
}

function isOrphanedTimeCorrectionApproval(
	request: PendingRequestRecord,
	period: WorkPeriodLookupRecord,
): boolean {
	const metadata = correctionMetadataFromRequest(request);
	const workMetadata = parseTimeCorrectionReviewMetadata(request.metadata);
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
	const clockInCorrection = metadata?.clockInCorrectionId
		? correctionById.get(metadata.clockInCorrectionId)
		: workMetadata.kind === "legacy_absent" && clockInCandidates.length === 1
			? clockInCandidates[0]
			: undefined;
	const clockOutCorrection = metadata?.clockOutCorrectionId
		? correctionById.get(metadata.clockOutCorrectionId)
		: workMetadata.kind === "legacy_absent" && clockOutCandidates.length === 1
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
	const hasMetadataCorrectionIds = Boolean(
		metadata?.clockInCorrectionId || metadata?.clockOutCorrectionId,
	);
	if (workMetadata.kind === "malformed") return true;

	return hasMetadataCorrectionIds
		? Boolean(metadata?.clockInCorrectionId && !matchingClockInCorrection) ||
				Boolean(metadata?.clockOutCorrectionId && !matchingClockOutCorrection)
		: workMetadata.kind === "legacy_absent" &&
				(!matchingClockInCorrection ||
					clockInCandidates.length > 1 ||
					clockOutCandidates.length > 1);
}

export function buildPendingApprovalResult({
	pendingRequests,
	absencesById,
	periodsById,
	categoryNamesById = new Map<string, string>(),
}: {
	pendingRequests: PendingRequestRecord[];
	absencesById: Map<string, AbsenceLookupRecord>;
	periodsById: Map<string, WorkPeriodLookupRecord>;
	categoryNamesById?: Map<string, string>;
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
		const workflowKind = classifyTimeApprovalRequest({
			metadata: request.metadata,
			reason: request.reason,
		});
		if (
			workflowKind !== "manual_time_submission" &&
			workflowKind !== "policy_clock_out" &&
			isOrphanedTimeCorrectionApproval(request, period)
		) {
			continue;
		}

		const metadataChanges = metadataChangesFromRequest(
			request,
			categoryNamesById,
		);
		timeCorrectionApprovals.push({
			...request,
			reason: request.reason ?? null,
			entityType: "time_entry",
			workPeriod: {
				id: period.id,
				startTime: period.startTime,
				endTime: period.endTime,
				clockInEntry: period.clockIn,
				clockOutEntry: period.clockOut ?? null,
				clockInCorrectionEntry: findCorrectionEntry(
					request,
					period,
					period.clockIn.id,
				),
				clockOutCorrectionEntry: period.clockOut
					? findCorrectionEntry(request, period, period.clockOut.id)
					: null,
				...(metadataChanges ? { metadataChanges } : {}),
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
	const correctionId =
		replacesEntryId === period.clockIn.id
			? correctionMetadataFromRequest(request)?.clockInCorrectionId
			: correctionMetadataFromRequest(request)?.clockOutCorrectionId;
	const entries = (period.correctionReviewEntries ?? []).filter(
		(entry) => !entry.isSuperseded && entry.replacesEntryId === replacesEntryId,
	);
	return correctionId
		? (entries.find((entry) => entry.id === correctionId) ?? null)
		: entries.length === 1
			? entries[0]
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
				with: { user: true },
			},
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
		(absences as AbsenceLookupRecord[]).map(
			(absence) => [absence.id, absence] as const,
		),
	);
	const periodsById = new Map(
		(periods as WorkPeriodLookupRecord[]).map(
			(period) => [period.id, period] as const,
		),
	);
	const originalEntryIds = (periods as WorkPeriodLookupRecord[]).flatMap(
		(period) =>
			[period.clockIn?.id, period.clockOut?.id].filter((id): id is string =>
				Boolean(id),
			),
	);
	const categoryIds = categoryIdsFromTimeCorrectionMetadata(pendingRequests);
	const [correctionEntriesResult, categories] = await Promise.all([
		originalEntryIds.length > 0
			? db.query.timeEntry.findMany({
					where: and(
						eq(timeEntry.organizationId, currentEmployee.organizationId),
						eq(timeEntry.type, "correction"),
						inArray(timeEntry.replacesEntryId, originalEntryIds),
					),
				})
			: Promise.resolve([]),
		categoryIds.length > 0
			? db.query.workCategory.findMany({
					where: and(
						eq(workCategory.organizationId, currentEmployee.organizationId),
						inArray(workCategory.id, categoryIds),
					),
					columns: { id: true, organizationId: true, name: true },
				})
			: Promise.resolve([]),
	]);
	const correctionEntries =
		correctionEntriesResult as CorrectionEntryForReview[];
	const categoryNamesById = categoryNamesForOrganization(
		categories,
		currentEmployee.organizationId,
	);
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
	for (const period of periods as WorkPeriodLookupRecord[]) {
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
		categoryNamesById,
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
