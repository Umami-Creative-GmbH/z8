"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import {
	confirmImplementationChecklistItem,
	unconfirmImplementationChecklistItem,
} from "@/lib/implementation-checklist/confirmation/store";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistItemId,
	isImplementationChecklistItemId,
} from "@/lib/implementation-checklist/definition";
import { createLogger } from "@/lib/logger";

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
const logger = createLogger("ImplementationChecklist");

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

	try {
		await confirmImplementationChecklistItem(db, {
			organizationId,
			itemId: validation.data,
			actorUserId: authContext.user.id,
			confirmedAt: dateFromInstant(systemClock.nowInstant()),
		});
	} catch (error) {
		logger.error({ organizationId, itemId, error }, "Could not confirm checklist item");
		return { success: false, error: IMPLEMENTATION_CHECKLIST_MUTATION_ERROR };
	}

	revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);

	return { success: true };
}

export async function markImplementationChecklistItemIncomplete(
	itemId: string,
): Promise<ImplementationChecklistActionResult<undefined>> {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();
	const validation = validateManualItemId(itemId);

	if (!validation.success) {
		return validation;
	}

	try {
		await unconfirmImplementationChecklistItem(db, {
			organizationId,
			itemId: validation.data,
			actorUserId: authContext.user.id,
		});
	} catch (error) {
		logger.error({ organizationId, itemId, error }, "Could not unconfirm checklist item");
		return { success: false, error: IMPLEMENTATION_CHECKLIST_MUTATION_ERROR };
	}

	revalidatePath(IMPLEMENTATION_CHECKLIST_PATH);

	return { success: true };
}
