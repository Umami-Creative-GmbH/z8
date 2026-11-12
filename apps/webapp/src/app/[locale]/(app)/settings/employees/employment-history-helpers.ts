import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { termsCalendarDate } from "@/lib/employment-history/terms-in-force";
import { createLogger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";

const logger = createLogger("EmploymentHistoryActions");

/**
 * The wage command throws its refusals inside the query; keep their type so
 * users see the refusal, not "Database query failed" (D8).
 */
export function keepTermsRefusal(error: DatabaseError) {
	return error.cause instanceof ValidationError || error.cause instanceof NotFoundError
		? error.cause
		: error;
}

/**
 * Confirmed terms change the contract the work balance counts from: marks it
 * dirty from the terms' first calendar date (D1). Runs after the commit and
 * never throws.
 */
export async function markContractWorkBalanceDirty(
	reader: Parameters<typeof loadOrganizationTimezone>[0],
	input: { employeeId: string; organizationId: string; validFrom: Date },
) {
	try {
		const timezone = await loadOrganizationTimezone(reader, input.organizationId);
		const dirtyFromDate = termsCalendarDate(input.validFrom, timezone).toString();
		await markEmployeeWorkBalanceDirty({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			dirtyFromDate,
		});
	} catch (error) {
		logger.error({ error, ...input }, "Failed to mark work balance dirty after contract change");
	}
}
