"use client";

import { IconLoader2, IconMapPin } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TimeInput } from "@/components/ui/time-input";
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
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.shiftTemplates.title", "Shift Templates")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.shiftTemplates.description",
						"Create reusable shift templates like Morning Shift, Night Shift, etc. These templates can be quickly applied when scheduling shifts.",
					)}
				</p>
			</div>

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

	const defaultSubareaId = locations
		.flatMap((location) => location.subareas)
		.find((subarea) => subarea.isActive)?.id;

	const form = useForm({
		defaultValues: {
			name: template?.name || "",
			startTime: template?.startTime || "09:00",
			endTime: template?.endTime || "17:00",
			color: template?.color || "#3b82f6",
			subareaId:
				template?.subareaId ||
				(requireScopedSubareaSelection ? defaultSubareaId || "" : ""),
		},
		onSubmit: async ({ value }) => {
			onSubmit({
				...value,
				subareaId: value.subareaId || undefined,
			});
		},
	});

	const resetForm = () => {
		form.setFieldValue("name", template?.name || "");
		form.setFieldValue("startTime", template?.startTime || "09:00");
		form.setFieldValue("endTime", template?.endTime || "17:00");
		form.setFieldValue("color", template?.color || "#3b82f6");
		form.setFieldValue(
			"subareaId",
			template?.subareaId ||
				(requireScopedSubareaSelection ? defaultSubareaId || "" : ""),
		);
	};

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
				<ActionPanelHeader>
					<ActionPanelTitle>
						{template
							? t("settings.shiftTemplates.edit.title", "Edit Template")
							: t("settings.shiftTemplates.create.title", "Create Template")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{template
							? t(
									"settings.shiftTemplates.edit.description",
									"Update the shift template details",
								)
							: t(
									"settings.shiftTemplates.create.description",
									"Create a new shift template for quick scheduling",
								)}
					</ActionPanelDescription>
				</ActionPanelHeader>

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
								<div className="space-y-2">
									<Label className="flex items-center gap-2">
										<IconMapPin className="size-4" aria-hidden="true" />
										{t(
											"settings.shiftTemplates.form.defaultSubarea",
											"Default Subarea",
										)}
										<span className="text-xs text-muted-foreground">
											({t("common.optional", "Optional")})
										</span>
									</Label>
									<Select
										value={field.state.value}
										onValueChange={(value) =>
											field.handleChange(value === "none" ? "" : value)
										}
									>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.shiftTemplates.form.selectSubarea",
													"Select a subarea…",
												)}
											>
												{field.state.value
													? getSubareaDisplay(field.state.value)
													: t(
															"settings.shiftTemplates.form.noSubarea",
															"No default subarea",
														)}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											{!requireScopedSubareaSelection ? (
												<SelectItem value="none">
													{t(
														"settings.shiftTemplates.form.noSubarea",
														"No default subarea",
													)}
												</SelectItem>
											) : null}
											{locations.flatMap((location) =>
												location.subareas.flatMap((subarea) =>
													subarea.isActive
														? [
																<SelectItem key={subarea.id} value={subarea.id}>
																	{t(
																		"settings.shiftTemplates.form.subareaFormat",
																		"{location} – {subarea}",
																		{
																			location: location.name,
																			subarea: subarea.name,
																		},
																	)}
																</SelectItem>,
															]
														: [],
												),
											)}
										</SelectContent>
									</Select>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.shiftTemplates.form.subareaHelp",
											"When using this template, shifts will be pre-assigned to this subarea.",
										)}
									</p>
								</div>
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
						<Button
							type="submit"
							disabled={
								isSubmitting ||
								(requireScopedSubareaSelection && !form.state.values.subareaId)
							}
						>
							{isSubmitting ? (
								<>
									<IconLoader2
										className="mr-2 size-4 animate-spin"
										aria-hidden="true"
									/>
									{t("common.saving", "Saving…")}
								</>
							) : template ? (
								t("common.save", "Save")
							) : (
								t("common.create", "Create")
							)}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
