"use server";

import { Effect } from "effect";
import { ShiftService } from "@/lib/effect/services/shift.service";
import type { CreateTemplateInput, ShiftTemplate, UpdateTemplateInput } from "../types";
import {
	requireCurrentEmployee,
	requireManagerEmployee,
	runSchedulingAction,
	type SchedulingActionResult,
} from "./shared";

export async function createShiftTemplate(
	input: CreateTemplateInput,
): Promise<SchedulingActionResult<ShiftTemplate>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		const { currentEmployee, session } = yield* _(
			requireManagerEmployee({
				resource: "shiftTemplate",
				action: "create",
				message: "Only managers and admins can create shift templates",
			}),
		);

		return yield* _(
			shiftService.createTemplate({
				organizationId: currentEmployee.organizationId,
				name: input.name,
				startTime: input.startTime,
				endTime: input.endTime,
				color: input.color,
				subareaId: input.subareaId,
				createdBy: session.user.id,
			}),
		);
	});

	return runSchedulingAction("createShiftTemplate", effect);
}

export async function updateShiftTemplate(
	id: string,
	input: UpdateTemplateInput,
): Promise<SchedulingActionResult<ShiftTemplate>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		yield* _(
			requireManagerEmployee({
				resource: "shiftTemplate",
				action: "update",
				message: "Only managers and admins can update shift templates",
			}),
		);

		return yield* _(shiftService.updateTemplate(id, input));
	});

	return runSchedulingAction("updateShiftTemplate", effect);
}

export async function deleteShiftTemplate(id: string): Promise<SchedulingActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		yield* _(
			requireManagerEmployee({
				resource: "shiftTemplate",
				action: "delete",
				message: "Only managers and admins can delete shift templates",
			}),
		);

		yield* _(shiftService.deleteTemplate(id));
	});

	return runSchedulingAction("deleteShiftTemplate", effect);
}

export async function getShiftTemplates(): Promise<SchedulingActionResult<ShiftTemplate[]>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		const { currentEmployee } = yield* _(requireCurrentEmployee());

		return yield* _(shiftService.getTemplates(currentEmployee.organizationId));
	});

	return runSchedulingAction("getShiftTemplates", effect);
}
