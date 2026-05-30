"use client";

import {
	IconClock,
	IconDots,
	IconLoader2,
	IconMapPin,
	IconPalette,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createShiftTemplate,
	deleteShiftTemplate,
	getShiftTemplates,
	updateShiftTemplate,
} from "@/app/[locale]/(app)/scheduling/actions";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TimeInput } from "@/components/ui/time-input";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";

interface ShiftTemplateManagementProps {
	organizationId: string;
	locations: Array<{
		id: string;
		name: string;
		subareas: Array<{
			id: string;
			name: string;
			isActive: boolean;
		}>;
	}>;
	manageableSubareaIds: string[] | null;
}

// Predefined colors for shift templates
const PRESET_COLORS = [
	{ key: "blue", value: "#3b82f6" },
	{ key: "green", value: "#22c55e" },
	{ key: "purple", value: "#a855f7" },
	{ key: "orange", value: "#f97316" },
	{ key: "red", value: "#ef4444" },
	{ key: "teal", value: "#14b8a6" },
	{ key: "pink", value: "#ec4899" },
	{ key: "indigo", value: "#6366f1" },
] as const;

// Helper to get translated color name
function useColorName() {
	const { t } = useTranslate();
	return (key: string) => {
		const colorNames: Record<string, string> = {
			blue: t("common:colors.blue", "Blue"),
			green: t("common:colors.green", "Green"),
			purple: t("common:colors.purple", "Purple"),
			orange: t("common:colors.orange", "Orange"),
			red: t("common:colors.red", "Red"),
			teal: t("common:colors.teal", "Teal"),
			pink: t("common:colors.pink", "Pink"),
			indigo: t("common:colors.indigo", "Indigo"),
		};
		return colorNames[key] || key;
	};
}

// Helper to format time with translations
function useFormatTime() {
	const { t } = useTranslate();
	return (time: string) => {
		const [hours, minutes] = time.split(":");
		const hour = parseInt(hours, 10);
		const ampm = hour >= 12 ? t("common:time.pm", "PM") : t("common:time.am", "AM");
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
		return t("common:time.hoursAndMinutes", "{hours}h {minutes}m", { hours, minutes });
	};
}

