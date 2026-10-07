import type { MileageCalculation, MileageItemView, MileageVehicle } from "./mileage";
import { currencyMinorUnitDigits, formatUnits, parseUnits, STORED_AMOUNT_SCALE } from "./money";
import {
	type PerDiemCalculation,
	type PerDiemItemView,
	type PerDiemItinerary,
	perDiemClaimedDays,
	perDiemFallbackRules,
	samePerDiemItinerary,
} from "./per-diem";
import type { TripDestination } from "./trip-destination";

/**
 * Audited administrator overrides of allowance calculations (#610). The
 * server calculates mileage and per diem from entered facts and dated
 * policies; where it cannot (no organization coverage, or an itinerary the
 * verified rules do not support), an expense administrator may record an
 * evidenced manual amount for exactly the facts it was authorized for. The
 * override never fabricates facts: missing travel facts stay actionable draft
 * errors, a change of the facts makes the override stop applying, and the
 * employee and the reviewer always see it next to the facts and the ordinary
 * result. Pure, so the server, the editor and the settings form agree.
 *
 * #611 (international per diem) resolves `international` itineraries with
 * verified rate tables; whatever stays exceptional still uses this override.
 * A result priced with an official fallback rate (`official_fallback`) is
 * calculated and shown as such, never overridden. An override also stops
 * applying once the situation it resolved is gone (`overrideSituationHolds`).
 */

export const ALLOWANCE_OVERRIDE_KINDS = ["mileage", "per_diem"] as const;
export type AllowanceOverrideKind = (typeof ALLOWANCE_OVERRIDE_KINDS)[number];

export const MAX_OVERRIDE_REASON_LENGTH = 1000;
export const MAX_OVERRIDE_EVIDENCE_LENGTH = 2000;
export const MAX_OVERRIDE_BASIS_LENGTH = 2000;
/** Largest manual allowance: 1,000,000.00 in the reimbursement currency. */
const MAX_OVERRIDE_UNITS = BigInt(100_000_000);
const ZERO = BigInt(0);

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

export function mileageSituation(calculation: MileageCalculation): AllowanceSituation {
	switch (calculation.status) {
		case "calculated":
			return { kind: "calculated", reasons: [] };
		case "incomplete":
			return { kind: "missing_facts", reasons: [] };
		case "policy_missing":
			return { kind: "missing_coverage", reasons: ["policy_missing"] };
		case "currency_mismatch":
			return { kind: "missing_coverage", reasons: ["policy_currency"] };
	}
}

export function perDiemSituation(calculation: PerDiemCalculation): AllowanceSituation {
	switch (calculation.status) {
		case "calculated": {
			// Days another report already pays carry no allowance here; the combined day
			// may be worth more, which only an administrator can decide (`per-diem.ts`).
			if (perDiemClaimedDays(calculation).length > 0) {
				return { kind: "unsupported_case", reasons: ["overlapping_days"] };
			}
			// #611: days priced by an official destination fallback stay visible as such.
			const fallbacks = perDiemFallbackRules(calculation);
			return fallbacks.length > 0
				? { kind: "official_fallback", reasons: fallbacks }
				: { kind: "calculated", reasons: [] };
		}
		case "incomplete":
			return { kind: "missing_facts", reasons: [] };
		case "policy_missing":
			return { kind: "missing_coverage", reasons: ["policy_missing"] };
		case "currency_mismatch":
			return { kind: "missing_coverage", reasons: ["policy_currency"] };
		case "exceptional":
			// Daily locations are travel facts a manual calculation needs too (#611).
			return (calculation.missingLocations?.length ?? 0) > 0
				? { kind: "missing_facts", reasons: ["per_diem_locations"] }
				: { kind: "unsupported_case", reasons: [...calculation.reasons] };
	}
}

/**
 * Whether an administrator may resolve the situation with a manual amount:
 * missing coverage and cases the verified rules do not support. An official
 * fallback rate is a calculated result under the official rules, not an
 * exception, so it is never overridden.
 */
export function isOverridableSituation(situation: AllowanceSituation): boolean {
	return situation.kind === "missing_coverage" || situation.kind === "unsupported_case";
}

/**
 * Whether the situation an override resolved still exists. `live` is the
 * ordinary calculation's situation now; null when it is not known (a frozen
 * item without a stamp), in which case the recorded one stands. The live
 * situation must still need an override and be of the same kind; an
 * unsupported case must have the same reasons, since the manual amount was
 * worked out for exactly those.
 */
