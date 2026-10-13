import "server-only";

import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { vacationAllowance } from "@/db/schema";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";

/** A vacation policy (`vacation_allowance` row). */
export type VacationPolicy = typeof vacationAllowance.$inferSelect;

/**
 * The vacation policy of an organization for a calendar year: its active company default in
 * effect on any day of the year, the newest start first. A policy that replaces another mid-year
 * so applies to the whole year. Every vacation balance reader resolves the policy here, so they
 * agree. Team and employee policy assignments are not applied (#989).
 */
export async function loadCompanyDefaultVacationPolicy(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; year: number },
): Promise<VacationPolicy | undefined> {
	const startOfYear = Temporal.PlainDate.from({ year: input.year, month: 1, day: 1 }).toString();
	const endOfYear = Temporal.PlainDate.from({ year: input.year, month: 12, day: 31 }).toString();
	return database.query.vacationAllowance.findFirst({
		where: and(
			eq(vacationAllowance.organizationId, input.organizationId),
			eq(vacationAllowance.isCompanyDefault, true),
			eq(vacationAllowance.isActive, true),
			lte(vacationAllowance.startDate, endOfYear),
			or(isNull(vacationAllowance.validUntil), gte(vacationAllowance.validUntil, startOfYear)),
		),
		orderBy: desc(vacationAllowance.startDate),
	});
}
