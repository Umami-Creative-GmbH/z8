"use client";

import { useTranslate } from "@tolgee/react";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import type { ShiftTemplateLocations } from "./shift-template-management-controller";

/** The form values a create or edit opens with. */
export function getShiftTemplateFormDefaults(
	template: ShiftTemplate | null,
	requireScopedSubareaSelection: boolean,
	defaultSubareaId: string | undefined,
) {
	const scopedDefaultSubareaId = requireScopedSubareaSelection
		? defaultSubareaId || ""
		: "";
	return {
		name: template?.name || "",
		startTime: template?.startTime || "09:00",
		endTime: template?.endTime || "17:00",
		color: template?.color || "#3b82f6",
		subareaId: template?.subareaId || scopedDefaultSubareaId,
	};
}

export function useShiftTemplateSubareaOptions(
	locations: ShiftTemplateLocations,
) {
	const { t } = useTranslate();

	const defaultSubareaId = locations
		.flatMap((location) => location.subareas)
		.find((subarea) => subarea.isActive)?.id;

	const subareaDisplayById = new Map<string, string>();
	for (const location of locations) {
		for (const subarea of location.subareas) {
			if (!subareaDisplayById.has(subarea.id)) {
				subareaDisplayById.set(
					subarea.id,
					t(
						"settings.shiftTemplates.form.subareaFormat",
						"{location} – {subarea}",
						{
							location: location.name,
							subarea: subarea.name,
						},
					),
				);
			}
		}
	}

	const getSubareaDisplay = (subareaId: string) => {
		return subareaDisplayById.get(subareaId) ?? "";
	};

	return { defaultSubareaId, getSubareaDisplay };
}
