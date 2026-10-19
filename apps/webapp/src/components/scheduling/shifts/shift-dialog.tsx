"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { ShiftTemplate, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { ShiftDialogFooterActions, ShiftDialogSections } from "./shift-dialog-sections";
import { useShiftDialogData } from "./use-shift-dialog-data";
import { useShiftDialogForm } from "./use-shift-dialog-form";
import {
	assignmentContextOf,
	useShiftDeleteMutation,
	useShiftUpsertMutation,
} from "./use-shift-dialog-mutations";
import { getStaffingShiftInput, useStaffingSuggestions } from "./use-staffing-suggestions";

function editFooterStatus(isDeleting: boolean, isSaving: boolean): "idle" | "saving" | "deleting" {
	if (isDeleting) return "deleting";
	return isSaving ? "saving" : "idle";
}

/** The footer: managers save or delete, everyone else only closes the dialog. */
function ShiftDialogFooter({
	open,
	shift,
	isManager,
	isDeleting,
	isSaving,
	onDelete,
	onCancel,
}: {
	open: boolean;
	shift: ShiftWithRelations | null;
	isManager: boolean;
	isDeleting: boolean;
	isSaving: boolean;
	onDelete: () => void;
	onCancel: () => void;
}) {
	// Remounts the footer whenever the dialog opens or closes, or shows another shift.
	const footerKey = `${open ? "open" : "closed"}-${shift?.id ?? "new"}`;

	if (!isManager) {
		return (
			<ShiftDialogFooterActions
				key={footerKey}
				mode={shift ? "edit" : "create"}
				status="idle"
				canManage={false}
				onCancel={onCancel}
			/>
		);
	}

	if (shift) {
		return (
			<ShiftDialogFooterActions
				key={footerKey}
				mode="edit"
				status={editFooterStatus(isDeleting, isSaving)}
				canManage
				onDelete={onDelete}
				onCancel={onCancel}
			/>
		);
	}

	return (
		<ShiftDialogFooterActions
			key={footerKey}
			mode="create"
			status={isSaving ? "saving" : "idle"}
			canManage
			onCancel={onCancel}
		/>
	);
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

	const closeDialog = () => handleOpenChange(false);

	const upsertMutation = useShiftUpsertMutation({
		shiftId: shift?.id,
		isEditing,
		onSaved: closeDialog,
		onReasonRefused: setReasonRefusedFor,
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

	const deleteMutation = useShiftDeleteMutation({
		shiftId: shift?.id,
		onDeleted: closeDialog,
	});

	const staffing = staffingInput
		? {
				suggestions: staffingSuggestions.data,
				isLoading: staffingSuggestions.isFetching,
				isError: staffingSuggestions.isError,
			}
		: null;
	const skillOverrideReasonRequested =
		reasonRefusedFor !== null && reasonRefusedFor === assignmentContextOf(formValues);

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
							staffing={staffing}
							skillOverrideReasonRequested={skillOverrideReasonRequested}
						/>
					</ActionPanelBody>

					<ShiftDialogFooter
						open={open}
						shift={shift}
						isManager={isManager}
						isDeleting={deleteMutation.isPending}
						isSaving={upsertMutation.isPending}
						onDelete={() => deleteMutation.mutate()}
						onCancel={closeDialog}
					/>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
