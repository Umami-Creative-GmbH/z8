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
 * Each charged year's impact, ascending. A year the request charges nothing is left out, so its
 * balance evidence never matters; a charged year without evidence is unavailable as a failed read.
 */
export function vacationYearImpacts(input: {
	charges: readonly AbsenceDaysInYear[];
	evidence: readonly VacationYearBalanceEvidence[];
	/** The calendar year of the evaluation time in the organization's zone. */
	currentYear: number;
}): VacationYearImpact[] {
	return input.charges.flatMap(({ year, absenceDays }): VacationYearImpact[] => {
		if (absenceDays <= 0) return [];
		const charge = { year, chargedAbsenceDays: absenceDays, futureYear: year > input.currentYear };
		const evidence = input.evidence.find((entry) => entry.year === year);
		if (!evidence) return [{ ...charge, status: "unavailable", reason: "read_failed" }];
		if (evidence.status === "unavailable")
			return [{ ...charge, status: "unavailable", reason: evidence.reason }];
		return [
			{
				...charge,
				status: "available",
				remainingDays: evidence.balance.remainingDays,
				remainingAfterRequest: evidence.balance.remainingDays - absenceDays,
			},
		];
	});
}

/**
 * Whether the request takes more from this year than its recorded remaining balance. A year with
 * unavailable evidence never does: it warns without blocking. (Not "overdrawn vacation", which is
 * vacation already taken beyond the allowance.)
 */
export function exceedsYearBalance(impact: VacationYearImpact): boolean {
	return impact.status === "available" && impact.remainingAfterRequest < 0;
}

/** The years whose recorded remaining balance the request exceeds. */
export function yearsExceedingBalance(
	impacts: readonly VacationYearImpact[],
): VacationYearImpact[] {
	return impacts.filter(exceedsYearBalance);
}