export function overrideSituationHolds(
	recorded: AllowanceSituation,
	live: AllowanceSituation | null,
): boolean {
	if (!live) return true;
	if (!isOverridableSituation(live) || live.kind !== recorded.kind) return false;
	if (live.kind !== "unsupported_case") return true;
	const reasons = new Set(live.reasons);
	const recordedReasons = new Set(recorded.reasons);
	return (
		reasons.size === recordedReasons.size &&
		[...recordedReasons].every((reason) => reasons.has(reason))
	);
}

// ---------------------------------------------------------------------------
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

export function mileageOverrideScope(
	facts: Omit<MileageOverrideScope, "kind">,
): MileageOverrideScope {
	return {
		kind: "mileage",
		expenseDate: facts.expenseDate,
		route: facts.route,
		distanceKm: facts.distanceKm,
		vehicle: facts.vehicle,
	};
}

export function perDiemOverrideScope(
	itinerary: PerDiemItinerary,
	destinations: readonly TripDestination[],
): PerDiemOverrideScope {
	return {
		kind: "per_diem",
		itinerary: structuredClone(itinerary),
		destinations: destinations.map((destination) => ({
			place: destination.place,
			countryCode: destination.countryCode,
		})),
	};
}

export function sameAllowanceOverrideScope(
	left: AllowanceOverrideScope,
	right: AllowanceOverrideScope,
): boolean {
	if (left.kind === "mileage" || right.kind === "mileage") {
		return (
			left.kind === right.kind &&
			left.kind === "mileage" &&
			right.kind === "mileage" &&
			left.expenseDate === right.expenseDate &&
			left.route === right.route &&
			left.distanceKm === right.distanceKm &&
			left.vehicle === right.vehicle
		);
	}
	return (
		samePerDiemItinerary(left.itinerary, right.itinerary) &&
		left.destinations.length === right.destinations.length &&
		left.destinations.every(
			(destination, index) =>
				destination.place === right.destinations[index]?.place &&
				destination.countryCode === right.destinations[index]?.countryCode,
		)
	);
}

// ---------------------------------------------------------------------------
// Draft

export interface AllowanceOverrideDraft {
	/** The manual allowance in the report's reimbursement currency, at two decimals. */
	amount: string;
	reason: string;
	/** What the amount rests on, e.g. an official rate table or a written confirmation. */
	evidence: string;
	/** How the amount was calculated, e.g. "2 partial days × 39 EUR + 1 full day × 58 EUR". */
	calculationBasis: string;
}

export type AllowanceOverrideError = "amount" | "reason" | "evidence" | "calculation_basis";

/** A positive (or, for a per diem, zero) amount within the currency's minor units. */
function parseOverrideAmount(
	value: string,
	kind: AllowanceOverrideKind,
	currency: string,
): string | null {
	const trimmed = value.trim();
	const normalized = trimmed.includes(".") ? trimmed : trimmed.replace(",", ".");
	if (!/^\d{1,9}(?:\.\d+)?$/.test(normalized)) return null;
	let digits: number;
	try {
		digits = Math.min(currencyMinorUnitDigits(currency), STORED_AMOUNT_SCALE);
	} catch {
		return null;
	}
	if (parseUnits(normalized, digits) === null) return null;
	const units = parseUnits(normalized, STORED_AMOUNT_SCALE);
	if (units === null || units > MAX_OVERRIDE_UNITS) return null;
	// A per diem of zero is a legitimate decision (e.g. no allowance is owed).
	if (units < ZERO || (kind === "mileage" && units === ZERO)) return null;
	return formatUnits(units, STORED_AMOUNT_SCALE);
}

export function parseAllowanceOverrideDraft(
	input: AllowanceOverrideDraft,
	context: { kind: AllowanceOverrideKind; currency: string },
): { ok: true; draft: AllowanceOverrideDraft } | { ok: false; errors: AllowanceOverrideError[] } {
	const errors: AllowanceOverrideError[] = [];
	const amount = parseOverrideAmount(String(input.amount ?? ""), context.kind, context.currency);
	if (!amount) errors.push("amount");
	const text = (value: string, max: number) => {
		const trimmed = String(value ?? "").trim();
		return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
	};
	const reason = text(input.reason, MAX_OVERRIDE_REASON_LENGTH);
	const evidence = text(input.evidence, MAX_OVERRIDE_EVIDENCE_LENGTH);
	const calculationBasis = text(input.calculationBasis, MAX_OVERRIDE_BASIS_LENGTH);
	if (!reason) errors.push("reason");
	if (!evidence) errors.push("evidence");
	if (!calculationBasis) errors.push("calculation_basis");
	if (!amount || !reason || !evidence || !calculationBasis) return { ok: false, errors };
	return { ok: true, draft: { amount, reason, evidence, calculationBasis } };
}

