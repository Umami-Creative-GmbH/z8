export type TimeApprovalKind =
	| "time_correction"
	| "manual_time_submission"
	| "policy_clock_out"
	| "unclassified";

export const POLICY_CLOCK_OUT_APPROVAL_REASON =
	"Clock-out requires approval (0-day policy)";

type JsonObject = Record<string, unknown>;

export interface TimeApprovalClassificationInput {
	metadata?: unknown;
	reason?: string | null;
	pendingChanges?: unknown;
	hasRelationalCorrectionEvidence?: boolean;
}

function asObject(value: unknown): JsonObject | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

function pendingChangesObject(value: unknown): JsonObject | null {
	const object = asObject(value);
	if (object) return object;
	if (typeof value !== "string") return null;

	try {
		return asObject(JSON.parse(value));
	} catch {
		return null;
	}
}

export function classifyTimeApprovalRequest(
	input: TimeApprovalClassificationInput,
): TimeApprovalKind {
	const metadata = asObject(input.metadata);
	const explicitKind = asObject(metadata?.timeRequest)?.kind;
	const pendingChanges = pendingChangesObject(input.pendingChanges);
	const hasManualMarker = pendingChanges?.isManualEntry === true;
	const hasClockOutMarker = pendingChanges?.isNewClockOut === true;
	const hasManualReason =
		input.reason?.startsWith("Manual time entry:") === true;
	const hasClockOutReason = input.reason === POLICY_CLOCK_OUT_APPROVAL_REASON;
	const hasOrdinaryExplicitKind =
		explicitKind === "manual_time_submission" ||
		explicitKind === "policy_clock_out";

	if (asObject(metadata?.timeCorrection)) {
		return hasOrdinaryExplicitKind ||
			hasManualMarker ||
			hasClockOutMarker ||
			hasManualReason ||
			hasClockOutReason
			? "unclassified"
			: "time_correction";
	}

	if (hasOrdinaryExplicitKind) {
		const hasOppositeMarker =
			explicitKind === "manual_time_submission"
				? hasClockOutMarker
				: hasManualMarker;
		const hasOppositeReason =
			explicitKind === "manual_time_submission"
				? hasClockOutReason
				: hasManualReason;
		if (
			(hasManualMarker && hasClockOutMarker) ||
			hasOppositeMarker ||
			hasOppositeReason
		) {
			return "unclassified";
		}
		return explicitKind;
	}

	if (hasManualMarker && hasClockOutMarker) return "unclassified";
	if (hasManualMarker) {
		return hasClockOutReason ? "unclassified" : "manual_time_submission";
	}
	if (hasClockOutMarker) {
		return hasManualReason ? "unclassified" : "policy_clock_out";
	}
	if (hasManualReason) {
		return "manual_time_submission";
	}
	if (hasClockOutReason) {
		return "policy_clock_out";
	}

	if (input.hasRelationalCorrectionEvidence) {
		return "time_correction";
	}

	return "unclassified";
}
