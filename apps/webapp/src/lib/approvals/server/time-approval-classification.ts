import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { timeEntry } from "@/db/schema";
import { normalizeTimeCorrectionWorkflowPayload } from "../domain-adapters/time-correction-contract";
import { classifyTimeApprovalRequest, type TimeApprovalKind } from "../time-request-kind";
import type { ApprovalDbService } from "./types";

/** The pending correction rows a request's own metadata names (#301). */
function namedCorrectionEntryIds(metadata: unknown): string[] {
	try {
		const descriptor =
			typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
				? Object.getOwnPropertyDescriptor(metadata, "timeCorrection")
				: undefined;
		const correction = normalizeTimeCorrectionWorkflowPayload({
			timeCorrection:
				descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined,
		}).timeCorrection;
		return [correction.clockInCorrectionId, correction.clockOutCorrectionId].filter(
			(id): id is string => Boolean(id),
		);
	} catch {
		return [];
	}
}

/**
 * Classifies a persisted legacy time request the way its decision owner does
 * (#301, #439): its metadata, reason and the work period's pending changes
 * first; otherwise the correction rows that replace the period's endpoints,
 * or the inactive pending corrections the request names, verify a time
 * correction. Nothing else is guessed.
 */
export async function classifyPersistedTimeApprovalRequest(
	database: ApprovalDbService["db"],
	input: {
		organizationId: string;
		request: { metadata: unknown; reason: string | null; requestedBy: string };
		period: { clockInId: string | null; clockOutId: string | null; pendingChanges: unknown };
	},
): Promise<TimeApprovalKind> {
	const { request, period } = input;
	const kind = classifyTimeApprovalRequest({
		metadata: request.metadata,
		reason: request.reason,
		pendingChanges: period.pendingChanges,
	});
	if (kind !== "unclassified") return kind;
	const endpointIds = [period.clockInId, period.clockOutId].filter((id): id is string =>
		Boolean(id),
	);
	// A pending correction's own rows are inactive (superseded without a
	// successor) until approval; the request names them exactly (#301).
	const namedPendingIds = namedCorrectionEntryIds(request.metadata);
	const correctionEvidence = endpointIds.length
		? await database.query.timeEntry.findMany({
				where: and(
					eq(timeEntry.organizationId, input.organizationId),
					eq(timeEntry.employeeId, request.requestedBy),
					eq(timeEntry.type, "correction"),
					or(
						and(
							eq(timeEntry.isSuperseded, false),
							or(
								inArray(timeEntry.id, endpointIds),
								inArray(timeEntry.replacesEntryId, endpointIds),
							),
						),
						...(namedPendingIds.length > 0
							? [
									and(
										eq(timeEntry.isSuperseded, true),
										isNull(timeEntry.supersededById),
										inArray(timeEntry.id, namedPendingIds),
										inArray(timeEntry.replacesEntryId, endpointIds),
									),
								]
							: []),
					),
				),
			})
		: [];
	return classifyTimeApprovalRequest({
		metadata: request.metadata,
		reason: request.reason,
		pendingChanges: period.pendingChanges,
		verifiedRelationalCorrectionIds: correctionEvidence.map((entry) => entry.id),
		verifiedRelationalCorrectionIdsByEndpoint: {
			clockIn: correctionEvidence.flatMap((entry) =>
				entry.id === period.clockInId || entry.replacesEntryId === period.clockInId
					? [entry.id]
					: [],
			),
			clockOut: correctionEvidence.flatMap((entry) =>
				entry.id === period.clockOutId || entry.replacesEntryId === period.clockOutId
					? [entry.id]
					: [],
			),
		},
	});
}
