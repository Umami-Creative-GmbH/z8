import { and, eq, gt, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { complianceException } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";

/** The `compliance_exception` table, or an alias of it in a hand-written query. */
export interface ComplianceExceptionStatusColumns {
	status: PgColumn;
	validUntil: PgColumn;
}

/**
 * Matches the compliance exceptions still awaiting a decision at `now`: pending, with their
 * 24-hour validity window still open. Once `valid_until` passes, the Approval inbox lists an
 * exception as expired, so counts and lists that link there must leave it out too (#1977).
 *
 * Pass `exception` to match through an alias (`alias(complianceException, "exception")`); an
 * `update compliance_exception` matches through the table itself, the default.
 */
export function awaitingComplianceExceptionDecision(
	now: Instant,
	exception: ComplianceExceptionStatusColumns = complianceException,
): SQL {
	// `and` of two defined conditions is always one: it is only `undefined` for none.
	return and(
		eq(exception.status, "pending"),
		gt(exception.validUntil, dateFromInstant(now)),
	) as SQL;
}
