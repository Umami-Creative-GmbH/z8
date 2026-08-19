import { isWorkLocationType } from "@/lib/time-tracking/work-location";

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
	verifiedRelationalCorrectionIds?: readonly string[];
	verifiedRelationalCorrectionIdsByEndpoint?: {
		clockIn: readonly string[];
		clockOut: readonly string[];
	};
}

type Parsed<T> =
	| { state: "absent" }
	| { state: "valid"; value: T }
	| { state: "invalid" };

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown): JsonObject | null {
	try {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			return null;
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;
		return value as JsonObject;
	} catch {
		return null;
	}
}

function metadataObject(value: unknown): Parsed<JsonObject> {
	if (value === null || value === undefined) return { state: "absent" };
	const parsed = object(value);
	return parsed ? { state: "valid", value: parsed } : { state: "invalid" };
}

function ownDataProperty(value: JsonObject, key: string): Parsed<unknown> {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor)
			return key in value ? { state: "invalid" } : { state: "absent" };
		return descriptor.enumerable && "value" in descriptor
			? { state: "valid", value: descriptor.value }
			: { state: "invalid" };
	} catch {
		return { state: "invalid" };
	}
}

function exactDataObject(
	value: unknown,
	allowedKeys: readonly string[],
): JsonObject | null {
	try {
		const parsed = object(value);
		if (!parsed) return null;
		const descriptors = Object.getOwnPropertyDescriptors(parsed);
		const keys = Reflect.ownKeys(descriptors);
		const allowedKeySet = new Set(allowedKeys);
		const snapshot: JsonObject = {};
		for (const key of keys) {
			if (typeof key !== "string" || !allowedKeySet.has(key)) return null;
			const descriptor = descriptors[key];
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			snapshot[key] = descriptor.value;
		}
		return snapshot;
	} catch {
		return null;
	}
}

type OrdinaryKind = "manual_time_submission" | "policy_clock_out";

function timeRequestMarker(metadata: JsonObject | null): Parsed<OrdinaryKind> {
	if (!metadata) return { state: "absent" };
	const property = ownDataProperty(metadata, "timeRequest");
	if (property.state !== "valid") return property;
	const marker = exactDataObject(property.value, ["kind"]);
	if (!marker || Reflect.ownKeys(marker).length !== 1)
		return { state: "invalid" };
	const kind = marker.kind;
	return kind === "manual_time_submission" || kind === "policy_clock_out"
		? { state: "valid", value: kind }
		: { state: "invalid" };
}

function timeCorrectionMarker(metadata: JsonObject | null): Parsed<{
	ids: readonly string[];
	clockInCorrectionId?: string;
	clockOutCorrectionId?: string;
}> {
	if (!metadata) return { state: "absent" };
	const property = ownDataProperty(metadata, "timeCorrection");
	if (property.state !== "valid") return property;
	const marker = exactDataObject(property.value, [
		"action",
		"workLocationType",
		"workCategoryId",
		"clockInCorrectionId",
		"clockOutCorrectionId",
	]);
	const hasWorkLocation = marker && Object.hasOwn(marker, "workLocationType");
	const hasWorkCategory = marker && Object.hasOwn(marker, "workCategoryId");
	const hasWorkMetadata = hasWorkLocation && hasWorkCategory;
	if (
		!marker ||
		!Object.hasOwn(marker, "action") ||
		hasWorkLocation !== hasWorkCategory ||
		(marker.action !== "edit" && marker.action !== "delete") ||
		(hasWorkMetadata &&
			(typeof marker.workLocationType !== "string" ||
				!isWorkLocationType(marker.workLocationType))) ||
		(hasWorkMetadata &&
			marker.workCategoryId !== null &&
			(typeof marker.workCategoryId !== "string" ||
				!UUID.test(marker.workCategoryId)))
	) {
		return { state: "invalid" };
	}
	const ids = ["clockInCorrectionId", "clockOutCorrectionId"].flatMap((key) => {
		const property = ownDataProperty(marker, key);
		if (property.state === "absent") return [];
		return property.state === "valid" &&
			typeof property.value === "string" &&
			UUID.test(property.value)
			? [property.value]
			: [null];
	});
	if (
		ids.includes(null) ||
		(!hasWorkMetadata && ids.length === 0) ||
		(marker.action === "delete" && ids.length !== 2) ||
		(ids.length === 2 && ids[0] === ids[1])
	) {
		return { state: "invalid" };
	}
	return {
		state: "valid",
		value: {
			ids: ids as string[],
			...(typeof marker.clockInCorrectionId === "string"
				? { clockInCorrectionId: marker.clockInCorrectionId }
				: {}),
			...(typeof marker.clockOutCorrectionId === "string"
				? { clockOutCorrectionId: marker.clockOutCorrectionId }
				: {}),
		},
	};
}

