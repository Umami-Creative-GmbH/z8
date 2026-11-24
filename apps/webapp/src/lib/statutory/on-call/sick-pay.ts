/**
 * What payroll preparation says about an on-call illness's sick pay in the listed period (#1992):
 * the paid days, or why none are owed in it (§ 3 EFZG).
 */
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { OnCallPaidSickDays } from "./reference-period";

export type OnCallSickPayNote =
	| {
			readonly kind: "paid";
			readonly days: number;
			/** The span of continued pay when it covers only part of the illness's days in the period. */
			readonly limitedTo: { readonly from: string; readonly lastDay: string } | null;
	  }
	/** The six weeks (§ 3 Abs. 1 EFZG) ended before the period. */
	| { readonly kind: "exhausted"; readonly lastDay: string }
	/** The claim arises after the period, once four weeks of employment are over (§ 3 Abs. 3 EFZG). */
	| { readonly kind: "waiting"; readonly claimArises: string }
	/** No continued pay is owed for the illness at all. */
	| { readonly kind: "not_owed" };

function dayBefore(date: string): string {
	return parsePlainDate(date).subtract({ days: 1 }).toString();
}

export function sickPayNoteOf(paid: OnCallPaidSickDays): OnCallSickPayNote {
	const span = paid.continuedPay;
	if (span === null) return { kind: "not_owed" };
	if (span.untilExclusive <= paid.from)
		return { kind: "exhausted", lastDay: dayBefore(span.untilExclusive) };
	if (span.from >= paid.untilExclusive) return { kind: "waiting", claimArises: span.from };
	const limited = span.from > paid.from || span.untilExclusive < paid.untilExclusive;
	return {
		kind: "paid",
		days: paid.days,
		limitedTo: limited ? { from: span.from, lastDay: dayBefore(span.untilExclusive) } : null,
	};
}
