"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteShift, upsertShift } from "@/app/[locale]/(app)/scheduling/actions";
import type { ShiftTemplate, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { queryKeys } from "@/lib/query/keys";
import { SKILL_OVERRIDE_REASON_REQUIRED } from "@/lib/scheduling/skill-override-refusal";
import { ShiftDialogFooterActions, ShiftDialogSections } from "./shift-dialog-sections";
import { useShiftDialogData } from "./use-shift-dialog-data";
import { type ShiftDialogFormValues, useShiftDialogForm } from "./use-shift-dialog-form";
import { getStaffingShiftInput, useStaffingSuggestions } from "./use-staffing-suggestions";

/** The server wants a skill override reason for this assignment context (#893). */
class SkillOverrideReasonRequired extends Error {
	constructor(readonly assignmentContext: string) {
		super("Skill override reason required");
	}
}

function assignmentContextOf(
	values: Pick<ShiftDialogFormValues, "employeeId" | "date" | "subareaId" | "templateId">,
) {
	return [
		values.employeeId ?? "",
		values.date ?? "",
		values.subareaId ?? "",
		values.templateId ?? "",
	].join("|");
}

interface ShiftDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shift: ShiftWithRelations | null;
	templates: ShiftTemplate[];
	isManager: boolean;
	defaultDate: string | null;
	organizationId: string;
	organizationTimezone: string;
}

export function ShiftDialog({
	open,
	onOpenChange,
	shift,
	templates,
	isManager,
	defaultDate,
	organizationId,
	organizationTimezone,
}: ShiftDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const isEditing = !!shift;
	const title = isEditing
		? t("scheduling:scheduling.shiftDialog.editTitle", "Edit Shift")
		: t("scheduling:scheduling.shiftDialog.createTitle", "Create Shift");
	const description = isEditing
		? t("scheduling:scheduling.shiftDialog.editDescription", "Update the shift details below")
		: t(
				"scheduling:scheduling.shiftDialog.createDescription",
				"Fill in the details for the new shift",
			);

	// The assignment context the server last refused for want of a skill override reason (#893).
	const [reasonRefusedFor, setReasonRefusedFor] = useState<string | null>(null);
	const handleOpenChange = (next: boolean) => {
		if (!next) setReasonRefusedFor(null);
		onOpenChange(next);
	};

	const upsertMutation = useMutation({
		mutationFn: async (values: ShiftDialogFormValues) => {
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
			const warnings: string[] = [];

			if (result.metadata.hasOverlap) {
				warnings.push(`Overlaps with ${result.metadata.overlappingShifts.length} other shift(s)`);
			}

			// A warning comes with any missing or expired skill, optional ones included.
			if (result.metadata.skillWarning) {
				const missingCount = result.metadata.skillWarning.missingSkills?.length ?? 0;
				const expiredCount = result.metadata.skillWarning.expiredSkills?.length ?? 0;
				if (missingCount > 0 || expiredCount > 0) {
					const parts: string[] = [];
					if (missingCount > 0) parts.push(`${missingCount} missing skill(s)`);
					if (expiredCount > 0) parts.push(`${expiredCount} expired certification(s)`);
					warnings.push(`Employee has ${parts.join(" and ")}`);
				}
				// Only that a skill certificate is on file, never its content (#1144).
				const withCertificate = result.metadata.skillWarning.expiredSkills
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
			handleOpenChange(false);
		},
		onError: (error) => {
			// Not a failure: the dialog asks for the reason next to the skill warning.
			if (error instanceof SkillOverrideReasonRequired) {
				setReasonRefusedFor(error.assignmentContext);
				return;
			}
			toast.error(t("scheduling:scheduling.shiftDialog.saveFailed", "Failed to save shift"), {
				description: error.message,
			});
		},
	});

	const { form, formValues } = useShiftDialogForm({
		open,
		shift,
		templates,
		defaultDate,
		organizationTimezone,
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
		date: formValues.date,
	});

	const staffingInput = getStaffingShiftInput({ ...formValues, shiftId: shift?.id ?? null });
	const staffingSuggestions = useStaffingSuggestions({
		enabled: open && isManager,
		organizationId,
		input: staffingInput,
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			if (!shift) throw new Error("No shift to delete");
			const result = await deleteShift(shift.id);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("scheduling:scheduling.shiftDialog.deleted", "Shift deleted"));
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			handleOpenChange(false);
		},
		onError: (error) => {
			toast.error(t("scheduling:scheduling.shiftDialog.deleteFailed", "Failed to delete shift"), {
				description: error.message,
			});
		},
	});

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{title}</ActionPanelTitle>
					<ActionPanelDescription>{description}</ActionPanelDescription>
				</ActionPanelHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
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
							staffing={
								staffingInput
									? {
											suggestions: staffingSuggestions.data,
											isLoading: staffingSuggestions.isFetching,
											isError: staffingSuggestions.isError,
										}
									: null
							}
							skillOverrideReasonRequested={
								reasonRefusedFor !== null && reasonRefusedFor === assignmentContextOf(formValues)
							}
						/>
					</ActionPanelBody>

					{isManager ? (
						shift ? (
							<ShiftDialogFooterActions
								key={`${open ? "open" : "closed"}-${shift.id}`}
								mode="edit"
								status={deleteMutation.isPending ? "deleting" : upsertMutation.isPending ? "saving" : "idle"}
								canManage
								onDelete={deleteMutation.mutate}
								onCancel={() => handleOpenChange(false)}
							/>
						) : (
							<ShiftDialogFooterActions
								key={`${open ? "open" : "closed"}-new`}
								mode="create"
								status={upsertMutation.isPending ? "saving" : "idle"}
								canManage
								onCancel={() => handleOpenChange(false)}
							/>
						)
					) : (
						<ShiftDialogFooterActions
							key={`${open ? "open" : "closed"}-${shift?.id ?? "new"}`}
							mode={shift ? "edit" : "create"}
							status="idle"
							canManage={false}
							onCancel={() => handleOpenChange(false)}
						/>
					)}
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
