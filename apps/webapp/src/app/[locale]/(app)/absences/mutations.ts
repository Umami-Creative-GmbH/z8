"use server";

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceEntry, approvalRequest, employeeManagers } from "@/db/schema";
import { canCancelAbsence } from "@/lib/absences/permissions";
import { onApprovedAbsenceCancelledByEmployee } from "@/lib/notifications/triggers";
import { addCalendarSyncJob } from "@/lib/queue";
import { removeCanonicalAbsenceRecord } from "./actions.canonical";
import { getCurrentEmployee } from "./current-employee";

export interface CancelAbsenceEmployeeContext {
	id: string;
	organizationId: string;
}

type AbsenceForCancellation = typeof absenceEntry.$inferSelect & {
	category?: { name: string } | null;
	employee?: { user?: { name?: string | null } | null } | null;
};

async function notifyManagersOfApprovedSelfCancellation(absence: AbsenceForCancellation): Promise<void> {
	try {
		const managerLinks = await db.query.employeeManagers.findMany({
			where: eq(employeeManagers.employeeId, absence.employeeId),
			with: { manager: true },
		});

		for (const link of managerLinks) {
			const managerUserId = link.manager?.userId;
			if (!managerUserId) {
				continue;
			}

			void onApprovedAbsenceCancelledByEmployee({
				absenceId: absence.id,
				managerUserId,
				employeeName: absence.employee?.user?.name ?? "An employee",
				organizationId: absence.organizationId,
				categoryName: absence.category?.name ?? "absence",
				startDate: absence.startDate,
				endDate: absence.endDate,
			});
		}
	} catch {
		// Cancellation must succeed even if manager notification lookup fails.
	}
}

export async function cancelAbsenceRequest(
	absenceId: string,
): Promise<{ success: boolean; error?: string }> {
	return cancelAbsenceRequestForEmployee(absenceId);
}

export async function cancelAbsenceRequestForEmployee(
	absenceId: string,
	currentEmployeeContext?: CancelAbsenceEmployeeContext,
): Promise<{ success: boolean; error?: string }> {
	const currentEmployee = currentEmployeeContext ?? (await getCurrentEmployee());
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const absence = (await db.query.absenceEntry.findFirst({
		where: eq(absenceEntry.id, absenceId),
		with: {
			category: true,
			employee: { with: { user: true } },
		},
	})) as AbsenceForCancellation | undefined;

	if (!absence) {
		return { success: false, error: "Absence not found" };
	}

	if (absence.organizationId !== currentEmployee.organizationId) {
		return { success: false, error: "Absence not found in the active organization" };
	}

	const org = await db.query.organization.findFirst({
		where: (organization, { eq }) => eq(organization.id, absence.organizationId),
		columns: { timezone: true },
	});
	const today =
		DateTime.now().setZone(org?.timezone ?? "UTC").toISODate() ?? DateTime.utc().toISODate() ?? "";

	const canCancel = await canCancelAbsence(currentEmployee.id, absence.employeeId, absence.status, {
		startDate: absence.startDate,
		today,
	});

	if (!canCancel) {
		const isOwnApprovedAbsence =
			absence.status === "approved" && absence.employeeId === currentEmployee.id;

		return {
			success: false,
			error: isOwnApprovedAbsence
				? "Approved absences can only be cancelled before they start"
				: "You do not have permission to cancel this absence",
		};
	}

	const shouldNotifyManagers = absence.status === "approved" && absence.employeeId === currentEmployee.id;

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

	if (shouldNotifyManagers) {
		void notifyManagersOfApprovedSelfCancellation(absence);
	}

	return { success: true };
}