// ---------------------------------------------------------------------------
// Recorded overrides and their effect

/** An active override as recorded; immutable once authorized. */
export interface AllowanceOverride {
	id: string;
	kind: AllowanceOverrideKind;
	amount: string;
	currency: string;
	reason: string;
	evidence: string;
	calculationBasis: string;
	/** The facts it was authorized for. */
	scope: AllowanceOverrideScope;
	/** The ordinary situation it resolved, as seen when it was authorized. */
	situation: AllowanceSituation;
	/** The authorizing administrator, kept by value. */
	authorizedBy: { employeeId: string; name: string };
	/** Canonical UTC instant. */
	authorizedAt: string;
}

/**
 * Why an override does not apply: the facts (or the report's reimbursement
 * currency) differ from those it was authorized for, or the situation it
 * resolved no longer exists (e.g. a policy now covers the facts).
 */
export type AllowanceOverrideStaleReason = "facts_changed" | "situation_resolved";

export interface AllowanceOverrideView extends AllowanceOverride {
	/** Whether it applies to the item's current facts; a stale override is shown, never counted. */
	applies: boolean;
	/** Null while it applies. */
	staleReason: AllowanceOverrideStaleReason | null;
}

/**
 * An override against the item's live facts and, when known, the ordinary
 * calculation's situation now (`overrideSituationHolds`).
 */
export function allowanceOverrideView(
	override: AllowanceOverride,
	liveScope: AllowanceOverrideScope,
	reimbursementCurrency: string,
	liveSituation: AllowanceSituation | null = null,
): AllowanceOverrideView {
	const sameFacts =
		override.kind === liveScope.kind &&
		override.currency === reimbursementCurrency &&
		sameAllowanceOverrideScope(override.scope, liveScope);
	const staleReason: AllowanceOverrideStaleReason | null = !sameFacts
		? "facts_changed"
		: !overrideSituationHolds(override.situation, liveSituation)
			? "situation_resolved"
			: null;
	return { ...override, applies: staleReason === null, staleReason };
}

/**
 * The mileage view with its override; an applying override sets the counted
 * amount. `calculationIsOrdinary`: whether the view's calculation is the
 * ordinary result the override is checked against (always for an editable
 * report; for a frozen one only when it was priced from its stamp).
 */
export function overriddenMileageView(
	view: MileageItemView | null,
	expenseDate: string | null,
	override: AllowanceOverride | null | undefined,
	reimbursementCurrency: string,
	calculationIsOrdinary = true,
): MileageItemView | null {
	if (!view || !override) return view;
	const overrideView = allowanceOverrideView(
		override,
		mileageOverrideScope({
			expenseDate,
			route: view.route,
			distanceKm: view.distanceKm,
			vehicle: view.vehicle,
		}),
		reimbursementCurrency,
		calculationIsOrdinary && view.calculation ? mileageSituation(view.calculation) : null,
	);
	return {
		...view,
		override: overrideView,
		...(overrideView.applies
			? { amount: overrideView.amount, currency: overrideView.currency }
			: {}),
	};
}

/**
 * The per diem view with its override; an applying override sets the counted
 * amount. The view's calculation is the ordinary result: live for an editable
 * report, from the stamp for a frozen one (none without a stamp).
 */
export function overriddenPerDiemView(
	view: PerDiemItemView,
	destinations: readonly TripDestination[],
	override: AllowanceOverride | null | undefined,
	reimbursementCurrency: string,
): PerDiemItemView {
	if (!override) return view;
	const overrideView = allowanceOverrideView(
		override,
		perDiemOverrideScope(view.itinerary, destinations),
		reimbursementCurrency,
		view.calculation ? perDiemSituation(view.calculation) : null,
	);
	return {
		...view,
		override: overrideView,
		...(overrideView.applies
			? { amount: overrideView.amount, currency: overrideView.currency }
			: {}),
	};
}

/** Requirements an applying override resolves: coverage and calculation, never entered facts. */
const OVERRIDE_RESOLVED_REQUIREMENTS: ReadonlySet<string> = new Set([
	"mileage_policy_missing",
	"mileage_currency",
	"per_diem_exceptional",
	"per_diem_policy_missing",
	"per_diem_currency",
]);

export function withoutOverriddenRequirements<Requirement extends string>(
	missing: Requirement[],
	override: Pick<AllowanceOverrideView, "applies"> | null | undefined,
): Requirement[] {
	if (!override?.applies) return missing;
	return missing.filter((requirement) => !OVERRIDE_RESOLVED_REQUIREMENTS.has(requirement));
}
