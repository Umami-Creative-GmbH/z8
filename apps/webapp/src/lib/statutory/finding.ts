/**
 * The shared statutory finding shape every Milestone 2 monitor (#1989–#1993) returns and the
 * Compliance Command Center / Reviews inbox (#1994) aggregates.
 *
 * Privacy rule (A1 wage isolation): `summary` is safe for scoped managers, planners and the
 * employee — it carries tiers, percentages and non-money quantities only. Every EUR amount,
 * hourly wage and external-job earning goes into `adminDetail`, which `redactStatutoryFinding`
 * drops for everyone below org admin.
 */
import type { StatutoryAcknowledgementKind } from "./acknowledgement-kinds";
import type { StatutoryPreferences } from "./preferences";
import type { StatutoryDomain } from "./threshold-catalog";

export type StatutorySeverity = "info" | "warning" | "critical";

/** Where usage sits against a cap under the organization's warning tiers. */
export type StatutoryUsageTier = "ok" | "warning" | "critical" | "exceeded";

/** A non-money quantity. There is deliberately no money unit: money is admin detail. */
export interface StatutoryQuantity {
	readonly unit: "minutes" | "days" | "weeks" | "months" | "calls";
	readonly value: number;
}

/** Wage-free summary, visible to every audience allowed to see the finding. */
export interface StatutoryFindingSummary {
	readonly tier?: StatutoryUsageTier;
	/** Whole percent of the statutory limit used (may exceed 100). */
	readonly usedPercent?: number;
	readonly used?: StatutoryQuantity;
	readonly limit?: StatutoryQuantity;
	readonly remaining?: StatutoryQuantity;
	/**
	 * Whether `limit` is a ceiling (`used` must stay at or below it, the default) or a floor
	 * (`used` must reach it, e.g. a minimum rest period or break). A breach deepens when `used`
	 * moves further past the limit: up for a ceiling, down for a floor.
	 */
	readonly limitDirection?: StatutoryLimitDirection;
}

export type StatutoryLimitDirection = "ceiling" | "floor";

