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

type PendingChangesEvidence =
	| { state: "absent" }
	| { state: "valid"; value: JsonObject }
	| { state: "invalid" };

function pendingChangesEvidence(value: unknown): PendingChangesEvidence {
	if (value === null || value === undefined) return { state: "absent" };
	const object = asObject(value);
	if (object) return { state: "valid", value: object };
	if (typeof value !== "string") return { state: "invalid" };

	try {
		const parsed = asObject(JSON.parse(value));
		return parsed ? { state: "valid", value: parsed } : { state: "invalid" };
	} catch {
		return { state: "invalid" };
	}
}

function strictBooleanMarker(
	value: JsonObject | null,
	key: "isManualEntry" | "isNewClockOut",
): boolean | "invalid" {
	if (!value) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return key in value ? "invalid" : false;
	if (
		!descriptor.enumerable ||
		!("value" in descriptor) ||
		typeof descriptor.value !== "boolean"
	) {
		return "invalid";
	}
	return descriptor.value;
}

type TimeRequestMarker =
	| { state: "absent" }
	| {
			state: "valid";
			kind: "manual_time_submission" | "policy_clock_out";
	  }
	| { state: "invalid" };

function strictTimeRequestMarker(
	metadata: JsonObject | null,
): TimeRequestMarker {
	if (!metadata) return { state: "absent" };
	const descriptor = Object.getOwnPropertyDescriptor(metadata, "timeRequest");
	if (!descriptor) {
		return "timeRequest" in metadata
			? { state: "invalid" }
			: { state: "absent" };
	}
	if (!descriptor.enumerable || !("value" in descriptor)) {
		return { state: "invalid" };
	}
	const marker = asObject(descriptor.value);
	if (!marker || Object.keys(marker).length !== 1) {
		return { state: "invalid" };
	}
	const kindDescriptor = Object.getOwnPropertyDescriptor(marker, "kind");
	if (
		!kindDescriptor?.enumerable ||
		!("value" in kindDescriptor) ||
		(kindDescriptor.value !== "manual_time_submission" &&
			kindDescriptor.value !== "policy_clock_out")
	) {
		return { state: "invalid" };
	}
	return { state: "valid", kind: kindDescriptor.value };
}

export function classifyTimeApprovalRequest(
	input: TimeApprovalClassificationInput,
): TimeApprovalKind {
	const metadata = asObject(input.metadata);
	const timeRequest = strictTimeRequestMarker(metadata);
	if (timeRequest.state === "invalid") return "unclassified";
	const explicitKind =
		timeRequest.state === "valid" ? timeRequest.kind : undefined;
	const pendingEvidence = pendingChangesEvidence(input.pendingChanges);
	if (pendingEvidence.state === "invalid") return "unclassified";
	const pendingChanges =
		pendingEvidence.state === "valid" ? pendingEvidence.value : null;
	const hasManualMarker = strictBooleanMarker(pendingChanges, "isManualEntry");
	const hasClockOutMarker = strictBooleanMarker(
		pendingChanges,
		"isNewClockOut",
	);
	if (hasManualMarker === "invalid" || hasClockOutMarker === "invalid") {
		return "unclassified";
	}
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

	if (
		(hasManualMarker && hasClockOutMarker) ||
		(hasManualMarker && hasClockOutReason) ||
		(hasClockOutMarker && hasManualReason)
	) {
		return "unclassified";
	}
	if (hasManualMarker) return "manual_time_submission";
	if (hasClockOutMarker) return "policy_clock_out";
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
