import {
	type CurrentTimeCorrectionWorkflowContract,
	type LegacyTimeCorrectionWorkflowContract,
	normalizeTimeCorrectionOriginalWorkMetadata,
	normalizeTimeCorrectionWorkflowPayload,
	type TimeCorrectionOriginalWorkMetadata,
} from "../domain-adapters/time-correction-contract";

export type WorkCategoryReviewValue =
	| { state: "named"; id: string; name: string }
	| { state: "none" }
	| { state: "unavailable"; id: string };

export interface CorrectionDisplayChange<T> {
	original: T;
	requested: T;
}

export interface TimeCorrectionMetadataChanges {
	workLocation?: CorrectionDisplayChange<
		CurrentTimeCorrectionWorkflowContract["workLocationType"]
	>;
	workCategory?: CorrectionDisplayChange<WorkCategoryReviewValue>;
}

export type TimeCorrectionReviewMetadata =
	| { kind: "legacy_absent" }
	| { kind: "malformed" }
	| {
			kind: "valid_legacy";
			requested: LegacyTimeCorrectionWorkflowContract;
	  }
	| {
			kind: "valid_current";
			original: TimeCorrectionOriginalWorkMetadata;
			requested: CurrentTimeCorrectionWorkflowContract;
	  };

type ParsedProperty =
	| { state: "absent" }
	| { state: "invalid" }
	| { state: "valid"; value: unknown };

function metadataObject(value: unknown): Record<string, unknown> | null {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return null;
		}
		const prototype = Object.getPrototypeOf(value);
		return prototype === Object.prototype || prototype === null
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function ownDataProperty(
	value: Record<string, unknown>,
	key: string,
): ParsedProperty {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) {
			return key in value ? { state: "invalid" } : { state: "absent" };
		}
		return descriptor.enumerable && "value" in descriptor
			? { state: "valid", value: descriptor.value }
			: { state: "invalid" };
	} catch {
		return { state: "invalid" };
	}
}

export function parseTimeCorrectionReviewMetadata(
	metadata: unknown,
): TimeCorrectionReviewMetadata {
	if (metadata === null || metadata === undefined) {
		return { kind: "legacy_absent" };
	}
	const root = metadataObject(metadata);
	if (!root) return { kind: "malformed" };
	const correction = ownDataProperty(root, "timeCorrection");
	if (correction.state === "absent") {
		return ownDataProperty(root, "timeCorrectionOriginalWorkMetadata").state ===
			"absent"
			? { kind: "legacy_absent" }
			: { kind: "malformed" };
	}
	if (correction.state === "invalid") return { kind: "malformed" };

	try {
		const requested = normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: correction.value,
		}).timeCorrection;
		if (!Object.hasOwn(requested, "workLocationType")) {
			const original = ownDataProperty(
				root,
				"timeCorrectionOriginalWorkMetadata",
			);
			return original.state === "absent"
				? {
						kind: "valid_legacy",
						requested: requested as LegacyTimeCorrectionWorkflowContract,
					}
				: { kind: "malformed" };
		}
		const original = ownDataProperty(
			root,
			"timeCorrectionOriginalWorkMetadata",
		);
		if (original.state !== "valid") return { kind: "malformed" };
		return {
			kind: "valid_current",
			original: normalizeTimeCorrectionOriginalWorkMetadata(original.value),
			requested: requested as CurrentTimeCorrectionWorkflowContract,
		};
	} catch {
		return { kind: "malformed" };
	}
}

export function categoryIdsFromTimeCorrectionMetadata(
	requests: Array<{ metadata?: unknown }>,
) {
	return [
		...new Set(
			requests.flatMap((request) => {
				const metadata = parseTimeCorrectionReviewMetadata(request.metadata);
				if (metadata.kind !== "valid_current") return [];
				return [
					metadata.original.workCategoryId,
					metadata.requested.workCategoryId,
				].filter((id): id is string => id !== null);
			}),
		),
	];
}

export function categoryNamesForOrganization(
	categories: Array<{ id: string; organizationId: string; name: string }>,
	organizationId: string,
) {
	return new Map(
		categories.flatMap((category) =>
			category.organizationId === organizationId
				? [[category.id, category.name] as const]
				: [],
		),
	);
}

function categoryReviewValue(
	id: string | null,
	categoryNamesById: ReadonlyMap<string, string>,
): WorkCategoryReviewValue {
	if (id === null) return { state: "none" };
	const name = categoryNamesById.get(id);
	return name ? { state: "named", id, name } : { state: "unavailable", id };
}

export function timeCorrectionMetadataChanges(
	metadata: TimeCorrectionReviewMetadata,
	categoryNamesById: ReadonlyMap<string, string>,
): TimeCorrectionMetadataChanges | undefined {
	if (metadata.kind !== "valid_current") return undefined;
	const changes: TimeCorrectionMetadataChanges = {};
	if (
		metadata.original.workLocationType !== metadata.requested.workLocationType
	) {
		changes.workLocation = {
			original: metadata.original.workLocationType,
			requested: metadata.requested.workLocationType,
		};
	}
	if (metadata.original.workCategoryId !== metadata.requested.workCategoryId) {
		changes.workCategory = {
			original: categoryReviewValue(
				metadata.original.workCategoryId,
				categoryNamesById,
			),
			requested: categoryReviewValue(
				metadata.requested.workCategoryId,
				categoryNamesById,
			),
		};
	}
	return Object.keys(changes).length > 0 ? changes : undefined;
}
