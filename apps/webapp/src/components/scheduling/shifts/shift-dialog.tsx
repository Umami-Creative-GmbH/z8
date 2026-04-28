"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef } from "react";
import { toast } from "sonner";
import { deleteShift, upsertShift } from "@/app/[locale]/(app)/scheduling/actions";
import type { ShiftTemplate, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query/keys";
import { ShiftDialogFooterActions, ShiftDialogSections } from "./shift-dialog-sections";
import { useShiftDialogData } from "./use-shift-dialog-data";
import { type ShiftDialogFormValues, useShiftDialogForm } from "./use-shift-dialog-form";

interface ShiftDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shift: ShiftWithRelations | null;
	templates: ShiftTemplate[];
	isManager: boolean;
	defaultDate: Date | null;
	organizationId: string;
}

export function ShiftDialog({
	open,
	onOpenChange,
	shift,
	templates,
	isManager,
	defaultDate,
	organizationId,
}: ShiftDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const qualificationOverrideReasonRef = useRef<HTMLTextAreaElement>(null);

	const isEditing = !!shift;
	const title = isEditing
		? t("scheduling.shiftDialog.editTitle", "Edit Shift")
		: t("scheduling.shiftDialog.createTitle", "Create Shift");
	const description = isEditing
		? t("scheduling.shiftDialog.editDescription", "Update the shift details below")
		: t("scheduling.shiftDialog.createDescription", "Fill in the details for the new shift");

	const upsertMutation = useMutation({
		mutationFn: async (values: ShiftDialogFormValues) => {
			const qualificationOverrideReason = qualificationOverrideReasonRef.current?.value;
			const result = await upsertShift({
				id: shift?.id,
				employeeId: values.employeeId,
				templateId: values.templateId,
				subareaId: values.subareaId,
				date: values.date,
				startTime: values.startTime,
				endTime: values.endTime,
				notes: values.notes,
				color: values.color,
				qualificationOverrideReason: requiresOverride ? qualificationOverrideReason : undefined,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (result) => {
			const warnings: string[] = [];

			if (result.metadata.hasOverlap) {
				warnings.push(
					t("scheduling.shiftDialog.overlapWarning", "Overlaps with {{count}} other shift(s)", {
						count: result.metadata.overlappingShifts.length,
					}),
				);
			}

			if (result.metadata.skillWarning && !result.metadata.skillWarning.isQualified) {
				const missingCount = result.metadata.skillWarning.missingSkills?.length ?? 0;
				const expiredCount = result.metadata.skillWarning.expiredSkills?.length ?? 0;
				if (missingCount > 0 || expiredCount > 0) {
					const parts: string[] = [];
					if (missingCount > 0) {
						parts.push(
							t("scheduling.shiftDialog.missingSkillsWarningPart", "{{count}} missing skill(s)", {
								count: missingCount,
							}),
						);
					}
					if (expiredCount > 0) {
						parts.push(
							t(
								"scheduling.shiftDialog.expiredSkillsWarningPart",
								"{{count}} expired certification(s)",
								{
									count: expiredCount,
								},
							),
						);
					}
					warnings.push(
						t("scheduling.shiftDialog.employeeQualificationWarning", "Employee has {{details}}", {
							details: parts.join(` ${t("scheduling.shiftDialog.and", "and")} `),
						}),
					);
				}
			}

			if (warnings.length > 0) {
				toast.warning(t("scheduling.shiftDialog.savedWithWarnings", "Shift saved with warnings"), {
					description: warnings.join(". "),
				});
			} else {
				toast.success(
					isEditing
						? t("scheduling.shiftDialog.updated", "Shift updated")
						: t("scheduling.shiftDialog.created", "Shift created"),
				);
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(t("scheduling.shiftDialog.saveFailed", "Failed to save shift"), {
				description: error.message,
			});
		},
	});

	const { form, formValues } = useShiftDialogForm({
		open,
		shift,
		templates,
		defaultDate,
		onSubmit: (values) => {
			upsertMutation.mutate(values);
		},
	});

	const { employees, locations, skillValidation, isValidatingSkills } = useShiftDialogData({
		open,
		isManager,
		organizationId,
		employeeId: formValues.employeeId,
		subareaId: formValues.subareaId,
		templateId: formValues.templateId,
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			if (!shift) throw new Error("No shift to delete");
			const result = await deleteShift(shift.id);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("scheduling.shiftDialog.deleted", "Shift deleted"));
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(t("scheduling.shiftDialog.deleteFailed", "Failed to delete shift"), {
				description: error.message,
			});
		},
	});

	const requiresOverride = skillValidation?.requiresOverride ?? false;
	const hasBlockingIssues = skillValidation?.hasBlockingIssues ?? false;
	const isPending = upsertMutation.isPending || deleteMutation.isPending;
	const currentEmployeeId = formValues.employeeId;
	const currentSubareaId = formValues.subareaId;
	const currentTemplateId = formValues.templateId;
	const overrideResetKey = `${open ? "open" : "closed"}-${currentEmployeeId ?? "none"}-${currentSubareaId}-${currentTemplateId ?? "none"}`;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<ShiftDialogSections
						form={form}
						formValues={formValues}
						isManager={isManager}
						templates={templates}
						locations={locations}
						employees={employees}
						skillValidation={skillValidation}
						isValidatingSkills={isValidatingSkills}
						isEditing={isEditing}
						shift={shift}
					/>

					{requiresOverride && (
						<div className="space-y-2">
							<Label htmlFor="qualificationOverrideReason">
								{t("scheduling.shiftDialog.overrideReasonLabel", "Qualification override reason")}
							</Label>
							<Textarea
								key={overrideResetKey}
								id="qualificationOverrideReason"
								ref={qualificationOverrideReasonRef}
								placeholder={t(
									"scheduling.shiftDialog.overrideReasonPlaceholder",
									"Explain why this assignment is acceptable despite qualification warnings.",
								)}
								className="resize-none"
							/>
						</div>
					)}

					<ShiftDialogFooterActions
						key={`${open ? "open" : "closed"}-${shift?.id ?? "new"}`}
						isEditing={isEditing}
						isManager={isManager}
						isPending={isPending}
						isSaving={upsertMutation.isPending}
						isDeleting={deleteMutation.isPending}
						isSaveDisabled={hasBlockingIssues}
						onDelete={deleteMutation.mutate}
						onCancel={() => onOpenChange(false)}
					/>
				</form>
			</DialogContent>
		</Dialog>
	);
}
