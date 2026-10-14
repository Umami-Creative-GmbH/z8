import type { VehicleUseWarning } from "@/lib/time-tracking/vehicle-use/plausibility";
import {
	organizationVehicleIdOf,
	sameWorkVehicleUse,
	type WorkVehicleUse,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import {
	type CurrentTimeCorrectionWorkflowContract,
	type LegacyTimeCorrectionWorkflowContract,
	namedVehicleUse,
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

/**
 * Vehicle use as an approver sees it (#1120). An organization vehicle carries its
 * label ("Name (PLATE)") when the organization still has it.
 */
export type VehicleUseReviewValue =
	| { state: "none" }
	| {
			state: "recorded";
			vehicle: { kind: "own" } | { kind: "organization"; id: string; label: string | null };
			startKm: number | null;
			endKm: number | null;
			distanceKm: number | null;
	  };

export interface TimeCorrectionMetadataChanges {
	workLocation?: CorrectionDisplayChange<
		CurrentTimeCorrectionWorkflowContract["workLocationType"]
	>;
	workCategory?: CorrectionDisplayChange<WorkCategoryReviewValue>;
	/** Present only when the request changes vehicle use (#1120). */
	vehicleUse?: CorrectionDisplayChange<VehicleUseReviewValue> & {
		/** Plausibility warnings for the requested vehicle use (#1121); never a blocker. */
		warnings?: VehicleUseWarning[];
	};
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

/** Organization vehicles named by pending time corrections (#1120), before or after. */
export function vehicleIdsFromTimeCorrectionMetadata(
	requests: Array<{ metadata?: unknown }>,
): string[] {
	return [
		...new Set(
			requests.flatMap((request) => {
				const metadata = parseTimeCorrectionReviewMetadata(request.metadata);
				if (metadata.kind !== "valid_current") return [];
				return [
					organizationVehicleIdOf(namedVehicleUse(metadata.original)),
					organizationVehicleIdOf(namedVehicleUse(metadata.requested)),
				].filter((id): id is string => id !== null);
			}),
		),
	];
}

/** Adds organization vehicle labels to a review names map (#1120), filtered by organization. */
export function addVehicleLabelsForOrganization(
	names: Map<string, string>,
	vehicles: Array<{ id: string; organizationId: string; name: string; licencePlate: string }>,
	organizationId: string,
): Map<string, string> {
	for (const vehicle of vehicles) {
		if (vehicle.organizationId === organizationId) {
			names.set(vehicle.id, `${vehicle.name} (${vehicle.licencePlate})`);
		}
	}
	return names;
}

function vehicleUseReviewValue(
	use: WorkVehicleUse | null,
	namesById: ReadonlyMap<string, string>,
): VehicleUseReviewValue {
	if (!use) return { state: "none" };
	return {
		state: "recorded",
		vehicle:
			use.vehicle.kind === "organization"
				? {
						kind: "organization",
						id: use.vehicle.vehicleId,
						label: namesById.get(use.vehicle.vehicleId) ?? null,
					}
				: { kind: "own" },
		startKm: use.startKm,
		endKm: use.endKm,
		distanceKm: use.distanceKm,
	};
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

/**
 * The changes a time correction requests, for review. `categoryNamesById` also
 * carries organization vehicle labels (`addVehicleLabelsForOrganization`).
 */
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
	const requestedVehicleUse = namedVehicleUse(metadata.requested);
	if (requestedVehicleUse !== undefined) {
		const originalVehicleUse = namedVehicleUse(metadata.original) ?? null;
		if (!sameWorkVehicleUse(originalVehicleUse, requestedVehicleUse)) {
			changes.vehicleUse = {
				original: vehicleUseReviewValue(originalVehicleUse, categoryNamesById),
				requested: vehicleUseReviewValue(requestedVehicleUse, categoryNamesById),
			};
		}
	}
	return Object.keys(changes).length > 0 ? changes : undefined;
}

/**
 * The vehicle use a time correction asks to record (#1121): set only when the
 * request changes vehicle use to some vehicle, otherwise null.
 */
export function requestedVehicleUseChange(
	metadata: TimeCorrectionReviewMetadata,
): WorkVehicleUse | null {
	if (metadata.kind !== "valid_current") return null;
	const requested = namedVehicleUse(metadata.requested);
	if (!requested) return null;
	return sameWorkVehicleUse(namedVehicleUse(metadata.original) ?? null, requested)
		? null
		: requested;
}
