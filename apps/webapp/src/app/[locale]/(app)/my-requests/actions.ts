"use server";

import { revalidatePath } from "next/cache";
import { cancelAbsenceRequestForEmployee } from "@/app/[locale]/(app)/absences/actions";
import { getAuthContext } from "@/lib/auth-helpers";
import { getSelfServiceRequests } from "@/lib/self-service-requests/get-self-service-requests";
import type {
	SelfServiceRequestFilters,
	SelfServiceRequestResult,
} from "@/lib/self-service-requests/types";

export async function getMyRequests(filters?: SelfServiceRequestFilters): Promise<
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

	const result = await cancelAbsenceRequestForEmployee(absenceId, {
		id: authContext.employee.id,
		organizationId: authContext.employee.organizationId,
	});

	if (result.success) {
		revalidatePath("/my-requests");
		revalidatePath("/absences");
	}

	return result;
}
