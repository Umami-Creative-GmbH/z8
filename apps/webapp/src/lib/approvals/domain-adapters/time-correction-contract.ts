import { createHash } from "node:crypto";
import {
	type Instant,
	instantToCanonicalString,
	isInstant,
} from "@/lib/datetime/temporal-core";
import {
	isWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";

const SUBMISSION_NAMESPACE = "z8:time-correction-submission:v2";
const LEGACY_SUBMISSION_NAMESPACE = "z8:time-correction-submission:v1";
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TimeCorrectionAction = "edit" | "delete";
type TimeCorrectionEndpointType = "clock_in" | "clock_out";

type TimeCorrectionEndpointIds = {
	readonly clockInCorrectionId?: string;
	readonly clockOutCorrectionId?: string;
};

export type CurrentTimeCorrectionWorkflowContract =
	TimeCorrectionEndpointIds & {
		readonly action: TimeCorrectionAction;
		readonly workLocationType: WorkLocationType;
		readonly workCategoryId: string | null;
	};

export type LegacyTimeCorrectionWorkflowContract = TimeCorrectionEndpointIds & {
	readonly action: TimeCorrectionAction;
};

export type TimeCorrectionWorkflowPayload = {
	readonly timeCorrection:
		| CurrentTimeCorrectionWorkflowContract
		| LegacyTimeCorrectionWorkflowContract;
};

export type TimeCorrectionOriginalWorkMetadata = Readonly<{
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
}>;

export interface TimeCorrectionSubmissionIdentityInput {
	readonly organizationId: string;
	readonly workPeriodId: string;
	readonly action: TimeCorrectionAction;
	readonly workLocationType: WorkLocationType;
	readonly workCategoryId: string | null;
	readonly clockIn?: {
		readonly originalEntryId: string;
		readonly instant: Instant;
	};
	readonly clockOut?: {
		readonly originalEntryId: string;
		readonly instant: Instant;
	};
}

export type LegacyTimeCorrectionSubmissionIdentityInput = Omit<
	TimeCorrectionSubmissionIdentityInput,
	"workLocationType" | "workCategoryId"
>;

export interface TimeCorrectionEndpointEvidence {
	readonly endpointType: TimeCorrectionEndpointType;
	readonly originalEntryId: string;
	readonly correctionEntryId: string;
	readonly instant: Instant;
	readonly utcOffsetMinutes: number;
	readonly timezone: string;
	readonly timezoneSource: string;
}

export class TimeCorrectionContractError extends Error {
	constructor(message = "Time correction contract is invalid") {
		super(message);
		this.name = "TimeCorrectionContractError";
	}
}

export class TimeCorrectionWorkflowPayloadError extends TimeCorrectionContractError {
	constructor() {
		super("Time correction workflow payload is invalid");
		this.name = "TimeCorrectionWorkflowPayloadError";
	}
}

export class TimeCorrectionOriginalWorkMetadataError extends TimeCorrectionContractError {
	constructor() {
		super("Time correction original work metadata is invalid");
		this.name = "TimeCorrectionOriginalWorkMetadataError";
	}
}

function snapshotStrictObject(
	value: unknown,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[] = [],
): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return null;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	const allowedKeys = [...requiredKeys, ...optionalKeys];
	const allowedKeySet = new Set(allowedKeys);
	if (
		keys.length < requiredKeys.length ||
		keys.length > allowedKeys.length ||
		requiredKeys.some((key) => !Object.hasOwn(descriptors, key))
	) {
		return null;
	}
	const snapshot: Record<string, unknown> = {};
	for (const key of keys) {
		if (typeof key !== "string" || !allowedKeySet.has(key)) return null;
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) return null;
		snapshot[key] = descriptor.value;
	}
	return snapshot;
}

function normalizedUuid(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	return UUID.test(normalized) ? normalized : null;
}

