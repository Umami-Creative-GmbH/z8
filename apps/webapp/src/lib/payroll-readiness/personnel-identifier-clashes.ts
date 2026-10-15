import "server-only";

import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, timeRecord } from "@/db";
import { mapConcurrently } from "@/lib/async/map-concurrently";
import type { PlainDate } from "@/lib/datetime/temporal-core";
import { employeesWithPayoutsOrExpenseLines } from "@/lib/payroll-export/payout-and-expense-employees";
import type { PersonnelIdentifierClash } from "@/lib/payroll-export/personnel-identifier";
import { findPersonnelIdentifierClashes } from "@/lib/payroll-export/personnel-identifier-store";

/**
 * The employees an export of an active configuration would write under one
 * personnel identifier (#1198): the employees the export of the period would
 * carry, those with work or absences and, per format, those with only
 * overtime payouts or payroll-run expense lines. The export is refused for
 * them, so readiness shows the clash as a blocker.
 */
export async function loadPersonnelIdentifierClashes(input: {
	organizationId: string;
	configs: ReadonlyArray<{ formatId: string; config: unknown }>;
	period: { start: Date; end: Date };
	/** The period's first day, as the export's logical start date. */
	from: PlainDate;
	/** The period's last day: custom field identifiers are read as of it, like the export. */
	asOf: PlainDate;
}): Promise<PersonnelIdentifierClash[]> {
	if (input.configs.length === 0) return [];
	const employeesWithRecords = await db
		.selectDistinct({ employeeId: timeRecord.employeeId })
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, input.organizationId),
				lte(timeRecord.startAt, input.period.end),
				or(isNull(timeRecord.endAt), gte(timeRecord.endAt, input.period.start)),
			),
		);
	// The whole organization, as an export without an employee or team selection.
	const filters = {
		dateRange: {
			start: DateTime.fromISO(input.from.toString(), { zone: "utc" }),
			end: DateTime.fromISO(input.asOf.toString(), { zone: "utc" }),
		},
	};
	// Read-only pool queries, with two formats at a time to limit database load.
	const clashes = await mapConcurrently(input.configs, 2, async (config) => {
		const employeeIds = new Set(
			employeesWithRecords.map((row) => row.employeeId),
		);
		const otherRows = await employeesWithPayoutsOrExpenseLines({
			organizationId: input.organizationId,
			formatId: config.formatId,
			filters,
		});
		for (const employeeId of otherRows) employeeIds.add(employeeId);
		return findPersonnelIdentifierClashes(db, {
			organizationId: input.organizationId,
			configs: [config],
			employeeIds: [...employeeIds],
			asOf: input.asOf,
		});
	});
	return clashes.flat();
}
