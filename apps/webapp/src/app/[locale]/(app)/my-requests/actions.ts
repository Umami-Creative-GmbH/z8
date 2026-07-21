"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cancelAbsenceRequestForExpectedEmployee } from "@/app/[locale]/(app)/absences/cancel-absence-service";
import { absenceEntry, db } from "@/db";
import { cancelPendingTimeCorrection } from "@/lib/approvals/server/time-correction-cancellation";
import { getAuthContext } from "@/lib/auth-helpers";
import { getSelfServiceRequests } from "@/lib/self-service-requests/get-self-service-requests";
import type {
	SelfServiceRequestFilters,
	SelfServiceRequestResult,
} from "@/lib/self-service-requests/types";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANCELLATION_ERROR = "Request could not be cancelled.";

export async function getMyRequests(
	filters?: SelfServiceRequestFilters,
): Promise<
	| {
			success: true;
			data: SelfServiceRequestResult;
	  }
	| {
			success: false;
			error: string;
	  }
> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const data = await getSelfServiceRequests({
			employeeId: authContext.employee.id,
			organizationId: authContext.employee.organizationId,
			filters,
		});

		return { success: true, data };
	} catch {
		return { success: false, error: "Requests could not be loaded." };
	}
}

export async function cancelMyAbsenceRequest(
	absenceId: string,
): Promise<{ success: boolean; error?: string }> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) {
		return { success: false, error: "Employee profile not found" };
	}

	const [absence] = await db
		.select({ id: absenceEntry.id })
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.id, absenceId),
				eq(absenceEntry.organizationId, authContext.employee.organizationId),
				eq(absenceEntry.employeeId, authContext.employee.id),
			),
		)
		.limit(1);

	if (!absence) {
		return { success: false, error: "Absence not found" };
	}

	const result = await cancelAbsenceRequestForExpectedEmployee(absenceId, {
		id: authContext.employee.id,
		organizationId: authContext.employee.organizationId,
	});

	if (result.success) {
		revalidatePath("/my-requests");
		revalidatePath("/absences");
	}

	return result;
}

export async function cancelMyTimeCorrectionRequest(
	workPeriodId: string,
): Promise<{ success: boolean; error?: string }> {
	if (!UUID.test(workPeriodId)) {
		return { success: false, error: CANCELLATION_ERROR };
	}
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;
	if (
		!authContext?.employee ||
		!organizationId ||
		authContext.employee.organizationId !== organizationId
	) {
		return { success: false, error: CANCELLATION_ERROR };
	}
	try {
		await cancelPendingTimeCorrection({
			organizationId,
			requesterEmployeeId: authContext.employee.id,
			requesterUserId: authContext.user.id,
			workPeriodId,
		});
		revalidatePath("/my-requests");
		revalidatePath("/time-tracking");
		return { success: true };
	} catch {
		return { success: false, error: CANCELLATION_ERROR };
	}
}
