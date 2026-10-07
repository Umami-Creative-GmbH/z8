import { type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { AllowanceOverrideView } from "./allowance-override";
import { type AllowancePolicyVersionRecord, effectiveVersionOn } from "./allowance-policy";
import { isFutureDated } from "./future-dates";
import { type AppliedMileagePolicy, MILEAGE_VEHICLES, type MileageVehicle } from "./mileage.types";
import { formatUnits, multiplyToUnits, parseUnits, type RoundingMode } from "./money";

export {
	type AppliedMileagePolicy,
	MILEAGE_VEHICLES,
	type MileageVehicle,
	type StampedMileagePolicy,
} from "./mileage.types";

/**
 * Mileage expense items (#606): the employee enters the date, route and
 * distance of a business trip in their private vehicle; the server prices it
 * with the organization's mileage policy version effective on that date.
 * Amounts are exact (`money.ts`), rounded once to cents. A client-calculated
 * total is never accepted, and a missing policy is never replaced by a guess.
 */

/** Commercial rounding of the product, applied once. */
export const MILEAGE_ROUNDING: RoundingMode = "half_up";
export const MAX_ROUTE_LENGTH = 300;
/** Scale of stored distances (`decimal(8, 2)`) and rates (`decimal(8, 4)`). */
export const DISTANCE_SCALE = 2;
export const RATE_SCALE = 4;
const MAX_DISTANCE_UNITS = BigInt(10_000_000); // 100000.00 km
const MAX_RATE_UNITS = BigInt(1_000_000); // 100.0000 per km
const ZERO = BigInt(0);

export function isMileageVehicle(value: string): value is MileageVehicle {
	return (MILEAGE_VEHICLES as readonly string[]).includes(value);
}

/** Parses a positive decimal ("61,5" or "61.5") at `scale`, refusing more precision. */
function parsePositive(value: string, scale: number, max: bigint): string | null {
	const normalized = value.includes(".") ? value : value.replace(",", ".");
	if (!/^\d{1,9}(?:\.\d+)?$/.test(normalized)) return null;
	const units = parseUnits(normalized, scale);
	if (units === null || units <= ZERO || units > max) return null;
	return formatUnits(units, scale);
}

/** A rate per kilometre, normalized to four decimals; null when malformed or out of range. */
export function parseMileageRate(value: string): string | null {
	return parsePositive(value.trim(), RATE_SCALE, MAX_RATE_UNITS);
}

/** A distance in kilometres, normalized to two decimals; null when malformed or out of range. */
export function parseMileageDistance(value: string): string | null {
	return parsePositive(value.trim(), DISTANCE_SCALE, MAX_DISTANCE_UNITS);
}

export interface MileageItemDraft {
	/** Calendar day of the drive (YYYY-MM-DD); it has no zone. */
	expenseDate: string | null;
	/** Where the employee drove, e.g. "Office Berlin – customer Potsdam – back". */
	route: string | null;
	/** Kilometres driven, at two decimals. */
	distanceKm: string | null;
	vehicle: MileageVehicle | null;
	accountingReference: string | null;
}

export type MileageItemDraftInput = { [K in keyof MileageItemDraft]: string | null };

export type MileageItemFieldError =
	| "invalid_date"
	| "invalid_distance"
	| "invalid_vehicle"
	| "too_long";

export type ParseMileageItemDraftResult =
	| { ok: true; draft: MileageItemDraft }
	| { ok: false; errors: Partial<Record<keyof MileageItemDraft, MileageItemFieldError>> };

const MAX_ACCOUNTING_REFERENCE_LENGTH = 100;

function blankToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function parseMileageItemDraft(input: MileageItemDraftInput): ParseMileageItemDraftResult {
	const errors: Partial<Record<keyof MileageItemDraft, MileageItemFieldError>> = {};
	const draft: MileageItemDraft = {
		expenseDate: null,
		route: null,
		distanceKm: null,
		vehicle: null,
		accountingReference: null,
	};

	const expenseDate = blankToNull(input.expenseDate);
	if (expenseDate) {
		try {
			draft.expenseDate = parsePlainDate(expenseDate).toString();
		} catch {
			errors.expenseDate = "invalid_date";
		}
	}

	const route = blankToNull(input.route);
	if (route) {
		if (route.length > MAX_ROUTE_LENGTH) errors.route = "too_long";
		else draft.route = route;
	}

	const distance = blankToNull(input.distanceKm);
	if (distance) {
		const parsed = parseMileageDistance(distance);
		if (parsed === null) errors.distanceKm = "invalid_distance";
		else draft.distanceKm = parsed;
	}

	const vehicle = blankToNull(input.vehicle);
	if (vehicle) {
		if (isMileageVehicle(vehicle)) draft.vehicle = vehicle;
		else errors.vehicle = "invalid_vehicle";
	}

	const accountingReference = blankToNull(input.accountingReference);
	if (accountingReference) {
		if (accountingReference.length > MAX_ACCOUNTING_REFERENCE_LENGTH) {
			errors.accountingReference = "too_long";
		} else draft.accountingReference = accountingReference;
	}

	return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, draft };
}

/** A mileage policy version with its rate per vehicle class. */
export interface MileagePolicyVersion extends AllowancePolicyVersionRecord {
	/** Rate per kilometre at four decimals; a vehicle without a rate is not covered. */
	ratesPerKm: Partial<Record<MileageVehicle, string>>;
}

export type MileagePolicyResolution =
	| { status: "found"; policy: AppliedMileagePolicy }
	/** No active version covers the date. */
	| { status: "no_version" }
	/** The covering version has no rate for this vehicle class. */
	| { status: "no_rate"; versionId: string };

