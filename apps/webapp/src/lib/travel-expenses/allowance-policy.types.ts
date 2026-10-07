/**
 * Allowance policy kinds and source metadata (#606). Kept free of imports: the
 * database schema references these, and every runtime image that loads the
 * schema would otherwise need the policy calculation's dependencies. The
 * timeline logic lives in `allowance-policy.ts`, which re-exports these.
 */

export const ALLOWANCE_POLICY_KINDS = ["mileage", "per_diem"] as const;
export type AllowancePolicyKind = (typeof ALLOWANCE_POLICY_KINDS)[number];

/** Who set a version's rates: the organization, or an adopted verified statutory default. */
export const ALLOWANCE_POLICY_SOURCE_KINDS = ["organization", "statutory_default"] as const;
export type AllowancePolicySourceKind = (typeof ALLOWANCE_POLICY_SOURCE_KINDS)[number];

export interface AllowancePolicySource {
	kind: AllowancePolicySourceKind;
	/** Where the rates come from: an internal policy document or the official citation. */
	reference: string | null;
	/** Which edition of that source, e.g. "LStH 2026". */
	version: string | null;
	/** Catalog key of an adopted statutory default (`statutory-allowance-defaults.ts`). */
	defaultKey: string | null;
}
