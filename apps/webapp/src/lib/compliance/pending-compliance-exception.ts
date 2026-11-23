import { and, eq, gt } from "drizzle-orm";
import { complianceException } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";

/**
 * Matches the compliance exceptions still awaiting a decision at `now`: pending, with their
 * 24-hour validity window still open. Once `valid_until` passes, the Approval inbox lists an
 * exception as expired, so counts and lists that link there must leave it out too (#1977).
 */
export function awaitingComplianceExceptionDecision(now: Instant) {
	return and(
		eq(complianceException.status, "pending"),
		gt(complianceException.validUntil, dateFromInstant(now)),
	);
}
