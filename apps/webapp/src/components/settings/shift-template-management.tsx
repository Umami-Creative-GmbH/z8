"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelFooter,
} from "@/components/ui/action-panel";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimeInput } from "@/components/ui/time-input";
import {
	getShiftTemplateFormDefaults,
	useShiftTemplateSubareaOptions,
} from "./shift-template-dialog-defaults";
import {
	ShiftTemplateDialogHeader,
	ShiftTemplateSubareaField,
	ShiftTemplateSubmitButton,
} from "./shift-template-dialog-fields";
import {
	type ShiftTemplateLocations,
	useShiftTemplateManagementController,
} from "./shift-template-management-controller";
import {
	ShiftTemplateColorPicker,
	ShiftTemplateList,
	ShiftTemplatePreview,
} from "./shift-template-management-sections";

interface ShiftTemplateManagementProps {
	organizationId: string;
	locations: ShiftTemplateLocations;
	manageableSubareaIds: string[] | null;
}

// Helper to format time with translations
function useFormatTime() {
	const { t } = useTranslate();
	return (time: string) => {
		const [hours, minutes] = time.split(":");
		const hour = parseInt(hours, 10);
		const ampm =
			hour >= 12 ? t("common:time.pm", "PM") : t("common:time.am", "AM");
		const hour12 = hour % 12 || 12;
		return `${hour12}:${minutes} ${ampm}`;
	};
}

// Helper to calculate and format duration with translations
function useCalculateDuration() {
	const { t } = useTranslate();
	return (startTime: string, endTime: string) => {
		const [startH, startM] = startTime.split(":").map(Number);
		const [endH, endM] = endTime.split(":").map(Number);

		const startMinutes = startH * 60 + startM;
		let endMinutes = endH * 60 + endM;

		// Handle overnight shifts
		if (endMinutes < startMinutes) {
			endMinutes += 24 * 60;
		}

		const durationMinutes = endMinutes - startMinutes;
		const hours = Math.floor(durationMinutes / 60);
		const minutes = durationMinutes % 60;

		if (minutes === 0) {
			return t("common:time.hoursOnly", "{hours}h", { hours });
		}
		return t("common:time.hoursAndMinutes", "{hours}h {minutes}m", {
			hours,
			minutes,
		});
	};
}

