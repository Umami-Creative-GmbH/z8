import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";

/**
 * Verified German rules and default amounts for domestic per diem
 * ("Verpflegungsmehraufwendungen", #609). Nothing here applies on its own:
 * the eligibility rules apply only to calendar days inside their verified
 * edition, and the default amounts only once an administrator adopts them as
 * a dated policy version. Never add a rule or amount that was not verified
 * against the official text; days outside a verified edition are flagged for
 * an audited manual calculation (#610) instead of being guessed.
 */

export interface OfficialSource {
	label: string;
	url: string;
}

/**
 * The statutory eligibility rules of one verified edition. Thresholds are
 * minutes of absence from the employee's home and first workplace.
 */
export interface PerDiemRuleSet {
	key: string;
	country: "DE";
	/** First and last calendar day (inclusive) the verified edition covers. */
	validFrom: string;
	validThrough: string;
	/** A single-day absence must be MORE than this to earn the partial-day allowance. */
	partialDayMinimumExclusiveMinutes: number;
	reference: string;
	version: string;
	sources: readonly OfficialSource[];
	verifiedOn: string;
}

const ESTG_9: OfficialSource = {
	label: "§ 9 Abs. 4a EStG",
	url: "https://www.gesetze-im-internet.de/estg/__9.html",
};
const BMF_REISEKOSTEN: OfficialSource = {
	label: "LStH 2026, Anhang 25 III (BMF 25.11.2020, Rz. 47-49, 53-55, 73-77, 87)",
	url: "https://lsth.bundesfinanzministerium.de/lsth/2026/B-Anhaenge/Anhang-25/III/inhalt.html",
};
const LSTR_R_9_6: OfficialSource = {
	label: "LStH 2026, R 9.6 (Abs. 2: only the highest allowance per calendar day)",
	url: "https://lsth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/II-Einkommen-2-24b/4-Ueberschuss-d-Einnahmen-ueber-die-Werbungsk-8-9a/Paragraf-9/r-9-6.html",
};

/**
 * Domestic eligibility under § 9 Abs. 4a Satz 3 EStG, checked on 2026-10-06
 * against the official law text and the LStH 2026 edition of the BMF letter of
 * 25 November 2020 (BStBl I S. 1228):
 * - Nr. 1 / Rz. 48: full-day allowance for each calendar day of 24 hours'
 *   absence from home (an intermediate day of a trip with overnight stays);
 * - Nr. 2 / Rz. 49: partial-day allowance for the arrival and the departure
 *   day of a multi-day trip with an overnight stay away from home, without a
 *   minimum absence;
 * - Nr. 3 / Rz. 47: partial-day allowance for a calendar day without an
 *   overnight stay and an absence of MORE than 8 hours; an activity that
 *   starts on one day and ends on the next without an overnight stay counts
 *   once, on the day holding the larger part of the combined absence;
 * - Satz 6 / Rz. 53-55: limited to the first three months at the same
 *   workplace (not calculated here: flagged as exceptional);
 * - R 9.6 Abs. 2 LStR: one allowance per calendar day (overlaps flagged).
 * The edition is verified for 2026 only; later days need a re-verified entry.
 */
export const GERMAN_DOMESTIC_PER_DIEM_RULES: PerDiemRuleSet = {
	key: "de-domestic-per-diem-estg-9-4a-2026",
	country: "DE",
	validFrom: "2026-01-01",
	validThrough: "2026-12-31",
	partialDayMinimumExclusiveMinutes: 8 * 60,
	reference:
		"§ 9 Abs. 4a Satz 3 Nr. 1-3 and Satz 6-10 EStG; BMF letter of 25.11.2020 (BStBl I S. 1228), Rz. 47-49, 53-55, 73-77, 87; R 9.6 Abs. 2 LStR",
	version: "LStH 2026",
	sources: [ESTG_9, BMF_REISEKOSTEN, LSTR_R_9_6],
	verifiedOn: "2026-10-06",
};

export const PER_DIEM_RULE_SETS: readonly PerDiemRuleSet[] = [GERMAN_DOMESTIC_PER_DIEM_RULES];

