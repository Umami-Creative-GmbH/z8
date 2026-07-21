import { createHash } from "node:crypto";
import {
	type Instant,
	instantToCanonicalString,
	isInstant,
} from "@/lib/datetime/temporal-core";

const SUBMISSION_NAMESPACE = "z8:time-correction-submission:v1";
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TimeCorrectionAction = "edit" | "delete";
type TimeCorrectionEndpointType = "clock_in" | "clock_out";

export interface TimeCorrectionWorkflowPayload {
	readonly timeCorrection: {
		readonly action: TimeCorrectionAction;
		readonly clockInCorrectionId?: string;
		readonly clockOutCorrectionId?: string;
	};
}

export interface TimeCorrectionSubmissionIdentityInput {
	readonly organizationId: string;
	readonly workPeriodId: string;
	readonly action: TimeCorrectionAction;
	readonly clockIn?: {
		readonly originalEntryId: string;
		readonly instant: Instant;
	};
	readonly clockOut?: {
		readonly originalEntryId: string;
		readonly instant: Instant;
	};
}

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
	if (
		keys.length < requiredKeys.length ||
		keys.length > allowedKeys.length ||
		requiredKeys.some((key) => !Object.hasOwn(descriptors, key))
	) {
		return null;
	}
	const snapshot: Record<string, unknown> = {};
	for (const key of keys) {
		if (typeof key !== "string" || !allowedKeys.includes(key)) return null;
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
			["clockInCorrectionId", "clockOutCorrectionId"],
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
		if (!validAction(action)) {
			throw new TimeCorrectionWorkflowPayloadError();
		}
		const clockInCorrectionId = hasClockInCorrection
			? normalizedUuid(correction.clockInCorrectionId)
			: null;
		const clockOutCorrectionId = hasClockOutCorrection
			? normalizedUuid(correction.clockOutCorrectionId)
			: null;
		if (
			(hasClockInCorrection && !clockInCorrectionId) ||
			(hasClockOutCorrection && !clockOutCorrectionId) ||
			(!clockInCorrectionId && !clockOutCorrectionId) ||
			(action === "delete" &&
				(!clockInCorrectionId || !clockOutCorrectionId)) ||
			(clockInCorrectionId !== null &&
				clockInCorrectionId === clockOutCorrectionId)
		) {
			throw new TimeCorrectionWorkflowPayloadError();
		}

		const timeCorrection = Object.freeze({
			action,
			...(clockInCorrectionId ? { clockInCorrectionId } : {}),
			...(clockOutCorrectionId ? { clockOutCorrectionId } : {}),
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
