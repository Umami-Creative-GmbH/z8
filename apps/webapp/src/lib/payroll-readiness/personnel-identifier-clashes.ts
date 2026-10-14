import "server-only";

import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db, timeRecord } from "@/db";
import type { PlainDate } from "@/lib/datetime/temporal-core";
import type { PersonnelIdentifierClash } from "@/lib/payroll-export/personnel-identifier";
import { findPersonnelIdentifierClashes } from "@/lib/payroll-export/personnel-identifier-store";

/**
 * The employees with work or absences in the period that an export of an
 * active configuration would write under one personnel identifier (#1198).
 * The export is refused for them, so readiness shows the clash as a blocker.
 */
export async function loadPersonnelIdentifierClashes(input: {
	organizationId: string;
	configs: ReadonlyArray<{ formatId: string; config: unknown }>;
	period: { start: Date; end: Date };
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
	return findPersonnelIdentifierClashes(db, {
		organizationId: input.organizationId,
		configs: input.configs,
		employeeIds: employeesWithRecords.map((row) => row.employeeId),
		asOf: input.asOf,
	});
}
