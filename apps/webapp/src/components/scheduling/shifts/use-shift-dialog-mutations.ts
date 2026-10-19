"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { deleteShift, upsertShift } from "@/app/[locale]/(app)/scheduling/actions";
import type { ShiftMetadata } from "@/app/[locale]/(app)/scheduling/types";
import { queryKeys } from "@/lib/query/keys";
import { SKILL_OVERRIDE_REASON_REQUIRED } from "@/lib/scheduling/skill-override-refusal";
import type { ShiftDialogFormValues } from "./use-shift-dialog-form";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The server wants a skill override reason for this assignment context (#893). */
class SkillOverrideReasonRequired extends Error {
	constructor(readonly assignmentContext: string) {
		super("Skill override reason required");
	}
}

export function assignmentContextOf(
	values: Pick<ShiftDialogFormValues, "employeeId" | "date" | "subareaId" | "templateId">,
) {
	return [
		values.employeeId ?? "",
		values.date ?? "",
		values.subareaId ?? "",
		values.templateId ?? "",
	].join("|");
}

/** The warnings a saved shift carries: overlaps and missing or expired skills. */
function shiftSaveWarnings(metadata: ShiftMetadata, t: Translate): string[] {
	const warnings: string[] = [];

	if (metadata.hasOverlap) {
		warnings.push(`Overlaps with ${metadata.overlappingShifts.length} other shift(s)`);
	}

	// A warning comes with any missing or expired skill, optional ones included.
	if (metadata.skillWarning) {
		const missingCount = metadata.skillWarning.missingSkills?.length ?? 0;
		const expiredCount = metadata.skillWarning.expiredSkills?.length ?? 0;
		if (missingCount > 0 || expiredCount > 0) {
			const parts: string[] = [];
			if (missingCount > 0) parts.push(`${missingCount} missing skill(s)`);
			if (expiredCount > 0) parts.push(`${expiredCount} expired certification(s)`);
			warnings.push(`Employee has ${parts.join(" and ")}`);
		}
		// Only that a skill certificate is on file, never its content (#1144).
		const withCertificate = metadata.skillWarning.expiredSkills
			.filter((skill) => skill.certificateOnFile)
			.map((skill) => skill.name);
		if (withCertificate.length > 0) {
			warnings.push(
				t(
					"scheduling:scheduling.shiftDialog.certificateOnFileFor",
					"Certificate on file: {skills}",
					{
						skills: withCertificate.join(", "),
					},
				),
			);
		}
	}

	return warnings;
}

/** Saves the shift; a refusal for want of a skill override reason is reported, not toasted. */
export function useShiftUpsertMutation({
	shiftId,
	isEditing,
	onSaved,
	onReasonRefused,
}: {
	shiftId: string | undefined;
	isEditing: boolean;
	onSaved: () => void;
	onReasonRefused: (assignmentContext: string) => void;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (values: ShiftDialogFormValues) => {
			const result = await upsertShift({
				id: shiftId,
				employeeId: values.employeeId,
				templateId: values.templateId,
				subareaId: values.subareaId,
				date: values.date,
				startTime: values.startTime,
				endTime: values.endTime,
				notes: values.notes,
				color: values.color,
				skillOverrideReason: values.skillOverrideReason?.trim() || undefined,
			});
			if (!result.success) {
				if (result.refusal === SKILL_OVERRIDE_REASON_REQUIRED) {
					throw new SkillOverrideReasonRequired(assignmentContextOf(values));
				}
				throw new Error(result.error);
			}
			return result.data;
		},
		onSuccess: (result) => {
			const warnings = shiftSaveWarnings(result.metadata, t);

			if (warnings.length > 0) {
				toast.warning(
					t("scheduling:scheduling.shiftDialog.savedWithWarnings", "Shift saved with warnings"),
					{
						description: warnings.join(". "),
					},
				);
			} else {
				toast.success(
					isEditing
						? t("scheduling:scheduling.shiftDialog.updated", "Shift updated")
						: t("scheduling:scheduling.shiftDialog.created", "Shift created"),
				);
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			onSaved();
		},
		onError: (error) => {
			// Not a failure: the dialog asks for the reason next to the skill warning.
			if (error instanceof SkillOverrideReasonRequired) {
				onReasonRefused(error.assignmentContext);
				return;
			}
			toast.error(t("scheduling:scheduling.shiftDialog.saveFailed", "Failed to save shift"), {
				description: error.message,
			});
		},
	});
}

export function useShiftDeleteMutation({
	shiftId,
	onDeleted,
}: {
	shiftId: string | undefined;
	onDeleted: () => void;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			if (!shiftId) throw new Error("No shift to delete");
			const result = await deleteShift(shiftId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("scheduling:scheduling.shiftDialog.deleted", "Shift deleted"));
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			onDeleted();
		},
		onError: (error) => {
			toast.error(t("scheduling:scheduling.shiftDialog.deleteFailed", "Failed to delete shift"), {
				description: error.message,
			});
		},
	});
}