export function resolveMileagePolicy(
	versions: readonly MileagePolicyVersion[],
	expenseDate: string,
	vehicle: MileageVehicle,
): MileagePolicyResolution {
	const version = effectiveVersionOn(versions, expenseDate);
	if (!version) return { status: "no_version" };
	const ratePerKm = version.ratesPerKm[vehicle];
	if (!ratePerKm) return { status: "no_rate", versionId: version.id };
	return {
		status: "found",
		policy: {
			policyId: version.policyId,
			versionId: version.id,
			effectiveFrom: version.effectiveFrom,
			vehicle,
			ratePerKm,
			currency: version.currency,
			source: { ...version.source },
		},
	};
}

/**
 * distance × rate: `exactAmount` is the exact product (six decimals), `amount`
 * the reimbursement rounded once, half up, to cents. Inputs must be parsed
 * (`parseMileageDistance`, `parseMileageRate`); malformed ones throw.
 */
export function calculateMileage(input: { distanceKm: string; ratePerKm: string }): {
	exactAmount: string;
	amount: string;
} {
	const exactScale = DISTANCE_SCALE + RATE_SCALE;
	return {
		exactAmount: formatUnits(
			multiplyToUnits(input.distanceKm, input.ratePerKm, exactScale, MILEAGE_ROUNDING),
			exactScale,
		),
		amount: formatUnits(multiplyToUnits(input.distanceKm, input.ratePerKm, 2, MILEAGE_ROUNDING), 2),
	};
}

export type MileageCalculation =
	| {
			status: "calculated";
			distanceKm: string;
			ratePerKm: string;
			currency: string;
			exactAmount: string;
			amount: string;
			rounding: RoundingMode;
			policy: AppliedMileagePolicy;
	  }
	/** Date, distance or vehicle is still missing. */
	| { status: "incomplete" }
	/** No policy version (or no rate for the vehicle) covers the date: setup is needed. */
	| { status: "policy_missing"; expenseDate: string; vehicle: MileageVehicle }
	/** The covering policy is in another currency; mileage is never converted. */
	| { status: "currency_mismatch"; policyCurrency: string };

export function calculateMileageItem(
	draft: Pick<MileageItemDraft, "expenseDate" | "distanceKm" | "vehicle">,
	resolution: MileagePolicyResolution | null,
	reimbursementCurrency: string,
): MileageCalculation {
	const { expenseDate, distanceKm, vehicle } = draft;
	if (!expenseDate || !distanceKm || !vehicle || !resolution) return { status: "incomplete" };
	if (resolution.status !== "found") return { status: "policy_missing", expenseDate, vehicle };
	const { policy } = resolution;
	if (policy.currency !== reimbursementCurrency) {
		return { status: "currency_mismatch", policyCurrency: policy.currency };
	}
	return {
		status: "calculated",
		distanceKm,
		ratePerKm: policy.ratePerKm,
		currency: policy.currency,
		...calculateMileage({ distanceKm, ratePerKm: policy.ratePerKm }),
		rounding: MILEAGE_ROUNDING,
		policy,
	};
}

/** The mileage facts of a report item as the editor and the totals see them. */
export interface MileageItemView {
	route: string | null;
	distanceKm: string | null;
	vehicle: MileageVehicle | null;
	/** The server's calculation with the current policy; null when not calculated in this response. */
	calculation: MileageCalculation | null;
	/** The calculated amount and its currency; null until the item can be priced. */
	amount: string | null;
	currency: string | null;
	/** An administrator's override (#610); when it applies, `amount` is its amount. */
	override?: AllowanceOverrideView | null;
}

/** The mileage view of an item row; null for other item types. */
export function mileageItemView(
	row: {
		type: string;
		mileageRoute: string | null;
		mileageDistanceKm: string | null;
		mileageVehicle: MileageVehicle | null;
	},
	calculation: MileageCalculation | null,
): MileageItemView | null {
	if (row.type !== "mileage") return null;
	const calculated = calculation?.status === "calculated" ? calculation : null;
	return {
		route: row.mileageRoute,
		distanceKm: row.mileageDistanceKm,
		vehicle: row.mileageVehicle,
		calculation,
		amount: calculated?.amount ?? null,
		currency: calculated?.currency ?? null,
	};
}

export type MileageItemRequirement =
	| "expense_date"
	/** The drive is dated later than today anywhere on earth (#685). */
	| "future_date"
	| "route"
	| "distance"
	| "vehicle"
	/** No organization mileage policy covers the date (and vehicle). */
	| "mileage_policy_missing"
	/** The covering policy is not in the report's reimbursement currency. */
	| "mileage_currency";

/**
 * What still keeps a mileage item from being submittable, in form order.
 * `now`: when submission is (or would be) asked for.
 */
export function mileageItemMissingRequirements(
	draft: MileageItemDraft,
	calculation: MileageCalculation,
	now: Instant,
): MileageItemRequirement[] {
	const missing: MileageItemRequirement[] = [];
	if (!draft.expenseDate) missing.push("expense_date");
	else if (isFutureDated(draft.expenseDate, now)) missing.push("future_date");
	if (!draft.route) missing.push("route");
	if (!draft.distanceKm) missing.push("distance");
	if (!draft.vehicle) missing.push("vehicle");
	if (calculation.status === "policy_missing") missing.push("mileage_policy_missing");
	if (calculation.status === "currency_mismatch") missing.push("mileage_currency");
	return missing;
}
