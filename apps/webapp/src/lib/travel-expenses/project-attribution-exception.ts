import { Temporal } from "temporal-polyfill";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

/**
 * Authorized, evidenced project attribution exceptions (#605): rules of the
 * input an expense administrator records. Pure, so the form and the server
 * apply the same checks.
 */

export const MAX_EXCEPTION_REASON_LENGTH = 1000;
export const MAX_EXCEPTION_EVIDENCE_LENGTH = 2000;

export interface ProjectAttributionExceptionDraft {
	employeeId: string;
	projectId: string;
	validFrom: string;
	validTo: string;
	reason: string;
	evidence: string;
}

export type ProjectAttributionExceptionError =
	| "valid_from"
	| "valid_to"
	| "date_order"
	/** Exceptions cover past expenses only; today's work is proven by assignments. */
	| "future_dates"
	| "reason"
	| "evidence";

export function parseProjectAttributionExceptionDraft(
	input: ProjectAttributionExceptionDraft,
	today: string,
):
	| { ok: true; draft: ProjectAttributionExceptionDraft }
	| { ok: false; errors: ProjectAttributionExceptionError[] } {
	const errors: ProjectAttributionExceptionError[] = [];
	const date = (value: string) => {
		try {
			return parsePlainDate(value);
		} catch {
			return null;
		}
	};
	const from = date(input.validFrom);
	const to = date(input.validTo);
	if (!from) errors.push("valid_from");
	if (!to) errors.push("valid_to");
	if (from && to && Temporal.PlainDate.compare(to, from) < 0) errors.push("date_order");
	if (to && Temporal.PlainDate.compare(to, parsePlainDate(today)) > 0) errors.push("future_dates");
	const reason = input.reason.trim();
	const evidence = input.evidence.trim();
	if (reason.length === 0 || reason.length > MAX_EXCEPTION_REASON_LENGTH) errors.push("reason");
	if (evidence.length === 0 || evidence.length > MAX_EXCEPTION_EVIDENCE_LENGTH) {
		errors.push("evidence");
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, draft: { ...input, reason, evidence } };
}
