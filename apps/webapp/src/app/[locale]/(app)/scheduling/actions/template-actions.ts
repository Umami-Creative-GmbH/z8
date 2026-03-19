"use server";

import { Effect } from "effect";
import { ShiftService } from "@/lib/effect/services/shift.service";
import {
	canManageScopedSchedulingSubarea,
	filterItemsToManageableSubareas,
	getSchedulingSettingsAccessContext,
	getShiftTemplateScopeTarget,
} from "@/lib/settings-scheduling-access";
import type { CreateTemplateInput, ShiftTemplate, UpdateTemplateInput } from "../types";
import { runSchedulingAction, type SchedulingActionResult } from "./shared";

export async function createShiftTemplate(
	input: CreateTemplateInput,
): Promise<SchedulingActionResult<ShiftTemplate>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessShiftTemplates) {
		return { success: false, error: "Unauthorized" };
	}

	if (
		!canManageScopedSchedulingSubarea(
			accessContext.accessTier,
			accessContext.manageableShiftTemplateSubareaIds,
			input.subareaId,
		)
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);

		return yield* _(
			shiftService.createTemplate({
				organizationId: accessContext.organizationId,
				name: input.name,
				startTime: input.startTime,
				endTime: input.endTime,
				color: input.color,
				subareaId: input.subareaId,
				createdBy: accessContext.authContext.user.id,
			}),
		);
	});

	return runSchedulingAction("createShiftTemplate", effect);
}

export async function updateShiftTemplate(
	id: string,
	input: UpdateTemplateInput,
): Promise<SchedulingActionResult<ShiftTemplate>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessShiftTemplates) {
		return { success: false, error: "Unauthorized" };
	}

	const existingTemplate = await getShiftTemplateScopeTarget(id);
	if (!existingTemplate) {
		return { success: false, error: "Shift template not found" };
	}

	if (existingTemplate.organizationId !== accessContext.organizationId) {
		return { success: false, error: "Unauthorized" };
	}

	const nextSubareaId = input.subareaId !== undefined ? input.subareaId : existingTemplate.subareaId;
	if (
		!canManageScopedSchedulingSubarea(
			accessContext.accessTier,
			accessContext.manageableShiftTemplateSubareaIds,
			nextSubareaId,
		)
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);

		return yield* _(shiftService.updateTemplate(id, input));
	});

	return runSchedulingAction("updateShiftTemplate", effect);
}

export async function deleteShiftTemplate(id: string): Promise<SchedulingActionResult<void>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessShiftTemplates) {
		return { success: false, error: "Unauthorized" };
	}

	const existingTemplate = await getShiftTemplateScopeTarget(id);
	if (!existingTemplate) {
		return { success: false, error: "Shift template not found" };
	}

	if (existingTemplate.organizationId !== accessContext.organizationId) {
		return { success: false, error: "Unauthorized" };
	}

	if (
		!canManageScopedSchedulingSubarea(
			accessContext.accessTier,
			accessContext.manageableShiftTemplateSubareaIds,
			existingTemplate.subareaId,
		)
	) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);

		yield* _(shiftService.deleteTemplate(id));
	});

	return runSchedulingAction("deleteShiftTemplate", effect);
}

export async function getShiftTemplates(): Promise<SchedulingActionResult<ShiftTemplate[]>> {
	const accessContext = await getSchedulingSettingsAccessContext();
	if (!accessContext || !accessContext.canAccessShiftTemplates) {
		return { success: false, error: "Unauthorized" };
	}

	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);

		return yield* _(shiftService.getTemplates(accessContext.organizationId));
	});

	const result = await runSchedulingAction("getShiftTemplates", effect);
	if (!result.success) {
		return result;
	}

	return {
		success: true,
		data: filterItemsToManageableSubareas(
			result.data,
			accessContext.manageableShiftTemplateSubareaIds,
		),
	};
}
