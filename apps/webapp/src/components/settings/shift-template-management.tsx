"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
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
import { keepAlertDialogOpen } from "@/components/settings/confirm-action-utils";
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
import {
	type ShiftTemplateFieldError,
	shiftTemplateSubareaError,
	shiftTemplateTimeError,
} from "./shift-template-validation";

/** The first message a field's validators returned. */
function firstFieldError(errors: unknown[]): string | undefined {
	return errors.find(
		(error): error is string => typeof error === "string" && error.length > 0,
	);
}

function FieldErrorText({ id, error }: { id: string; error?: string }) {
	if (!error) return null;
	return (
		<p id={id} role="alert" className="text-sm text-destructive">
			{error}
		</p>
	);
}

interface ShiftTemplateManagementProps {
	organizationId: string;
	locations: ShiftTemplateLocations;
	manageableSubareaIds: string[] | null;
}

// Formats a template's wall-clock time in the viewer's 12h/24h preference.
function useFormatTime() {
	const { t } = useTranslate();
	const timeFormat = useTimeFormat();
	return (time: string) => {
		const [hours, minutes] = time.split(":");
		const hour = parseInt(hours, 10);
		if (timeFormat === "24h") {
			return `${String(hour).padStart(2, "0")}:${minutes}`;
		}
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
				// A failed background refresh keeps showing the templates already loaded.
				isError={controller.isError && controller.templates.length === 0}
				isRetrying={controller.isFetching}
				onRetry={() => void controller.refetch()}
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
				onOpenChange={(open) => {
					if (!controller.deleteMutation.isPending) {
						controller.setDeleteDialogOpen(open);
					}
				}}
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
							disabled={controller.deleteMutation.isPending}
							onClick={() => controller.setDeleteDialogOpen(false)}
						>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								variant="destructive"
								onClick={(event) => {
									// Keep the dialog open until the deletion settles; Base UI's
									// Close ignores preventDefault, so its handler is stopped.
									keepAlertDialogOpen(event);
									if (controller.templateToDelete && !controller.deleteMutation.isPending) {
										controller.deleteMutation.mutate(
											controller.templateToDelete.id,
										);
									}
								}}
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

	// The messages of the checks the server also makes (shift-template-validation).
	const errorText = (error: ShiftTemplateFieldError | undefined) => {
		switch (error) {
			case "invalidTime":
				return t(
					"settings.shiftTemplates.form.errors.invalidTime",
					"Enter a time in 24-hour HH:mm format.",
				);
			case "subareaRequired":
				return t(
					"settings.shiftTemplates.form.errors.subareaRequired",
					"Select one of your subareas.",
				);
			default:
				return undefined;
		}
	};

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
									<Label htmlFor="name">{t("settings.shiftTemplates.form.name", "Name")}</Label>
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
							<form.Field
								name="startTime"
								validators={{
									onChange: ({ value }) =>
										errorText(shiftTemplateTimeError(value)),
								}}
							>
								{(field) => {
									const error = firstFieldError(field.state.meta.errors);
									return (
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
												aria-invalid={error ? true : undefined}
												aria-describedby={
													error ? "shift-template-start-time-error" : undefined
												}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											<FieldErrorText
												id="shift-template-start-time-error"
												error={error}
											/>
										</div>
									);
								}}
							</form.Field>

							<form.Field
								name="endTime"
								validators={{
									onChange: ({ value }) =>
										errorText(shiftTemplateTimeError(value)),
								}}
							>
								{(field) => {
									const error = firstFieldError(field.state.meta.errors);
									return (
										<div className="space-y-2">
											<Label htmlFor="endTime">
												{t("settings.shiftTemplates.form.endTime", "End Time")}
											</Label>
											<TimeInput
												id="endTime"
												value={field.state.value}
												aria-invalid={error ? true : undefined}
												aria-describedby={
													error ? "shift-template-end-time-error" : undefined
												}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											<FieldErrorText
												id="shift-template-end-time-error"
												error={error}
											/>
										</div>
									);
								}}
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
						<form.Field
							name="subareaId"
							validators={{
								onChange: ({ value }) =>
									errorText(
										shiftTemplateSubareaError(
											value,
											requireScopedSubareaSelection,
										),
									),
							}}
						>
							{(field) => (
								<ShiftTemplateSubareaField
									value={field.state.value}
									onChange={field.handleChange}
									locations={locations}
									requireScopedSubareaSelection={requireScopedSubareaSelection}
									getSubareaDisplay={getSubareaDisplay}
									error={firstFieldError(field.state.meta.errors)}
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
						<form.Subscribe selector={(state) => state.canSubmit}>
							{(canSubmit) => (
								<ShiftTemplateSubmitButton
									isSubmitting={isSubmitting}
									// Invalid fields block the submit until corrected; a first
									// submit validates every field and shows its message inline.
									disabled={isSubmitting || !canSubmit}
									isEditing={!!template}
								/>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
