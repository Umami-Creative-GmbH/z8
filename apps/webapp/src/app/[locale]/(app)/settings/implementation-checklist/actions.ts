"use server";

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { implementationChecklistManualState } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistItemId,
	isImplementationChecklistItemId,
} from "@/lib/implementation-checklist/definition";

import {
	type ImplementationChecklistActionResult,
	type ImplementationChecklistViewModel,
	loadImplementationChecklistForContext,
} from "./queries";

export type {
	ImplementationChecklistActionResult,
	ImplementationChecklistViewModel,
} from "./queries";

const IMPLEMENTATION_CHECKLIST_PATH = "/settings/implementation-checklist";
const IMPLEMENTATION_CHECKLIST_MUTATION_ERROR = "Failed to update checklist item.";

type ImplementationChecklistActionFailure = { success: false; error: string };
type ImplementationChecklistQuerySuccess<T> = { success: true; data: T };

type ManualItemValidationResult =
	| ImplementationChecklistQuerySuccess<ImplementationChecklistItemId>
	| ImplementationChecklistActionFailure;

function validateManualItemId(itemId: string): ManualItemValidationResult {
	if (!isImplementationChecklistItemId(itemId)) {
		return { success: false, error: "Unknown implementation checklist item" };
	}

	const item = IMPLEMENTATION_CHECKLIST_ITEMS.find((checklistItem) => checklistItem.id === itemId);

	if (!item?.canManualComplete) {
		return {
			success: false,
			error: "Implementation checklist item cannot be manually completed",
		};
	}

	return { success: true, data: itemId };
}

export async function getImplementationChecklist(): Promise<
	ImplementationChecklistActionResult<ImplementationChecklistViewModel>
> {
	return loadImplementationChecklistForContext(await requireOrgAdminSettingsAccess());
}

export async function markImplementationChecklistItemComplete(
	itemId: string,
): Promise<ImplementationChecklistActionResult<undefined>> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateManualItemId(itemId);

	if (!validation.success) {
		return validation;
	}

	const completedAt = DateTime.utc().toJSDate();

	try {
		await db
			.insert(implementationChecklistManualState)
			.values({
				organizationId,
				itemId: validation.data,
				status: "complete",
				completedAt,
				completedByUserId: authContext.user.id,
			})
			.onConflictDoUpdate({
				target: [
					implementationChecklistManualState.organizationId,
					implementationChecklistManualState.itemId,
				],
				set: {
					status: "complete",
					completedAt,
					completedByUserId: authContext.user.id,
				},
			});
	} catch {
		return { success: false, error: IMPLEMENTATION_CHECKLIST_MUTATION_ERROR };
	}

	revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);

	return { success: true };
}

export async function markImplementationChecklistItemIncomplete(
	itemId: string,
): Promise<ImplementationChecklistActionResult<undefined>> {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateManualItemId(itemId);

	if (!validation.success) {
		return validation;
	}

	try {
		await db
			.delete(implementationChecklistManualState)
			.where(
				and(
					eq(implementationChecklistManualState.organizationId, organizationId),
					eq(implementationChecklistManualState.itemId, validation.data),
				),
			);
	} catch {
		return { success: false, error: IMPLEMENTATION_CHECKLIST_MUTATION_ERROR };
	}

	revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);

	return { success: true };
}
