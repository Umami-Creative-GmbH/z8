"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useEffect } from "react";
import { Temporal } from "temporal-polyfill";
import type { ShiftTemplate, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";

export interface ShiftDialogFormValues {
	employeeId: string | null;
	templateId: string | null;
	subareaId: string;
	date: string;
	startTime: string;
	endTime: string;
	notes: string;
	color: string | undefined;
}

interface UseShiftDialogFormOptions {
	open: boolean;
	shift: ShiftWithRelations | null;
	templates: ShiftTemplate[];
	defaultDate: string | null;
	organizationTimezone: string;
	onSubmit: (values: ShiftDialogFormValues) => void;
}

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";

export function getDefaultShiftDialogValues(
	defaultDate: string | null,
	organizationTimezone = "UTC",
	now = Temporal.Now.instant().toString(),
): ShiftDialogFormValues {
	return {
		employeeId: null,
		templateId: null,
		subareaId: "",
		date:
			defaultDate ||
			Temporal.Instant.from(now).toZonedDateTimeISO(organizationTimezone).toPlainDate().toString(),
		startTime: DEFAULT_START_TIME,
		endTime: DEFAULT_END_TIME,
		notes: "",
		color: undefined,
	};
}

export function getShiftDialogValues(
	shift: ShiftWithRelations,
	organizationTimezone: string,
): ShiftDialogFormValues {
	return {
		employeeId: shift.employeeId,
		templateId: shift.templateId,
		subareaId: shift.subareaId || "",
		date: Temporal.Instant.fromEpochMilliseconds(shift.date.getTime())
			.toZonedDateTimeISO(organizationTimezone)
			.toPlainDate()
			.toString(),
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
	organizationTimezone,
	onSubmit,
}: UseShiftDialogFormOptions) {
	const form = useForm({
		defaultValues: getDefaultShiftDialogValues(defaultDate, organizationTimezone),
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
			? getShiftDialogValues(shift, organizationTimezone)
			: getDefaultShiftDialogValues(defaultDate, organizationTimezone);

		form.setFieldValue("employeeId", nextValues.employeeId);
		form.setFieldValue("templateId", nextValues.templateId);
		form.setFieldValue("subareaId", nextValues.subareaId);
		form.setFieldValue("date", nextValues.date);
		form.setFieldValue("startTime", nextValues.startTime);
		form.setFieldValue("endTime", nextValues.endTime);
		form.setFieldValue("notes", nextValues.notes);
		form.setFieldValue("color", nextValues.color);
	}, [defaultDate, form, open, organizationTimezone, shift]);

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
