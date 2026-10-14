"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	listOwnAbsenceChanges,
	requestAbsenceChange,
	withdrawAbsenceChange,
} from "@/lib/absences/change-request-service";
import {
	AbsenceChangeError,
	type AbsenceChangeRequestInput,
	type AbsenceChangeSummary,
} from "@/lib/absences/change-request-types";
import { parseAbsenceChangeInput } from "@/lib/absences/change-request-validation";
import { getRequestSession } from "@/lib/auth/request-session";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import type { ServerActionResult } from "@/lib/effect/result";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createLogger } from "@/lib/logger";
import { monthClosedActionResult } from "@/lib/time-tracking/closed-months/refusal-message";

const logger = createLogger("AbsenceChangeActions");
async function actor() {
	const session = await getRequestSession();
	const organizationId = session?.session.activeOrganizationId;
	if (!session?.user || !organizationId)
		throw new AbsenceChangeError("unauthenticated", "Authentication required");
	const access = await resolveEmployeeOrganizationAccess(db, {
		organizationId,
		userId: session.user.id,
	});
	if (!access.allowed || !access.employeeId)
		throw new AbsenceChangeError("unauthorized", "Employee organization access is required");
	return { organizationId, userId: session.user.id };
}
async function failure(error: unknown): Promise<ServerActionResult<never>> {
	const closed = await monthClosedActionResult(error);
	if (closed) return closed;
	if (error instanceof AbsenceChangeError)
		return { success: false, error: error.message, code: error.code };
	logger.error(
		{ errorName: error instanceof Error ? error.name : "Unknown" },
		"Absence change action failed",
	);
	return {
		success: false,
		error: "Could not save the absence change request. Please try again.",
	};
}
async function mutationActor() {
	const current = await actor();
	if (!isBillingMutationAllowed(await requireBillingForMutation(current.organizationId)))
		throw new AbsenceChangeError("billing_required", "Organization billing access is required");
	return current;
}
export async function submitAbsenceChangeAction(
	input: AbsenceChangeRequestInput,
): Promise<ServerActionResult<{ id: string; workflowId: string }>> {
	try {
		const current = await mutationActor();
		const data = await requestAbsenceChange({
			...parseAbsenceChangeInput(input),
			...current,
		});
		revalidatePath("/[locale]/(app)/absences", "page");
		revalidatePath("/[locale]/(app)/approvals/inbox", "page");
		return { success: true, data };
	} catch (error) {
		return failure(error);
	}
}
export async function withdrawAbsenceChangeAction(
	id: string,
): Promise<ServerActionResult<{ id: string; workflowId: string }>> {
	try {
		const data = await withdrawAbsenceChange({
			...(await mutationActor()),
			id,
		});
		revalidatePath("/[locale]/(app)/absences", "page");
		revalidatePath("/[locale]/(app)/approvals/inbox", "page");
		return { success: true, data };
	} catch (error) {
		return failure(error);
	}
}
export async function getOwnAbsenceChangesAction(): Promise<
	ServerActionResult<AbsenceChangeSummary[]>
> {
	try {
		return { success: true, data: await listOwnAbsenceChanges(await actor()) };
	} catch (error) {
		return failure(error);
	}
}
