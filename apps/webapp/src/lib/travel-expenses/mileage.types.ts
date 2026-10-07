import type { AllowancePolicySource } from "./allowance-policy.types";

/**
 * Mileage vehicles and the policy stamp of a mileage item (#606). Kept free of
 * runtime imports: the database schema references these, and every runtime
 * image that loads the schema would otherwise need the mileage calculation's
 * dependencies. `mileage.ts` re-exports them.
 */

/**
 * Vehicle classes with their own flat rate. German tax law distinguishes a car
 * ("Kraftwagen", e.g. PKW) from any other motorized vehicle (e.g. motorcycle);
 * see `statutory-allowance-defaults.ts`.
 */
export const MILEAGE_VEHICLES = ["car", "other_motor_vehicle"] as const;
export type MileageVehicle = (typeof MILEAGE_VEHICLES)[number];

/**
 * The policy applied to one mileage item: everything needed to reproduce and
 * explain its amount. It is stamped on the item at submission and frozen.
 */
export interface AppliedMileagePolicy {
	policyId: string;
	versionId: string;
	effectiveFrom: string;
	vehicle: MileageVehicle;
	ratePerKm: string;
	currency: string;
	source: AllowancePolicySource;
}

/**
 * The policy stamped on a mileage item when its report is submitted, with the
 * expense date it was resolved for. Frozen facts and the pre-decision compare
 * read this stamp, never the current policy, so a later policy change cannot
 * alter (or hold) a submitted result.
 */
export interface StampedMileagePolicy extends AppliedMileagePolicy {
	expenseDate: string;
}
