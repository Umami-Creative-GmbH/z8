import { acquireExclusiveOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction";
import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { absenceChangeRequest, type absenceEntry, auditLog } from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import type { AbsenceChangeOriginal } from "./change-request-types";
export type AbsenceChangeDatabase = typeof db;
export type AbsenceChangeRow = typeof absenceChangeRequest.$inferSelect;

export function originalAbsence(
	row: typeof absenceEntry.$inferSelect,
	canonical: AbsenceChangeOriginal["canonical"],
): AbsenceChangeOriginal {
	return {
		categoryId: row.categoryId,
		canonicalRecordId: row.canonicalRecordId,
		startDate: row.startDate,
		endDate: row.endDate,
		startPeriod: row.startPeriod,
		endPeriod: row.endPeriod,
		updatedAt: instantFromDate(row.updatedAt).toString(),
		canonical,
	};
}

export async function loadChangeRequest(
	database: AbsenceChangeDatabase,
	organizationId: string,
	id: string,
) {
	await acquireExclusiveOrganizationConfigurationGuard(
		database,
		organizationId,
	);
	const [row] = await database
		.select()
		.from(absenceChangeRequest)
		.where(
			and(
				eq(absenceChangeRequest.organizationId, organizationId),
				eq(absenceChangeRequest.id, id),
			),
		)
		.for("update");
	return row;
}

export async function auditAbsenceChange(
	database: AbsenceChangeDatabase,
	input: {
		row: AbsenceChangeRow;
		actorUserId: string;
		action: string;
		at: Instant;
	},
) {
	await database.insert(auditLog).values({
		organizationId: input.row.organizationId,
		entityType: "absence_change_request",
		entityId: input.row.id,
		employeeId: input.row.employeeId,
		performedBy: input.actorUserId,
		action: `absence_change.${input.action}`,
		changes: JSON.stringify({
			original: input.row.original,
			proposed: input.row.proposed,
			kind: input.row.kind,
			reason: input.row.reason,
		}),
		timestamp: dateFromInstant(input.at),
	});
}
