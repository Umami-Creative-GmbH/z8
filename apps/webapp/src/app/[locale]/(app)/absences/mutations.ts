"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { absenceEntry, approvalRequest } from "@/db/schema";
import { canCancelAbsence } from "@/lib/absences/permissions";
import { addCalendarSyncJob } from "@/lib/queue";
import { removeCanonicalAbsenceRecord } from "./actions.canonical";
import { getCurrentEmployee } from "./current-employee";

export async function cancelAbsenceRequest(
	absenceId: string,
): Promise<{ success: boolean; error?: string }> {
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const absence = await db.query.absenceEntry.findFirst({
		where: eq(absenceEntry.id, absenceId),
	});

	if (!absence) {
		return { success: false, error: "Absence not found" };
	}

	const canCancel = await canCancelAbsence(currentEmployee.id, absence.employeeId, absence.status);

	if (!canCancel) {
		return {
			success: false,
			error: "You do not have permission to cancel this absence",
		};
	}

	void addCalendarSyncJob({
		absenceId,
		employeeId: absence.employeeId,
		action: "delete",
	});

	if (!absence.organizationId) {
		return { success: false, error: "Absence organization not found" };
	}

	await removeCanonicalAbsenceRecord({
		organizationId: absence.organizationId,
		canonicalRecordId: absence.canonicalRecordId,
	});

	await db.delete(absenceEntry).where(eq(absenceEntry.id, absenceId));

	await db
		.delete(approvalRequest)
		.where(
			and(eq(approvalRequest.entityType, "absence_entry"), eq(approvalRequest.entityId, absenceId)),
		);

	return { success: true };
}