export function ShiftTemplateManagement({
	organizationId,
	locations,
	manageableSubareaIds,
}: ShiftTemplateManagementProps) {
	const { t } = useTranslate();
	const formatTime = useFormatTime();
	const calculateDuration = useCalculateDuration();
	const controller = useShiftTemplateManagementController({
		organizationId,
		locations,
		manageableSubareaIds,
	});

	return (
		<div className="flex flex-col gap-4">
			<ShiftTemplateList
				templates={controller.templates}
				isLoading={controller.isLoading}
				formatTime={formatTime}
				calculateDuration={calculateDuration}
				onCreate={() => {
					controller.setEditingTemplate(null);
					controller.setDialogOpen(true);
				}}
				onEdit={(template) => {
					controller.setEditingTemplate(template);
					controller.setDialogOpen(true);
				}}
				onToggleActive={(template) =>
					controller.toggleActiveMutation.mutate({
						id: template.id,
						isActive: !template.isActive,
					})
				}
				onDelete={(template) => {
					controller.setTemplateToDelete(template);
					controller.setDeleteDialogOpen(true);
				}}
			/>

			{/* Create/Edit ActionPanel */}
			<ShiftTemplateDialog
				open={controller.dialogOpen}
				onOpenChange={controller.setDialogOpen}
				template={controller.editingTemplate}
				locations={controller.visibleLocations}
				requireScopedSubareaSelection={controller.requireScopedSubareaSelection}
				onSubmit={(values) => {
					if (controller.editingTemplate) {
						controller.updateMutation.mutate({
							id: controller.editingTemplate.id,
							values,
						});
					} else {
						controller.createMutation.mutate(values);
					}
				}}
				isSubmitting={
					controller.createMutation.isPending ||
					controller.updateMutation.isPending
				}
			/>

			{/* Delete Confirmation AlertDialog */}
			<AlertDialog
				open={controller.deleteDialogOpen}
				onOpenChange={controller.setDeleteDialogOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"settings.shiftTemplates.deleteConfirm.title",
								"Delete Template",
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.shiftTemplates.deleteConfirm.description",
								'Are you sure you want to delete "{name}"? This action cannot be undone.',
								{ name: controller.templateToDelete?.name },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => controller.setDeleteDialogOpen(false)}
						>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								variant="destructive"
								onClick={() =>
									controller.templateToDelete &&
									controller.deleteMutation.mutate(
										controller.templateToDelete.id,
									)
								}
								disabled={controller.deleteMutation.isPending}
							>
								{controller.deleteMutation.isPending ? (
									<>
										<IconLoader2
											className="mr-2 size-4 animate-spin"
											aria-hidden="true"
										/>
										{t("common.deleting", "Deleting…")}
									</>
								) : (
									t("common.delete", "Delete")
								)}
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

// ActionPanel component for creating/editing templates
interface ShiftTemplateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	template: ShiftTemplate | null;
	locations: ShiftTemplateManagementProps["locations"];
	requireScopedSubareaSelection: boolean;
	onSubmit: (values: {
		name: string;
		startTime: string;
		endTime: string;
		color?: string;
		subareaId?: string;
	}) => void;
	isSubmitting: boolean;
}

function ShiftTemplateDialog({
	open,
	onOpenChange,
	template,
	locations,
	requireScopedSubareaSelection,
	onSubmit,
	isSubmitting,
}: ShiftTemplateDialogProps) {
	const { t } = useTranslate();
	const formatTime = useFormatTime();
	const calculateDuration = useCalculateDuration();

	const { defaultSubareaId, getSubareaDisplay } =
		useShiftTemplateSubareaOptions(locations);
	const getDefaults = () =>
		getShiftTemplateFormDefaults(
			template,
			requireScopedSubareaSelection,
			defaultSubareaId,
		);

	const form = useForm({
		defaultValues: getDefaults(),
		onSubmit: async ({ value }) => {
			onSubmit({
				...value,
				subareaId: value.subareaId || undefined,
			});
		},
	});

	const resetForm = () => {
		const defaults = getDefaults();
		form.setFieldValue("name", defaults.name);
		form.setFieldValue("startTime", defaults.startTime);
		form.setFieldValue("endTime", defaults.endTime);
		form.setFieldValue("color", defaults.color);
		form.setFieldValue("subareaId", defaults.subareaId);
	};

	return (
		<ActionPanel
			open={open}
			onOpenChange={(isOpen) => {
				if (isOpen) {
					resetForm();
				}
				onOpenChange(isOpen);
			}}
		>
			<ActionPanelContent>
				<ShiftTemplateDialogHeader isEditing={!!template} />

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
						<form.Field name="name">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="name">
										{t("settings.shiftTemplates.form.name", "Name")}
									</Label>
									<Input
										id="name"
										placeholder={t(
											"settings.shiftTemplates.form.namePlaceholder",
											"e.g., Morning Shift…",
										)}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
								</div>
							)}
						</form.Field>

						<div className="grid grid-cols-2 gap-4">
							<form.Field name="startTime">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="startTime">
											{t(
												"settings.shiftTemplates.form.startTime",
												"Start Time",
											)}
										</Label>
										<TimeInput
											id="startTime"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="endTime">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="endTime">
											{t("settings.shiftTemplates.form.endTime", "End Time")}
										</Label>
										<TimeInput
											id="endTime"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
										/>
									</div>
								)}
							</form.Field>
						</div>

						{/* Color picker */}
						<form.Field name="color">
							{(field) => (
								<ShiftTemplateColorPicker
									value={field.state.value}
									onChange={field.handleChange}
								/>
							)}
						</form.Field>

						{/* Default Subarea (Optional) */}
						<form.Field name="subareaId">
							{(field) => (
								<ShiftTemplateSubareaField
									value={field.state.value}
									onChange={field.handleChange}
									locations={locations}
									requireScopedSubareaSelection={requireScopedSubareaSelection}
									getSubareaDisplay={getSubareaDisplay}
								/>
							)}
						</form.Field>

						{/* Preview */}
						<form.Subscribe<typeof form.state.values>
							selector={(state) => state.values}
						>
							{(values: typeof form.state.values) => (
								<ShiftTemplatePreview
									values={values}
									formatTime={formatTime}
									calculateDuration={calculateDuration}
									getSubareaDisplay={getSubareaDisplay}
								/>
							)}
						</form.Subscribe>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<ShiftTemplateSubmitButton
							isSubmitting={isSubmitting}
							disabled={
								isSubmitting ||
								(requireScopedSubareaSelection && !form.state.values.subareaId)
							}
							isEditing={!!template}
						/>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
