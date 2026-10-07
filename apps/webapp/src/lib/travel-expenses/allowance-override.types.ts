import type { MileageVehicle } from "./mileage.types";
import type { PerDiemItinerary } from "./per-diem.types";
import type { TripDestination } from "./trip-destination";

/**
 * Allowance override kinds, situations and scopes (#610). Kept free of runtime
 * imports: the database schema references these, and every runtime image that
 * loads the schema would otherwise need the allowance calculations'
 * dependencies. `allowance-override.ts` re-exports them.
 */

export const ALLOWANCE_OVERRIDE_KINDS = ["mileage", "per_diem"] as const;
export type AllowanceOverrideKind = (typeof ALLOWANCE_OVERRIDE_KINDS)[number];

/**
 * Why an allowance has (or lacks) an ordinary result:
 * - `calculated`: priced by the policy; no override is needed.
 * - `missing_facts`: the employee has not entered everything; never overridden.
 * - `missing_coverage`: the organization has no (suitable) policy for it.
 * - `official_fallback`: priced with an official fallback rate (#611), shown as such; not overridden.
 * - `unsupported_case`: the verified rules do not cover the itinerary.
 */
export type AllowanceSituationKind =
	| "calculated"
	| "missing_facts"
	| "missing_coverage"
	| "official_fallback"
	| "unsupported_case";

export interface AllowanceSituation {
	kind: AllowanceSituationKind;
	/** Machine reasons, e.g. per diem exception reasons or `policy_missing`. */
	reasons: string[];
}

// Scope: the facts an override was authorized for

export interface MileageOverrideScope {
	kind: "mileage";
	expenseDate: string | null;
	route: string | null;
	distanceKm: string | null;
	vehicle: MileageVehicle | null;
}

export interface PerDiemOverrideScope {
	kind: "per_diem";
	itinerary: PerDiemItinerary;
	destinations: TripDestination[];
}

export type AllowanceOverrideScope = MileageOverrideScope | PerDiemOverrideScope;
