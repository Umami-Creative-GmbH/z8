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
	if (asObject(metadata?.timeCorrection)) {
		return "time_correction";
	}

	const explicitKind = asObject(metadata?.timeRequest)?.kind;
	if (
		explicitKind === "manual_time_submission" ||
		explicitKind === "policy_clock_out"
	) {
		return explicitKind;
	}

	const pendingChanges = pendingChangesObject(input.pendingChanges);
	const hasManualMarker = pendingChanges?.isManualEntry === true;
	const hasClockOutMarker = pendingChanges?.isNewClockOut === true;
	if (hasManualMarker && hasClockOutMarker) return "unclassified";
	if (hasManualMarker) return "manual_time_submission";
	if (hasClockOutMarker) return "policy_clock_out";
	if (input.reason?.startsWith("Manual time entry:") && !hasClockOutMarker) {
		return "manual_time_submission";
	}
	if (input.reason === POLICY_CLOCK_OUT_APPROVAL_REASON && !hasManualMarker) {
		return "policy_clock_out";
	}

	if (input.hasRelationalCorrectionEvidence) {
		return "time_correction";
	}

	return "unclassified";
}
