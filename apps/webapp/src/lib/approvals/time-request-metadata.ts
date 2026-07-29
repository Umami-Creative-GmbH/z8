export type OrdinaryTimeRequestKind =
	| "manual_time_submission"
	| "policy_clock_out";

export type TimeRequestMetadataClassification =
	| { kind: "legacy" }
	| { kind: "unclassified" }
	| { kind: "invalid" }
	| {
			kind: "ordinary";
			requestKind: OrdinaryTimeRequestKind;
	  }
	| {
			kind: "correction";
			action?: "edit" | "delete";
			clockInCorrectionId?: string;
			clockOutCorrectionId?: string;
	  };

export function classifyTimeRequestMetadata(
	metadata: unknown,
): TimeRequestMetadataClassification {
	if (metadata == null) return { kind: "unclassified" };
	if (typeof metadata !== "object" || Array.isArray(metadata))
		return { kind: "invalid" };

	if ("timeCorrection" in metadata) {
		const correction = metadata.timeCorrection;
		if (
			!correction ||
			typeof correction !== "object" ||
			Array.isArray(correction)
		) {
			return { kind: "invalid" };
		}
		const action = "action" in correction ? correction.action : undefined;
		const clockInCorrectionId =
			"clockInCorrectionId" in correction
				? correction.clockInCorrectionId
				: undefined;
		const clockOutCorrectionId =
			"clockOutCorrectionId" in correction
				? correction.clockOutCorrectionId
				: undefined;
		if (
			(action !== undefined && action !== "edit" && action !== "delete") ||
			(clockInCorrectionId !== undefined &&
				(typeof clockInCorrectionId !== "string" ||
					clockInCorrectionId.trim().length === 0)) ||
			(clockOutCorrectionId !== undefined &&
				(typeof clockOutCorrectionId !== "string" ||
					clockOutCorrectionId.trim().length === 0)) ||
			(!clockInCorrectionId && !clockOutCorrectionId)
		) {
			return { kind: "invalid" };
		}

		return {
			kind: "correction",
			action: action as "edit" | "delete" | undefined,
			clockInCorrectionId: clockInCorrectionId as string | undefined,
			clockOutCorrectionId: clockOutCorrectionId as string | undefined,
		};
	}

	if ("timeRequest" in metadata) {
		const request = metadata.timeRequest;
		if (
			!request ||
			typeof request !== "object" ||
			Array.isArray(request) ||
			!("kind" in request)
		) {
			return { kind: "invalid" };
		}
		if (
			request.kind === "manual_time_submission" ||
			request.kind === "policy_clock_out"
		) {
			return { kind: "ordinary", requestKind: request.kind };
		}
	}

	return { kind: "invalid" };
}

interface HistoricalCorrectionEntry {
	id: string;
	replacesEntryId: string | null;
	isSuperseded?: boolean;
}

interface HistoricalTimeRequestContext {
	metadata: unknown;
	reason?: string | null;
	pendingChanges?: unknown;
	clockInId: string;
	clockOutId: string | null;
	correctionEntries: HistoricalCorrectionEntry[];
}

function isHistoricalPendingChanges(
	value: unknown,
): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const changes = value as Record<string, unknown>;
	return (
		typeof changes.originalStartTime === "string" &&
		typeof changes.originalEndTime === "string" &&
		typeof changes.originalDurationMinutes === "number" &&
		typeof changes.requestedAt === "string" &&
		typeof changes.requestedBy === "string"
	);
}

export function classifyTimeRequest({
	metadata,
	reason,
	pendingChanges,
	clockInId,
	clockOutId,
	correctionEntries,
}: HistoricalTimeRequestContext): TimeRequestMetadataClassification {
	if (metadata != null) return classifyTimeRequestMetadata(metadata);

	if (isHistoricalPendingChanges(pendingChanges)) {
		if (
			pendingChanges.isManualEntry === true &&
			typeof pendingChanges.reason === "string" &&
			reason === `Manual time entry: ${pendingChanges.reason}`
		) {
			return { kind: "ordinary", requestKind: "manual_time_submission" };
		}
		if (
			pendingChanges.isNewClockOut === true &&
			reason === "Clock-out requires approval (0-day policy)"
		) {
			return { kind: "ordinary", requestKind: "policy_clock_out" };
		}
	}

	const activeCorrections = correctionEntries.filter(
		(entry) => !entry.isSuperseded,
	);
	const clockInMatches = activeCorrections.filter(
		(entry) => entry.replacesEntryId === clockInId,
	);
	const clockOutMatches = clockOutId
		? activeCorrections.filter((entry) => entry.replacesEntryId === clockOutId)
		: [];
	if (
		clockInMatches.length <= 1 &&
		clockOutMatches.length <= 1 &&
		clockInMatches.length + clockOutMatches.length > 0
	) {
		return { kind: "legacy" };
	}

	return { kind: "unclassified" };
}
