import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";

/** Routine anchors and date-only limits always use the authorization's fixed calendar zone. */
export function drivingAuthorizationDeadline(input: {
	successfulAt: Instant;
	intervalMonths: number;
	timezone: string;
	documentValidThrough: string;
	classValidThrough: string | null;
}) {
	const routineValidThrough = input.successfulAt
		.toZonedDateTimeISO(input.timezone)
		.toPlainDate()
		.add({ months: input.intervalMonths })
		.toString();
	const validThrough = [
		routineValidThrough,
		input.documentValidThrough,
		input.classValidThrough,
	]
		.filter((value): value is string => value !== null)
		.sort()[0];
	const expires = Temporal.PlainDate.from(validThrough)
		.add({ days: 1 })
		.toZonedDateTime({ timeZone: input.timezone, plainTime: "00:00" })
		.toInstant();
	return { routineValidThrough, validThrough, expires };
}

/** A verifier grant's until date covers that whole day in the calendar zone; access ends at the next midnight. */
export function verifierGrantExpiry(until: string, timezone: string): Instant {
	return Temporal.PlainDate.from(until)
		.add({ days: 1 })
		.toZonedDateTime({ timeZone: timezone, plainTime: "00:00" })
		.toInstant();
}

/** The last calendar day a grant expiring at `expiresAt` still covers (exclusive expiry). */
export function verifierGrantUntil(expiresAt: Instant, timezone: string): string {
	return expiresAt
		.subtract({ nanoseconds: 1 })
		.toZonedDateTimeISO(timezone)
		.toPlainDate()
		.toString();
}
