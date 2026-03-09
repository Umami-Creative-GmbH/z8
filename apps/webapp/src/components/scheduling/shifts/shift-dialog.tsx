"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
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
	const queryClient = useQueryClient();

	const isEditing = !!shift;
	const title = isEditing ? "Edit Shift" : "Create Shift";
	const description = isEditing
		? "Update the shift details below"
		: "Fill in the details for the new shift";

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
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (result) => {
			const warnings: string[] = [];

			if (result.metadata.hasOverlap) {
				warnings.push(`Overlaps with ${result.metadata.overlappingShifts.length} other shift(s)`);
			}

			if (result.metadata.skillWarning && !result.metadata.skillWarning.isQualified) {
				const missingCount = result.metadata.skillWarning.missingSkills?.length ?? 0;
				const expiredCount = result.metadata.skillWarning.expiredSkills?.length ?? 0;
				if (missingCount > 0 || expiredCount > 0) {
					const parts: string[] = [];
					if (missingCount > 0) parts.push(`${missingCount} missing skill(s)`);
					if (expiredCount > 0) parts.push(`${expiredCount} expired certification(s)`);
					warnings.push(`Employee has ${parts.join(" and ")}`);
				}
			}

			if (warnings.length > 0) {
				toast.warning("Shift saved with warnings", {
					description: warnings.join(". "),
				});
			} else {
				toast.success(isEditing ? "Shift updated" : "Shift created");
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error("Failed to save shift", { description: error.message });
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
			toast.success("Shift deleted");
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error("Failed to delete shift", { description: error.message });
		},
	});

	const isPending = upsertMutation.isPending || deleteMutation.isPending;

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

					<ShiftDialogFooterActions
						key={`${open ? "open" : "closed"}-${shift?.id ?? "new"}`}
						isEditing={isEditing}
						isManager={isManager}
						isPending={isPending}
						isSaving={upsertMutation.isPending}
						isDeleting={deleteMutation.isPending}
						onDelete={deleteMutation.mutate}
						onCancel={() => onOpenChange(false)}
					/>
				</form>
			</DialogContent>
		</Dialog>
	);
}