export function ShiftTemplateManagement({
	organizationId,
	locations,
	manageableSubareaIds,
}: ShiftTemplateManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const formatTime = useFormatTime();
	const calculateDuration = useCalculateDuration();
	const manageableSubareaIdSet = manageableSubareaIds ? new Set(manageableSubareaIds) : null;

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<ShiftTemplate | null>(null);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [templateToDelete, setTemplateToDelete] = useState<ShiftTemplate | null>(null);

	// Fetch templates
	const { data: templatesResult, isLoading } = useQuery({
		queryKey: queryKeys.shiftTemplates.list(organizationId),
		queryFn: async () => {
			const result = await getShiftTemplates();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const templates = templatesResult || [];
	const visibleLocations = manageableSubareaIdSet
		? locations
				.map((location) => ({
					...location,
					subareas: location.subareas.filter((subarea) => manageableSubareaIdSet.has(subarea.id)),
				}))
				.filter((location) => location.subareas.length > 0)
		: locations;

	// Create mutation
	const createMutation = useMutation({
		mutationFn: async (values: {
			name: string;
			startTime: string;
			endTime: string;
			color?: string;
			subareaId?: string;
		}) => {
			const result = await createShiftTemplate(values);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.shiftTemplates.created", "Shift template created"));
			queryClient.invalidateQueries({ queryKey: queryKeys.shiftTemplates.list(organizationId) });
			setDialogOpen(false);
		},
		onError: (error) => {
			toast.error(t("settings.shiftTemplates.createError", "Failed to create template"), {
				description: error.message,
			});
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: async ({
			id,
			values,
		}: {
			id: string;
			values: {
				name?: string;
				startTime?: string;
				endTime?: string;
				color?: string;
				isActive?: boolean;
				subareaId?: string | null;
			};
		}) => {
			const result = await updateShiftTemplate(id, values);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.shiftTemplates.updated", "Shift template updated"));
			queryClient.invalidateQueries({ queryKey: queryKeys.shiftTemplates.list(organizationId) });
			setDialogOpen(false);
			setEditingTemplate(null);
		},
		onError: (error) => {
			toast.error(t("settings.shiftTemplates.updateError", "Failed to update template"), {
				description: error.message,
			});
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const result = await deleteShiftTemplate(id);
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success(t("settings.shiftTemplates.deleted", "Shift template deleted"));
			queryClient.invalidateQueries({ queryKey: queryKeys.shiftTemplates.list(organizationId) });
			setDeleteDialogOpen(false);
			setTemplateToDelete(null);
		},
		onError: (error) => {
			toast.error(t("settings.shiftTemplates.deleteError", "Failed to delete template"), {
				description: error.message,
			});
		},
	});

	// Toggle active mutation
	const toggleActiveMutation = useMutation({
		mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
			const result = await updateShiftTemplate(id, { isActive });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (_, variables) => {
			toast.success(
				variables.isActive
					? t("settings.shiftTemplates.activated", "Template activated")
					: t("settings.shiftTemplates.deactivated", "Template deactivated"),
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.shiftTemplates.list(organizationId) });
		},
		onError: (error) => {
			toast.error(t("settings.shiftTemplates.toggleError", "Failed to update template"), {
				description: error.message,
			});
		},
	});

	const handleCreate = () => {
		setEditingTemplate(null);
		setDialogOpen(true);
	};

	const handleEdit = (template: ShiftTemplate) => {
		setEditingTemplate(template);
		setDialogOpen(true);
	};

	const handleDelete = (template: ShiftTemplate) => {
		setTemplateToDelete(template);
		setDeleteDialogOpen(true);
	};

	const handleToggleActive = (template: ShiftTemplate) => {
		toggleActiveMutation.mutate({ id: template.id, isActive: !template.isActive });
	};

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

			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
					<div>
						<CardTitle className="text-base font-medium">
							{t("settings.shiftTemplates.list.title", "Templates")}
						</CardTitle>
						<CardDescription>
							{t("settings.shiftTemplates.list.description", "Manage your shift templates")}
						</CardDescription>
					</div>
					<Button onClick={handleCreate} size="sm">
						<IconPlus className="mr-2 size-4" />
						{t("settings.shiftTemplates.add", "Add Template")}
					</Button>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<IconLoader2
								className="size-6 animate-spin text-muted-foreground"
								aria-hidden="true"
							/>
						</div>
					) : templates.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<IconClock className="size-12 text-muted-foreground/50 mb-4" aria-hidden="true" />
							<h3 className="font-medium">
								{t("settings.shiftTemplates.empty.title", "No templates yet")}
							</h3>
							<p className="text-sm text-muted-foreground mt-1 max-w-sm">
								{t(
									"settings.shiftTemplates.empty.description",
									"Create shift templates to quickly add shifts when scheduling. Common examples include Morning Shift, Evening Shift, and Night Shift.",
								)}
							</p>
							<Button onClick={handleCreate} className="mt-4" variant="outline">
								<IconPlus className="mr-2 size-4" />
								{t("settings.shiftTemplates.createFirst", "Create your first template")}
							</Button>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.shiftTemplates.table.name", "Name")}</TableHead>
									<TableHead>{t("settings.shiftTemplates.table.time", "Time")}</TableHead>
									<TableHead>{t("settings.shiftTemplates.table.duration", "Duration")}</TableHead>
									<TableHead>{t("settings.shiftTemplates.table.status", "Status")}</TableHead>
									<TableHead className="w-[70px]" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{templates.map((template) => (
									<TableRow key={template.id}>
										<TableCell>
											<div className="flex items-center gap-3">
												<div
													className="size-4 rounded-full shrink-0"
													style={{ backgroundColor: template.color || "#3b82f6" }}
													aria-hidden="true"
												/>
												<span className="font-medium">{template.name}</span>
											</div>
										</TableCell>
										<TableCell>
											<span className="text-muted-foreground">
												{formatTime(template.startTime)} – {formatTime(template.endTime)}
											</span>
										</TableCell>
										<TableCell>
											<span className="text-muted-foreground">
												{calculateDuration(template.startTime, template.endTime)}
											</span>
										</TableCell>
										<TableCell>
											<Badge variant={template.isActive ? "default" : "secondary"}>
												{template.isActive
													? t("settings.shiftTemplates.active", "Active")
													: t("settings.shiftTemplates.inactive", "Inactive")}
											</Badge>
										</TableCell>
										<TableCell>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" size="icon" className="size-8">
														<IconDots className="size-4" />
														<span className="sr-only">{t("common.openMenu", "Open menu")}</span>
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={() => handleEdit(template)}>
														<IconPencil className="mr-2 size-4" aria-hidden="true" />
														{t("common.edit", "Edit")}
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => handleToggleActive(template)}>
														{template.isActive
															? t("settings.shiftTemplates.deactivate", "Deactivate")
															: t("settings.shiftTemplates.activate", "Activate")}
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() => handleDelete(template)}
														className="text-destructive focus:text-destructive"
													>
														<IconTrash className="mr-2 size-4" aria-hidden="true" />
														{t("common.delete", "Delete")}
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Create/Edit ActionPanel */}
			<ShiftTemplateDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				template={editingTemplate}
				locations={visibleLocations}
				requireScopedSubareaSelection={manageableSubareaIdSet !== null}
				onSubmit={(values) => {
					if (editingTemplate) {
						updateMutation.mutate({ id: editingTemplate.id, values });
					} else {
						createMutation.mutate(values);
					}
				}}
				isSubmitting={createMutation.isPending || updateMutation.isPending}
			/>

			{/* Delete Confirmation AlertDialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.shiftTemplates.deleteConfirm.title", "Delete Template")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.shiftTemplates.deleteConfirm.description",
								'Are you sure you want to delete "{name}"? This action cannot be undone.',
								{ name: templateToDelete?.name },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								variant="destructive"
								onClick={() => templateToDelete && deleteMutation.mutate(templateToDelete.id)}
								disabled={deleteMutation.isPending}
							>
								{deleteMutation.isPending ? (
									<>
										<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
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
	const getColorName = useColorName();
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
				template?.subareaId || (requireScopedSubareaSelection ? defaultSubareaId || "" : ""),
		},
		onSubmit: async ({ value }) => {
			onSubmit({
				...value,
				subareaId: value.subareaId || undefined,
			});
		},
	});

	// Reset form when dialog opens with new template
	const resetForm = () => {
		form.setFieldValue("name", template?.name || "");
		form.setFieldValue("startTime", template?.startTime || "09:00");
		form.setFieldValue("endTime", template?.endTime || "17:00");
		form.setFieldValue("color", template?.color || "#3b82f6");
		form.setFieldValue(
			"subareaId",
			template?.subareaId || (requireScopedSubareaSelection ? defaultSubareaId || "" : ""),
		);
	};

	const subareaDisplayById = new Map<string, string>();
	for (const location of locations) {
		for (const subarea of location.subareas) {
			if (!subareaDisplayById.has(subarea.id)) {
				subareaDisplayById.set(
					subarea.id,
					t("settings.shiftTemplates.form.subareaFormat", "{location} – {subarea}", {
						location: location.name,
						subarea: subarea.name,
					}),
				);
			}
		}
	}

	// Helper to get subarea display name
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
							? t("settings.shiftTemplates.edit.description", "Update the shift template details")
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
						{/* Name */}
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

						{/* Time inputs */}
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="startTime">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="startTime">
											{t("settings.shiftTemplates.form.startTime", "Start Time")}
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
								<div className="space-y-2">
									<Label className="flex items-center gap-2">
										<IconPalette className="size-4" aria-hidden="true" />
										{t("settings.shiftTemplates.form.color", "Color")}
									</Label>
									<div
										className="flex flex-wrap gap-2"
										role="radiogroup"
										aria-label={t("settings.shiftTemplates.form.colorSelection", "Color selection")}
									>
										{PRESET_COLORS.map((color) => (
											<button
												key={color.value}
												type="button"
												role="radio"
												aria-checked={field.state.value === color.value}
												aria-label={getColorName(color.key)}
												onClick={() => field.handleChange(color.value)}
												className={cn(
													"size-8 rounded-full transition-transform hover:scale-110",
													field.state.value === color.value && "ring-2 ring-offset-2 ring-primary",
												)}
												style={{ backgroundColor: color.value }}
											/>
										))}
									</div>
								</div>
							)}
						</form.Field>

						{/* Default Subarea (Optional) */}
						<form.Field name="subareaId">
							{(field) => (
								<div className="space-y-2">
									<Label className="flex items-center gap-2">
										<IconMapPin className="size-4" aria-hidden="true" />
										{t("settings.shiftTemplates.form.defaultSubarea", "Default Subarea")}
										<span className="text-xs text-muted-foreground">
											({t("common.optional", "Optional")})
										</span>
									</Label>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value === "none" ? "" : value)}
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
													: t("settings.shiftTemplates.form.noSubarea", "No default subarea")}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											{!requireScopedSubareaSelection ? (
												<SelectItem value="none">
													{t("settings.shiftTemplates.form.noSubarea", "No default subarea")}
												</SelectItem>
											) : null}
											{locations.flatMap((location) =>
												location.subareas
													.filter((s) => s.isActive)
													.map((subarea) => (
														<SelectItem key={subarea.id} value={subarea.id}>
															{t(
																"settings.shiftTemplates.form.subareaFormat",
																"{location} – {subarea}",
																{
																	location: location.name,
																	subarea: subarea.name,
																},
															)}
														</SelectItem>
													)),
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
						<form.Subscribe selector={(state) => state.values}>
							{(values) => (
								<div className="rounded-lg border p-3 bg-muted/50">
									<p className="text-xs text-muted-foreground mb-2">
										{t("settings.shiftTemplates.form.preview", "Preview")}
									</p>
									<div className="flex items-center gap-3">
										<div
											className="size-4 rounded-full shrink-0"
											style={{ backgroundColor: values.color || "#3b82f6" }}
											aria-hidden="true"
										/>
										<div>
											<p className="font-medium text-sm">
												{values.name || t("settings.shiftTemplates.form.untitled", "Untitled")}
											</p>
											<p className="text-xs text-muted-foreground">
												{formatTime(values.startTime)} – {formatTime(values.endTime)} (
												{calculateDuration(values.startTime, values.endTime)})
											</p>
											{values.subareaId && (
												<p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
													<IconMapPin className="size-3" aria-hidden="true" />
													{getSubareaDisplay(values.subareaId)}
												</p>
											)}
										</div>
									</div>
								</div>
							)}
						</form.Subscribe>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							type="submit"
							disabled={
								isSubmitting || (requireScopedSubareaSelection && !form.state.values.subareaId)
							}
						>
							{isSubmitting ? (
								<>
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
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
