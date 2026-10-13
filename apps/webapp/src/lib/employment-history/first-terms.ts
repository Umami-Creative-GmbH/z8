import type { EmployeeEmploymentHistory } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { todayInOrganization } from "@/lib/personnel-file/organization-day";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { termsCalendarDate } from "./terms-in-force";
import {
	type TermsWriteClient,
	type TermsWriteScope,
	utcMidnight,
	writeEmploymentTerms,
} from "./write-terms";

/**
 * An employee who starts on an hourly contract with a wage starts with
 * confirmed hourly employment terms (#1178, Organization ADR 0002): the wage
 * lives only in terms, so without them their work earns nothing.
 *
 * The terms are written through the wage command in the caller's transaction,
 * alongside the employee write, so a failed terms write leaves no employee
 * behind. They start on the employee's start date, or on the organization's
 * today without one, and carry the defaults of the terms form. Fixed
 * contracts, and hourly contracts without a wage, get no terms.
 */

/** The terms form defaults (`employee-employment-history/utils.ts`). */
const FIRST_TERMS_DEFAULTS = {
	status: "active",
	weeklyContractMinutes: 40 * 60,
	workModel: "onsite",
	workPolicyId: null,
	currency: "EUR",
	probationStartsOn: null,
	probationEndsOn: null,
	changeReason: null,
} as const;

export type FirstEmploymentTermsInput = TermsWriteScope & {
	contractType: "fixed" | "hourly" | null | undefined;
	hourlyRate: number | null;
	/** The employee's start date; a stored calendar date or an instant (D1). */
	startDate: Date | null | undefined;
};

/** Writes the first terms in the caller's transaction; null when none are due. */
export async function writeFirstEmploymentTerms(
	tx: TermsWriteClient,
	input: FirstEmploymentTermsInput,
): Promise<EmployeeEmploymentHistory | null> {
	if (input.contractType !== "hourly" || input.hourlyRate == null) return null;

	const now = input.now ?? currentTimestamp();
	const timezone = await loadOrganizationTimezone(tx, input.organizationId);
	const firstDay = input.startDate
		? termsCalendarDate(input.startDate, timezone)
		: todayInOrganization(instantFromDate(now), timezone);

	return writeEmploymentTerms(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.actorUserId,
		now,
		terms: {
			...FIRST_TERMS_DEFAULTS,
			validFrom: utcMidnight(firstDay),
			contractType: "hourly",
			hourlyRate: input.hourlyRate,
			reviewState: "confirmed",
		},
	});
}
