import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";

/**
 * Dated organization allowance policies (#606). An organization has at most
 * one policy per allowance kind; the policy is a timeline of immutable
 * versions. A version applies from its `effectiveFrom` calendar day until the
 * next active version starts, so active versions never overlap and a day is
 * never covered twice. Changing a rate means activating a new version (or
 * replacing the version that starts the same day); withdrawing a version
 * hands its days back to the version before it. Submitted reports freeze the
 * version they applied, so nothing here ever changes a reviewed result.
 *
 * Extension points (#609 per diem, #610 audited overrides, #611 international
 * tables): a kind adds its name to `ALLOWANCE_POLICY_KINDS` (and the
 * `travel_expense_allowance_policy_kind_check`), and keeps its rate data in
 * its own child table keyed by `(version_id, organization_id)`, like the
 * mileage rates. The identity, dating, source metadata, activation lock and
 * withdrawal stay shared (`allowance-policy-store.ts`).
 */

export const ALLOWANCE_POLICY_KINDS = ["mileage"] as const;
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

export interface AllowancePolicyVersionRecord {
	id: string;
	policyId: string;
	/** First calendar day (YYYY-MM-DD) the version applies to; it has no zone. */
	effectiveFrom: string;
	currency: string;
	source: AllowancePolicySource;
	/** When the version was withdrawn or replaced; a withdrawn version never applies. */
	withdrawnAt: string | null;
}

type Dated = Pick<AllowancePolicyVersionRecord, "effectiveFrom" | "withdrawnAt">;

function byStartAscending(left: Dated, right: Dated): number {
	return comparePlainDates(parsePlainDate(left.effectiveFrom), parsePlainDate(right.effectiveFrom));
}

/** The active version that applies on `date`: the latest one starting on or before it. */
export function effectiveVersionOn<T extends Dated>(versions: readonly T[], date: string): T | null {
	const day = parsePlainDate(date);
	let applicable: T | null = null;
	for (const version of versions.filter((candidate) => !candidate.withdrawnAt).toSorted(byStartAscending)) {
		if (comparePlainDates(parsePlainDate(version.effectiveFrom), day) > 0) break;
		applicable = version;
	}
	return applicable;
}

export type TimelineEntry<T> = T & {
	/** First day no longer covered (the next active version's start); null while open-ended. */
	effectiveUntil: string | null;
};

/** Active versions, latest first, each with the exclusive end of its coverage. */
export function activeVersionTimeline<T extends Dated>(versions: readonly T[]): TimelineEntry<T>[] {
	const active = versions.filter((version) => !version.withdrawnAt).toSorted(byStartAscending);
	return active
		.map((version, index) => ({
			...version,
			effectiveUntil: active[index + 1]?.effectiveFrom ?? null,
		}))
		.reverse();
}
