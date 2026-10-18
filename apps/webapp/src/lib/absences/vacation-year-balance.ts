import type { AbsenceDaysInYear } from "./absence-days";
import type { VacationBalance } from "./types";

/** Why a year's recorded vacation balance cannot be shown; never read as zero. */
export type VacationYearBalanceUnavailableReason =
	| "missing_policy"
	| "conflicting_policy"
	| "read_failed";

/** One calendar year's recorded vacation balance, or why it is unavailable. */
export type VacationYearBalanceEvidence =
	| { year: number; status: "available"; balance: VacationBalance }
	| { year: number; status: "unavailable"; reason: VacationYearBalanceUnavailableReason };

interface VacationYearCharge {
	year: number;
	/** The absence days this request charges to the year. */
	chargedAbsenceDays: number;
	/** The year lies after the evaluation time's year: no carryover or accrual is counted yet. */
	futureYear: boolean;
}

/**
 * What a request does to one calendar year's vacation balance: the recorded remaining balance at
 * the evaluation time and the estimate after the request, or why the balance is unavailable.
 */
export type VacationYearImpact = VacationYearCharge &
	(
		| { status: "available"; remainingDays: number; remainingAfterRequest: number }
		| { status: "unavailable"; reason: VacationYearBalanceUnavailableReason }
	);

/**
 * Each charged year's impact, ascending. A year without evidence is unavailable as a failed read.
 */
export function vacationYearImpacts(input: {
	charges: readonly AbsenceDaysInYear[];
	evidence: readonly VacationYearBalanceEvidence[];
	/** The calendar year of the evaluation time in the organization's zone. */
	currentYear: number;
}): VacationYearImpact[] {
	return input.charges.map(({ year, absenceDays }) => {
		const charge = { year, chargedAbsenceDays: absenceDays, futureYear: year > input.currentYear };
		const evidence = input.evidence.find((entry) => entry.year === year);
		if (!evidence) return { ...charge, status: "unavailable", reason: "read_failed" };
		if (evidence.status === "unavailable")
			return { ...charge, status: "unavailable", reason: evidence.reason };
		return {
			...charge,
			status: "available",
			remainingDays: evidence.balance.remainingDays,
			remainingAfterRequest: evidence.balance.remainingDays - absenceDays,
		};
	});
}

/**
 * The years whose recorded balance the request exceeds. A year with unavailable evidence is never
 * among them: it warns without blocking.
 */
export function overdrawnVacationYears(
	impacts: readonly VacationYearImpact[],
): VacationYearImpact[] {
	return impacts.filter(
		(impact) => impact.status === "available" && impact.remainingAfterRequest < 0,
	);
}