export function findPerDiemRuleSet(key: string): PerDiemRuleSet | null {
	return PER_DIEM_RULE_SETS.find((entry) => entry.key === key) ?? null;
}

/** The verified rule set covering `date`, if any. */
export function perDiemRulesOn(date: string): PerDiemRuleSet | null {
	const day = parsePlainDate(date);
	return (
		PER_DIEM_RULE_SETS.find(
			(entry) =>
				comparePlainDates(day, parsePlainDate(entry.validFrom)) >= 0 &&
				comparePlainDates(day, parsePlainDate(entry.validThrough)) <= 0,
		) ?? null
	);
}

/** Amounts of one area (domestic: "DE") in a per diem policy version, at two decimals. */
export interface PerDiemRates {
	/** Calendar day of 24 hours' absence. */
	fullDay: string;
	/** Arrival/departure day with overnight stay, or a day of more than 8 hours. */
	partialDay: string;
	/** Reductions for a meal the employer (or a third party on its behalf) provided. */
	breakfastDeduction: string;
	lunchDeduction: string;
	dinnerDeduction: string;
}

export interface StatutoryPerDiemDefault {
	key: string;
	kind: "per_diem";
	country: "DE";
	area: "DE";
	currency: string;
	rates: PerDiemRates;
	/** Earliest day the default may be adopted from: the start of the verified edition. */
	validFrom: string;
	reference: string;
	version: string;
	sources: readonly OfficialSource[];
	verifiedOn: string;
}

/**
 * German domestic per diem amounts: § 9 Abs. 4a Satz 3 EStG grants 28 euros
 * for a 24-hour day (Nr. 1) and 14 euros for an arrival/departure day (Nr. 2)
 * or a day of more than 8 hours (Nr. 3). Satz 8 reduces the allowance for a
 * meal the employer provides by 20 percent (breakfast) and 40 percent (lunch,
 * dinner) of the full-day allowance; Rz. 73 of the BMF letter states the
 * domestic amounts "5,60 € für ein Frühstück und jeweils 11,20 € für ein
 * Mittag- und Abendessen", applied per day and at most down to 0 euros.
 * Satz 10 and Rz. 77/87 reduce each meal's deduction by the employee's
 * payment for that meal. Verified on 2026-10-06 (law text and LStH 2026).
 */
export const GERMAN_DOMESTIC_PER_DIEM_DEFAULT: StatutoryPerDiemDefault = {
	key: "de-per-diem-estg-9-4a-domestic",
	kind: "per_diem",
	country: "DE",
	area: "DE",
	currency: "EUR",
	rates: {
		fullDay: "28.00",
		partialDay: "14.00",
		breakfastDeduction: "5.60",
		lunchDeduction: "11.20",
		dinnerDeduction: "11.20",
	},
	validFrom: "2026-01-01",
	reference:
		"§ 9 Abs. 4a Satz 3 Nr. 1-3 and Satz 8, 10 EStG; BMF letter of 25.11.2020 (BStBl I S. 1228), Rz. 73",
	version: "LStH 2026, Anhang 25 III",
	sources: [ESTG_9, BMF_REISEKOSTEN],
	verifiedOn: "2026-10-06",
};

export const STATUTORY_PER_DIEM_DEFAULTS: readonly StatutoryPerDiemDefault[] = [
	GERMAN_DOMESTIC_PER_DIEM_DEFAULT,
];

export function findStatutoryPerDiemDefault(key: string): StatutoryPerDiemDefault | null {
	return STATUTORY_PER_DIEM_DEFAULTS.find((entry) => entry.key === key) ?? null;
}

/** Whether the default may be adopted from `effectiveFrom` (never before its verified edition). */
export function canAdoptPerDiemDefaultFrom(
	entry: StatutoryPerDiemDefault,
	effectiveFrom: string,
): boolean {
	return comparePlainDates(parsePlainDate(effectiveFrom), parsePlainDate(entry.validFrom)) >= 0;
}
