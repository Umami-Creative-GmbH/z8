import { sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { EMPLOYEE_OFFBOARDING_RELEASE_READY } from "@/lib/employee-lifecycle/release";

type SeatCountDatabase = Pick<typeof rootDatabase, "execute">;

/**
 * The single billable-seat definition for checkout, enforcement, subscription
 * counts and seat sync: distinct approved members, excluding demo accounts,
 * never an employee whose employment an effective departure ended, nor one
 * past the cutoff of a due departure that would take effect (a departure the
 * executor would block stays billable). Once the offboarding workflow is
 * released a seat also requires an effectively active employee profile;
 * before that, the existing member policy applies.
 *
 * Read-only: it evaluates due departures the same way access checks do and
 * never triggers billing itself.
 */
export async function countBillableSeats(
	database: SeatCountDatabase,
	organizationId: string,
	options: { requireActiveEmployee?: boolean; now?: Instant } = {},
): Promise<number> {
	const requireActiveEmployee = options.requireActiveEmployee ?? EMPLOYEE_OFFBOARDING_RELEASE_READY;
	const at = options.now ? sql`${dateFromInstant(options.now)}::timestamptz` : sql`now()`;
	const result = await database.execute<{ count: number }>(sql`
		SELECT count(DISTINCT m.id)::integer AS count
		FROM member m
		JOIN "user" u ON u.id = m.user_id
		LEFT JOIN employee e ON e.user_id = m.user_id AND e.organization_id = m.organization_id
		WHERE m.organization_id = ${organizationId}
			AND m.status = 'approved'
			AND u.email NOT LIKE '%@demo.invalid'
			AND (
				e.id IS NULL
				OR (
					NOT employee_employment_ended_without_rehire(m.organization_id, e.id)
					AND NOT employee_departure_denies_access(m.organization_id, e.id, ${at})
				)
			)
			AND (
				NOT ${requireActiveEmployee}
				OR (e.id IS NOT NULL AND e.is_active = true)
			)
	`);
	return Number(result.rows[0]?.count ?? 0);
}
