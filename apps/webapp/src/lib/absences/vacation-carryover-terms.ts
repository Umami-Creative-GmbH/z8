import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { vacationCarryoverTransfer } from "@/db/schema";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";

export function carryoverExpiryInstant(
	year: number,
	months: number | null,
	timezone: string,
): Date | null {
	if (!months) return null;
	const start = Temporal.PlainDate.from({ year, month: 1, day: 1 })
		.add({ months })
		.toZonedDateTime(timezone)
		.toInstant();
	return new Date(start.subtract({ milliseconds: 1 }).epochMilliseconds);
}
/** Presence distinguishes a frozen no-expiry from unknown legacy terms. */
export async function loadFrozenCarryoverTerms(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		year: number;
	},
) {
	if (!input.employeeIds.length)
		return new Map<
			string,
			{
				allowanceId: string | null;
				expiryDate: Date | null;
				expiredAt: Date | null;
				timezone: string;
			}
		>();
	const rows = await database
		.select()
		.from(vacationCarryoverTransfer)
		.where(
			and(
				eq(vacationCarryoverTransfer.organizationId, input.organizationId),
				inArray(vacationCarryoverTransfer.employeeId, [...input.employeeIds]),
				eq(vacationCarryoverTransfer.sourceYear, input.year - 1),
				eq(vacationCarryoverTransfer.outcome, "generated"),
			),
		);
	return new Map(
		rows.map((row) => [
			row.employeeId,
			{
				allowanceId: row.allowanceId,
				expiryDate: row.expiryDate,
				expiredAt: row.expiredAt,
				timezone: row.timezone,
			},
		]),
	);
}