function normalizedNonEmpty(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function validAction(value: unknown): value is TimeCorrectionAction {
	return value === "edit" || value === "delete";
}

export function normalizeTimeCorrectionOriginalWorkMetadata(
	value: unknown,
): TimeCorrectionOriginalWorkMetadata {
	try {
		const metadata = snapshotStrictObject(value, [
			"workLocationType",
			"workCategoryId",
		]);
		if (!metadata || !isWorkLocationType(metadata.workLocationType as string)) {
			throw new TimeCorrectionOriginalWorkMetadataError();
		}
		const workCategoryId =
			metadata.workCategoryId === null
				? null
				: normalizedUuid(metadata.workCategoryId);
		if (metadata.workCategoryId !== null && !workCategoryId) {
			throw new TimeCorrectionOriginalWorkMetadataError();
		}
		return Object.freeze({
			workLocationType: metadata.workLocationType as WorkLocationType,
			workCategoryId,
		});
	} catch {
		throw new TimeCorrectionOriginalWorkMetadataError();
	}
}

function readSubmissionIdentityEvidence(
	input: TimeCorrectionSubmissionIdentityInput,
) {
	try {
		const clockIn = input.clockIn;
		const clockOut = input.clockOut;
		return {
			organizationId: input.organizationId as unknown,
			workPeriodId: input.workPeriodId as unknown,
			action: input.action as unknown,
			workLocationType: input.workLocationType as unknown,
			workCategoryId: input.workCategoryId as unknown,
			clockInPresent: clockIn !== undefined,
			clockInOriginalEntryId: clockIn?.originalEntryId as unknown,
			clockInInstant: clockIn?.instant as unknown,
			clockOutPresent: clockOut !== undefined,
			clockOutOriginalEntryId: clockOut?.originalEntryId as unknown,
			clockOutInstant: clockOut?.instant as unknown,
		};
	} catch {
		throw new TimeCorrectionContractError();
	}
}

function serializeSubmissionInstant(value: Instant): string {
	try {
		const serialized = instantToCanonicalString(value);
		if (typeof serialized !== "string") throw new TimeCorrectionContractError();
		return serialized;
	} catch {
		throw new TimeCorrectionContractError();
	}
}

export function normalizeTimeCorrectionWorkflowPayload(
	value: unknown,
): TimeCorrectionWorkflowPayload {
	try {
		const root = snapshotStrictObject(value, ["timeCorrection"]);
		if (!root) {
			throw new TimeCorrectionWorkflowPayloadError();
		}
		const correction = snapshotStrictObject(
			root.timeCorrection,
			["action"],
			[
				"workLocationType",
				"workCategoryId",
				"clockInCorrectionId",
				"clockOutCorrectionId",
			],
		);
		if (!correction) throw new TimeCorrectionWorkflowPayloadError();
		const action = correction.action;
		const hasClockInCorrection = Object.hasOwn(
			correction,
			"clockInCorrectionId",
		);
		const hasClockOutCorrection = Object.hasOwn(
			correction,
			"clockOutCorrectionId",
		);
		const hasWorkLocation = Object.hasOwn(correction, "workLocationType");
		const hasWorkCategory = Object.hasOwn(correction, "workCategoryId");
		const hasWorkMetadata = hasWorkLocation && hasWorkCategory;
		if (!validAction(action)) {
			throw new TimeCorrectionWorkflowPayloadError();
		}
		const workLocationType = correction.workLocationType;
		const workCategoryId =
			correction.workCategoryId === null
				? null
				: normalizedUuid(correction.workCategoryId);
		const clockInCorrectionId = hasClockInCorrection
			? normalizedUuid(correction.clockInCorrectionId)
			: null;
		const clockOutCorrectionId = hasClockOutCorrection
			? normalizedUuid(correction.clockOutCorrectionId)
			: null;
		if (
			hasWorkLocation !== hasWorkCategory ||
			(hasClockInCorrection && !clockInCorrectionId) ||
			(hasClockOutCorrection && !clockOutCorrectionId) ||
			(!hasWorkMetadata && !clockInCorrectionId && !clockOutCorrectionId) ||
			(action === "delete" &&
				(!clockInCorrectionId || !clockOutCorrectionId)) ||
			(clockInCorrectionId !== null &&
				clockInCorrectionId === clockOutCorrectionId)
		) {
			throw new TimeCorrectionWorkflowPayloadError();
		}

		const endpointIds = {
			...(clockInCorrectionId ? { clockInCorrectionId } : {}),
			...(clockOutCorrectionId ? { clockOutCorrectionId } : {}),
		};
		if (hasWorkMetadata) {
			if (
				typeof workLocationType !== "string" ||
				!isWorkLocationType(workLocationType) ||
				(correction.workCategoryId !== null && !workCategoryId)
			) {
				throw new TimeCorrectionWorkflowPayloadError();
			}
			const timeCorrection: CurrentTimeCorrectionWorkflowContract =
				Object.freeze({
					action,
					workLocationType,
					workCategoryId,
					...endpointIds,
				});
			return Object.freeze({ timeCorrection });
		}
		const timeCorrection: LegacyTimeCorrectionWorkflowContract = Object.freeze({
			action,
			...endpointIds,
		});
		return Object.freeze({ timeCorrection });
	} catch {
		throw new TimeCorrectionWorkflowPayloadError();
	}
}

export function deriveTimeCorrectionSubmissionKey(
	input: TimeCorrectionSubmissionIdentityInput,
): string {
	const evidence = readSubmissionIdentityEvidence(input);
	const organizationId = normalizedNonEmpty(evidence.organizationId);
	const workPeriodId = normalizedUuid(evidence.workPeriodId);
	const workLocationType = evidence.workLocationType;
	const workCategoryId =
		evidence.workCategoryId === null
			? null
			: normalizedUuid(evidence.workCategoryId);
	const clockInId = evidence.clockInPresent
		? normalizedUuid(evidence.clockInOriginalEntryId)
		: null;
	const clockOutId = evidence.clockOutPresent
		? normalizedUuid(evidence.clockOutOriginalEntryId)
		: null;
	if (
		!organizationId ||
		!workPeriodId ||
		!validAction(evidence.action) ||
		typeof workLocationType !== "string" ||
		!isWorkLocationType(workLocationType) ||
		(evidence.workCategoryId !== null && !workCategoryId) ||
		(evidence.clockInPresent &&
			(!clockInId || !isInstant(evidence.clockInInstant))) ||
		(evidence.clockOutPresent &&
			(!clockOutId || !isInstant(evidence.clockOutInstant))) ||
		(clockInId !== null && clockInId === clockOutId) ||
		(evidence.action === "delete" &&
			(!evidence.clockInPresent || !evidence.clockOutPresent))
	) {
		throw new TimeCorrectionContractError();
	}
	const clockInInstant = isInstant(evidence.clockInInstant)
		? serializeSubmissionInstant(evidence.clockInInstant)
		: "";
	const clockOutInstant = isInstant(evidence.clockOutInstant)
		? serializeSubmissionInstant(evidence.clockOutInstant)
		: "";

	const digest = createHash("sha256")
		.update(
			[
				SUBMISSION_NAMESPACE,
				organizationId,
				workPeriodId,
				evidence.action,
				workLocationType,
				workCategoryId ?? "",
				"clock_in",
				clockInId ?? "",
				clockInInstant,
				"clock_out",
				clockOutId ?? "",
				clockOutInstant,
			].join("\0"),
		)
		.digest("hex");
	return `time-correction-submission:v2:${digest}`;
}

export function deriveLegacyTimeCorrectionSubmissionKey(
	input: LegacyTimeCorrectionSubmissionIdentityInput,
): string {
	const evidence = readSubmissionIdentityEvidence(
		input as TimeCorrectionSubmissionIdentityInput,
	);
	const organizationId = normalizedNonEmpty(evidence.organizationId);
	const workPeriodId = normalizedUuid(evidence.workPeriodId);
	const clockInId = evidence.clockInPresent
		? normalizedUuid(evidence.clockInOriginalEntryId)
		: null;
	const clockOutId = evidence.clockOutPresent
		? normalizedUuid(evidence.clockOutOriginalEntryId)
		: null;
	if (
		!organizationId ||
		!workPeriodId ||
		!validAction(evidence.action) ||
		(evidence.clockInPresent &&
			(!clockInId || !isInstant(evidence.clockInInstant))) ||
		(evidence.clockOutPresent &&
			(!clockOutId || !isInstant(evidence.clockOutInstant))) ||
		(!evidence.clockInPresent && !evidence.clockOutPresent) ||
		(clockInId !== null && clockInId === clockOutId) ||
		(evidence.action === "delete" &&
			(!evidence.clockInPresent || !evidence.clockOutPresent))
	) {
		throw new TimeCorrectionContractError();
	}
	const clockInInstant = isInstant(evidence.clockInInstant)
		? serializeSubmissionInstant(evidence.clockInInstant)
		: "";
	const clockOutInstant = isInstant(evidence.clockOutInstant)
		? serializeSubmissionInstant(evidence.clockOutInstant)
		: "";
	const digest = createHash("sha256")
		.update(
			[
				LEGACY_SUBMISSION_NAMESPACE,
				organizationId,
				workPeriodId,
				evidence.action,
				"clock_in",
				clockInId ?? "",
				clockInInstant,
				"clock_out",
				clockOutId ?? "",
				clockOutInstant,
			].join("\0"),
		)
		.digest("hex");
	return `time-correction-submission:v1:${digest}`;
}
