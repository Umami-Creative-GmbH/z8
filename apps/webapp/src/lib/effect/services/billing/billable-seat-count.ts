import { type SQL, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { RESERVED_EMAIL_DOMAIN } from "@/lib/auth/reserved-email";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { EMPLOYEE_OFFBOARDING_RELEASE_READY } from "@/lib/employee-lifecycle/release";

type SeatCountDatabase = Pick<typeof rootDatabase, "execute">;

type SeatCountOptions = { requireActiveEmployee?: boolean; now?: Instant };

/** Billable seats by type (#886): kiosk seats belong to kiosk-only employees, full seats to everyone else. */
export type SeatsByType = { full: number; kiosk: number };

/**
 * The billable members of one organization, as a FROM/WHERE clause over
 * `member m`, `"user" u` and `employee e`. See `countBillableSeats`.
 */
function billableSeatsFrom(organizationId: string, options: SeatCountOptions): SQL {
	const requireActiveEmployee = options.requireActiveEmployee ?? EMPLOYEE_OFFBOARDING_RELEASE_READY;
	const at = options.now ? sql`${dateFromInstant(options.now)}::timestamptz` : sql`now()`;
	return sql`
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
	`;
}

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
	options: SeatCountOptions = {},
): Promise<number> {
	const result = await database.execute<{ count: number }>(sql`
		SELECT count(DISTINCT m.id)::integer AS count
		${billableSeatsFrom(organizationId, options)}
	`);
	return Number(result.rows[0]?.count ?? 0);
}

/**
 * The characters JavaScript's `String.prototype.trim` strips (ECMAScript
 * WhiteSpace and LineTerminator), as a PostgreSQL regular expression class.
 */
const TRIMMED_WHITESPACE = String.raw`[\t\n\v\f\r    -     　﻿]`;

/**
 * The SQL form of `isReservedEmail`, which billing-critical seat counts rely on:
 * trimmed as JavaScript trims and lowercased, something before the last "@",
 * then the reserved domain. Kept in agreement by billable-seat-count.integration.test.ts.
 */
export function reservedEmailSql(email: SQL): SQL {
	const trimmed = sql`regexp_replace(${email}, ${`^${TRIMMED_WHITESPACE}+|${TRIMMED_WHITESPACE}+$`}, '', 'g')`;
	return sql`lower(${trimmed}) LIKE ${`_%@${RESERVED_EMAIL_DOMAIN}`}`;
}

/**
 * The same billable seats as `countBillableSeats`, split into kiosk seats (the
 * seat's user has a reserved kiosk-only email, `isReservedEmail`) and full
 * seats (everyone else), so full + kiosk always equals the total. While kiosk
 * seats are off (`kioskSeats: false`), every seat is a full seat.
 */
export async function countBillableSeatsByType(
	database: SeatCountDatabase,
	organizationId: string,
	options: SeatCountOptions & { kioskSeats: boolean },
): Promise<SeatsByType> {
	const reserved = reservedEmailSql(sql`u.email`);
	const result = await database.execute<{ total: number; kiosk: number }>(sql`
		SELECT count(DISTINCT m.id)::integer AS total,
			count(DISTINCT m.id) FILTER (WHERE ${reserved})::integer AS kiosk
		${billableSeatsFrom(organizationId, options)}
	`);
	const total = Number(result.rows[0]?.total ?? 0);
	const kiosk = options.kioskSeats ? Number(result.rows[0]?.kiosk ?? 0) : 0;
	return { full: total - kiosk, kiosk };
}