function pendingChangesObject(value: unknown): Parsed<JsonObject> {
	if (value === null || value === undefined) return { state: "absent" };
	const parsed = object(value);
	if (parsed) return { state: "valid", value: parsed };
	if (typeof value !== "string") return { state: "invalid" };
	try {
		const decoded = object(JSON.parse(value));
		return decoded ? { state: "valid", value: decoded } : { state: "invalid" };
	} catch {
		return { state: "invalid" };
	}
}

function booleanMarker(
	value: JsonObject | null,
	key: string,
): boolean | "invalid" {
	if (!value) return false;
	const property = ownDataProperty(value, key);
	if (property.state === "absent") return false;
	return property.state === "valid" && typeof property.value === "boolean"
		? property.value
		: "invalid";
}

export function hasAttemptedOrdinaryTimeApprovalEvidence(
	input: Pick<
		TimeApprovalClassificationInput,
		"metadata" | "pendingChanges" | "reason"
	>,
): boolean {
	const metadata = metadataObject(input.metadata);
	if (metadata.state === "valid") {
		if (ownDataProperty(metadata.value, "timeRequest").state !== "absent") {
			return true;
		}
	}

	const pending = pendingChangesObject(input.pendingChanges);
	if (pending.state === "valid") {
		if (
			ownDataProperty(pending.value, "isManualEntry").state !== "absent" ||
			ownDataProperty(pending.value, "isNewClockOut").state !== "absent"
		) {
			return true;
		}
	}

	return (
		input.reason?.startsWith("Manual time entry:") === true ||
		input.reason === POLICY_CLOCK_OUT_APPROVAL_REASON
	);
}

export function classifyTimeApprovalRequest(
	input: TimeApprovalClassificationInput,
): TimeApprovalKind {
	const metadata = metadataObject(input.metadata);
	if (metadata.state === "invalid") return "unclassified";
	const metadataValue = metadata.state === "valid" ? metadata.value : null;
	const ordinary = timeRequestMarker(metadataValue);
	const correction = timeCorrectionMarker(metadataValue);
	if (ordinary.state === "invalid" || correction.state === "invalid") {
		return "unclassified";
	}
	if (ordinary.state === "valid" && correction.state === "valid") {
		return "unclassified";
	}
	if (correction.state === "valid") {
		if (correction.value.ids.length === 0) return "time_correction";
		const verified = new Set(input.verifiedRelationalCorrectionIds ?? []);
		const endpoints = input.verifiedRelationalCorrectionIdsByEndpoint;
		if (
			!endpoints ||
			!correction.value.ids.every((id) => verified.has(id)) ||
			(correction.value.clockInCorrectionId !== undefined &&
				!endpoints.clockIn.includes(correction.value.clockInCorrectionId)) ||
			(correction.value.clockOutCorrectionId !== undefined &&
				!endpoints.clockOut.includes(correction.value.clockOutCorrectionId))
		) {
			return "unclassified";
		}
		return "time_correction";
	}

	const pending = pendingChangesObject(input.pendingChanges);
	if (pending.state === "invalid") return "unclassified";
	const pendingValue = pending.state === "valid" ? pending.value : null;
	const manualMarker = booleanMarker(pendingValue, "isManualEntry");
	const clockOutMarker = booleanMarker(pendingValue, "isNewClockOut");
	if (manualMarker === "invalid" || clockOutMarker === "invalid") {
		return "unclassified";
	}
	const manualReason = input.reason?.startsWith("Manual time entry:") === true;
	const clockOutReason = input.reason === POLICY_CLOCK_OUT_APPROVAL_REASON;

	if (ordinary.state === "valid") {
		const oppositeMarker =
			ordinary.value === "manual_time_submission"
				? clockOutMarker
				: manualMarker;
		const oppositeReason =
			ordinary.value === "manual_time_submission"
				? clockOutReason
				: manualReason;
		return (manualMarker && clockOutMarker) || oppositeMarker || oppositeReason
			? "unclassified"
			: ordinary.value;
	}

	if (manualMarker && clockOutMarker) return "unclassified";
	if (manualMarker) return "manual_time_submission";
	if (clockOutMarker) return "policy_clock_out";
	if (manualReason) return "manual_time_submission";
	if (clockOutReason) return "policy_clock_out";
	return (input.verifiedRelationalCorrectionIds?.length ?? 0) > 0
		? "time_correction"
		: "unclassified";
}
