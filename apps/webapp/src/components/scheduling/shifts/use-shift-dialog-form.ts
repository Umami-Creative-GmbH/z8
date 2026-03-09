"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useEffect } from "react";
import type { ShiftTemplate, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";

export interface ShiftDialogFormValues {
	employeeId: string | null;
	templateId: string | null;
	subareaId: string;
	date: Date;
	startTime: string;
	endTime: string;
	notes: string;
	color: string | undefined;
}

interface UseShiftDialogFormOptions {
	open: boolean;
	shift: ShiftWithRelations | null;
	templates: ShiftTemplate[];
	defaultDate: Date | null;
	onSubmit: (values: ShiftDialogFormValues) => void;
}

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";

export function getDefaultShiftDialogValues(defaultDate: Date | null): ShiftDialogFormValues {
	return {
		employeeId: null,
		templateId: null,
		subareaId: "",
		date: defaultDate || new Date(),
		startTime: DEFAULT_START_TIME,
		endTime: DEFAULT_END_TIME,
		notes: "",
		color: undefined,
	};
}

export function getShiftDialogValues(shift: ShiftWithRelations): ShiftDialogFormValues {
	return {
		employeeId: shift.employeeId,
		templateId: shift.templateId,
		subareaId: shift.subareaId || "",
		date: new Date(shift.date),
		startTime: shift.startTime,
		endTime: shift.endTime,
		notes: shift.notes || "",
		color: shift.color || undefined,
	};
}

export function getTemplateAutofillValues(
	template: ShiftTemplate | undefined,
	currentSubareaId: string,
): Partial<ShiftDialogFormValues> {
	if (!template) {
		return {};
	}

	return {
		startTime: template.startTime,
		endTime: template.endTime,
		...(template.color ? { color: template.color } : {}),
		...(template.subareaId && !currentSubareaId ? { subareaId: template.subareaId } : {}),
	};
}

export function useShiftDialogForm({
	open,
	shift,
	templates,
	defaultDate,
	onSubmit,
}: UseShiftDialogFormOptions) {
	const form = useForm({
		defaultValues: getDefaultShiftDialogValues(defaultDate),
		onSubmit: async ({ value }) => {
			onSubmit(value);
		},
	});

	const formValues = useStore(form.store, (state) => state.values);

	useEffect(() => {
		if (!open) {
			return;
		}

		const nextValues = shift
			? getShiftDialogValues(shift)
			: getDefaultShiftDialogValues(defaultDate);

		form.setFieldValue("employeeId", nextValues.employeeId);
		form.setFieldValue("templateId", nextValues.templateId);
		form.setFieldValue("subareaId", nextValues.subareaId);
		form.setFieldValue("date", nextValues.date);
		form.setFieldValue("startTime", nextValues.startTime);
		form.setFieldValue("endTime", nextValues.endTime);
		form.setFieldValue("notes", nextValues.notes);
		form.setFieldValue("color", nextValues.color);
	}, [defaultDate, form, open, shift]);

	useEffect(() => {
		const selectedTemplateId = formValues.templateId;
		const selectedSubareaId = formValues.subareaId;

		if (!selectedTemplateId) {
			return;
		}

		const updates = getTemplateAutofillValues(
			templates.find((template) => template.id === selectedTemplateId),
			selectedSubareaId,
		);

		if (updates.startTime) {
			form.setFieldValue("startTime", updates.startTime);
		}
		if (updates.endTime) {
			form.setFieldValue("endTime", updates.endTime);
		}
		if ("color" in updates) {
			form.setFieldValue("color", updates.color);
		}
		if (updates.subareaId) {
			form.setFieldValue("subareaId", updates.subareaId);
		}
	}, [form, formValues.subareaId, formValues.templateId, templates]);

	return {
		form,
		formValues,
	};
}

export type ShiftDialogFormApi = ReturnType<typeof useShiftDialogForm>["form"];