/** Org-admin-only detail: EUR amounts (minor units), wages, external earnings, free-form facts. */
export interface StatutoryFindingAdminDetail {
	readonly currency?: string;
	/** Named amounts in minor units, e.g. `{ earned: 41200, planned: 9000, cap: 60300 }`. */
	readonly amountsCents?: Readonly<Record<string, number>>;
	readonly hourlyWageCents?: number;
	readonly externalEarningsCents?: number;
	readonly facts?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * Acknowledgement status attached by `attachAcknowledgementStates`, or by a contributor that judges
 * it beyond the fingerprint (Minijob months); the seam keeps an attached one.
 */
export interface StatutoryFindingAcknowledgement {
	readonly status: "none" | "current" | "stale";
	readonly acknowledgedAt: Date | null;
	/** Admin-only (dropped by redaction). */
	readonly acknowledgedBy?: string | null;
	/** Admin-only (dropped by redaction). */
	readonly reason?: string | null;
}

export interface StatutoryFinding<Kind extends string = string> {
	/** `statutoryFindingId(kind, employeeId, subjectKey)`: stable across evaluations. */
	readonly id: string;
	readonly organizationId: string;
	readonly employeeId: string;
	readonly domain: StatutoryDomain;
	/** Monitor-specific kind, e.g. `minijob_monthly_cap`, `on_call_short_notice`. */
	readonly kind: Kind;
	readonly severity: StatutorySeverity;
	/** What was evaluated: a month `2026-03`, a week `2026-W10`, a year `2026`, `shift:<id>`… */
	readonly subjectKey: string;
	/** Evaluated plain-date period, `periodEnd` exclusive. */
	readonly periodStart: string;
	readonly periodEnd: string;
	readonly legalReference: string;
	readonly summary: StatutoryFindingSummary;
	/**
	 * True when the finding measures earnings (Minijob caps, the short-term Berufsmäßigkeit earnings
	 * check). Restricted readers then get the tier only: a percentage of a public EUR cap, or minutes
	 * or days derived from one, reveals earnings and, with the visible hours, the wage. Findings in
	 * the `minijob` domain are always treated as earnings-derived.
	 */
	readonly earningsDerived?: boolean;
	readonly adminDetail: StatutoryFindingAdminDetail | null;
	/** `statutoryInputFingerprint(evaluated inputs)`; acknowledgements go stale when it changes. */
	readonly inputFingerprint: string;
	/** The acknowledgement kind that documents this finding, or null when it cannot be acknowledged. */
	readonly acknowledgementKind: StatutoryAcknowledgementKind | null;
	readonly acknowledgement?: StatutoryFindingAcknowledgement;
	/**
	 * True when this finding must stop shift publication (JArbSchG hard limits while the
	 * organization's `blockJarbschgShiftPublish` is on). Contributors report the raw hard-limit
	 * block; the scheduling seam lifts it once the finding's acknowledgement is `current` (e.g. an
	 * acknowledged sector exception), so contributors never query acknowledgements themselves.
	 * Clock-in and clock-out are never blocked.
	 */
	readonly blocksPublication?: boolean;
	/**
	 * Set by the scheduling seam when it lifted `blocksPublication` for a current acknowledgement:
	 * the finding would block without it. The publish block's guards count it as a breach the
	 * schedule already had, so an edit that eases it is not refused for making it stale.
	 */
	readonly publicationBlockLifted?: boolean;
	/**
	 * The minutes of work a sector-exception finding (night, Saturday, Sunday, holiday work) covers,
	 * when `summary` counts something coarser (a day): more covered work is a deeper breach.
	 */
	readonly coveredMinutes?: number;
	/**
	 * Where that covered work lies, as ISO instants, when other findings of its scope may cover the
	 * same time (an apprentice release conflict: overlapping shifts in one exam): the scope's
	 * covered minutes count it once. Dropped for restricted audiences.
	 */
	readonly coveredSpan?: { readonly start: string; readonly end: string };
}

export function statutoryFindingId(kind: string, employeeId: string, subjectKey: string): string {
	return `${kind}:${employeeId}:${subjectKey}`;
}

/**
 * Classifies `used` against `limit` with the organization's tiers: `exceeded` above the limit,
 * `critical` from the critical percentage up to the limit, `warning` from the warning percentage.
 */
export function classifyStatutoryUsage(
	usage: { readonly used: number; readonly limit: number },
	tiers: Pick<StatutoryPreferences, "warningThresholdPercent" | "criticalThresholdPercent">,
): { tier: StatutoryUsageTier; usedPercent: number } {
	if (usage.limit <= 0) {
		return usage.used > 0 ? { tier: "exceeded", usedPercent: 100 } : { tier: "ok", usedPercent: 0 };
	}
	// Compare `used * 100` with `percent * limit` so tier boundaries are exact for integer inputs.
	const scaledUse = usage.used * 100;
	const usedPercent = Math.floor(scaledUse / usage.limit);
	if (usage.used > usage.limit)
		return { tier: "exceeded", usedPercent: Math.max(usedPercent, 101) };
	if (scaledUse >= tiers.criticalThresholdPercent * usage.limit) {
		return { tier: "critical", usedPercent };
	}
	if (scaledUse >= tiers.warningThresholdPercent * usage.limit) {
		return { tier: "warning", usedPercent };
	}
	return { tier: "ok", usedPercent };
}

/** Default severity of a usage tier; monitors may raise it (e.g. an unacknowledged exceedance). */
export function severityOfUsageTier(tier: StatutoryUsageTier): StatutorySeverity | null {
	switch (tier) {
		case "ok":
			return null;
		case "warning":
			return "warning";
		case "critical":
		case "exceeded":
			return "critical";
	}
}
