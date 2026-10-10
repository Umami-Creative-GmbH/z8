/**
 * Tax treatment (#903): how an invoice draft is taxed, as a Z8 enum plus its
 * rate. The accounting connection holds the default; a customer may override
 * it. Each connector translates the treatment into its tool's own tax types
 * (Lexware `taxConditions.taxType`, sevdesk `taxRule`). Z8 never decides a
 * treatment itself; the accountant checks it on the draft (ADR 0002).
 *
 * Rates are integer basis points (19 % is 1900), never floats. Client-safe.
 * Keep `TAX_TREATMENT_KINDS` in sync with the CHECK constraints in
 * `db/schema/billable-time.ts`.
 */

import { formatUnits, normalizeDecimalInput, parseUnits } from "@/lib/money/exact-decimal";

export const TAX_TREATMENT_KINDS = [
	"domestic_standard",
	"domestic_reduced",
	"eu_reverse_charge",
	"third_country_service",
	"vat_free",
] as const;

export type TaxTreatmentKind = (typeof TAX_TREATMENT_KINDS)[number];

/** Treatments that tax the draft lines at a positive domestic rate. */
const RATED_KINDS: ReadonlySet<TaxTreatmentKind> = new Set([
	"domestic_standard",
	"domestic_reduced",
]);

const RATE_SCALE = 2;
const MAX_RATE_BASIS_POINTS = 10_000;

export interface TaxTreatment {
	kind: TaxTreatmentKind;
	/** The VAT rate in hundredths of a percent: 1900 is 19 %. Zero unless rated. */
	rateBasisPoints: number;
}

export type TaxTreatmentRefusal = "invalid_kind" | "invalid_rate";

export type ParsedTaxTreatment =
	| { ok: true; treatment: TaxTreatment }
	| { ok: false; reason: TaxTreatmentRefusal };

export function isTaxTreatmentKind(value: unknown): value is TaxTreatmentKind {
	return typeof value === "string" && (TAX_TREATMENT_KINDS as readonly string[]).includes(value);
}

/** Whether a treatment taxes at a positive rate the admin enters. */
export function isRatedTaxTreatment(kind: TaxTreatmentKind): boolean {
	return RATED_KINDS.has(kind);
}

/**
 * Reads an entered tax treatment (`{ kind, rate }`, rate as a percentage with
 * up to two decimals and a decimal comma allowed). Domestic treatments need a
 * rate above 0 and at most 100 %; reverse charge, third-country service and
 * VAT-free are always 0 % (blank or zero accepted).
 */
export function parseTaxTreatment(input: unknown): ParsedTaxTreatment {
	if (typeof input !== "object" || input === null) return { ok: false, reason: "invalid_kind" };
	const { kind, rate } = input as { kind?: unknown; rate?: unknown };
	if (!isTaxTreatmentKind(kind)) return { ok: false, reason: "invalid_kind" };
	const text = typeof rate === "number" ? String(rate) : typeof rate === "string" ? rate : "";
	const normalized = normalizeDecimalInput(text);

	if (!isRatedTaxTreatment(kind)) {
		if (normalized === "") return { ok: true, treatment: { kind, rateBasisPoints: 0 } };
		const units = parseUnits(normalized, RATE_SCALE);
		return units === BigInt(0)
			? { ok: true, treatment: { kind, rateBasisPoints: 0 } }
			: { ok: false, reason: "invalid_rate" };
	}

	const units = parseUnits(normalized, RATE_SCALE);
	if (units === null || units <= BigInt(0) || units > BigInt(MAX_RATE_BASIS_POINTS)) {
		return { ok: false, reason: "invalid_rate" };
	}
	return { ok: true, treatment: { kind, rateBasisPoints: Number(units) } };
}

/** A stored treatment (`text` kind, `numeric(5, 2)` rate). Throws on a schema error. */
export function taxTreatmentFromStored(kind: string, rate: string): TaxTreatment {
	const units = parseUnits(rate, RATE_SCALE);
	if (!isTaxTreatmentKind(kind) || units === null) {
		throw new RangeError(`Not a stored tax treatment: ${kind} ${rate}`);
	}
	return { kind, rateBasisPoints: Number(units) };
}

/** A rate in basis points as a two-decimal percentage: 1900 is "19.00". */
export function formatTaxRate(rateBasisPoints: number): string {
	return formatUnits(BigInt(rateBasisPoints), RATE_SCALE);
}

export type EffectiveTaxTreatment = TaxTreatment & { source: "customer" | "connection" };

/** The treatment a customer's hand-off uses: its override, else the connection default. */
export function effectiveTaxTreatment(
	connectionDefault: TaxTreatment,
	customerOverride: TaxTreatment | null,
): EffectiveTaxTreatment {
	return customerOverride
		? { ...customerOverride, source: "customer" }
		: { ...connectionDefault, source: "connection" };
}
