"use client";

import {
	IconAward,
	IconCertificate,
	IconEdit,
	IconLanguage,
	IconLoader2,
	IconPlus,
	IconRefresh,
	IconSchool,
	IconShieldCheck,
	IconTools,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createSkill,
	deleteSkill,
	updateSkill,
} from "@/app/[locale]/(app)/settings/skills/actions";
import { SkillReminderSettingsCard } from "@/components/settings/skill-reminder-settings-card";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SkillWithRelations } from "@/lib/effect/services/skill.service";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query/keys";

type SkillCategory = "safety" | "equipment" | "certification" | "training" | "language" | "custom";

interface SkillCatalogManagementProps {
	organizationId: string;
	canManageCatalog?: boolean;
	/** The organization's skill reminder lead time; owners and admins edit it next to the catalog (#1143). */
	reminderLeadDays?: number;
}

const SKILL_CATEGORIES: Array<{
	value: SkillCategory;
	icon: typeof IconShieldCheck;
}> = [
	{ value: "safety", icon: IconShieldCheck },
	{ value: "equipment", icon: IconTools },
	{ value: "certification", icon: IconCertificate },
	{ value: "training", icon: IconSchool },
	{ value: "language", icon: IconLanguage },
	{ value: "custom", icon: IconAward },
];

type Translate = ReturnType<typeof useTranslate>["t"];

function getCategoryIcon(category: SkillCategory) {
	const found = SKILL_CATEGORIES.find((c) => c.value === category);
	return found?.icon ?? IconAward;
}

/** Each label is a static literal so the i18n extractor can find it. */
function getCategoryLabel(category: SkillCategory, t: Translate) {
	switch (category) {
		case "safety":
			return t("settings.skills.categories.safety", "Safety");
		case "equipment":
			return t("settings.skills.categories.equipment", "Equipment");
		case "certification":
			return t("settings.skills.categories.certification", "Certification");
		case "training":
			return t("settings.skills.categories.training", "Training");
		case "language":
			return t("settings.skills.categories.language", "Language");
		case "custom":
			return t("settings.skills.categories.custom", "Custom");
		default:
			return category;
	}
}

export function SkillCatalogManagement({
	organizationId,
	canManageCatalog = true,
	reminderLeadDays,
}: SkillCatalogManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingSkill, setEditingSkill] = useState<SkillWithRelations | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<SkillWithRelations | null>(null);

	// Fetch skills
	const {
		data: skillsResult,
		isLoading,
		isError,
		error,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.skills.list(organizationId, false),
		queryFn: async () => {
			const response = await fetch("/api/settings/skills?includeInactive=false", {
				method: "GET",
			});

			if (!response.ok) {
				const errorResult = await response.json().catch(() => null);
				throw new Error(errorResult?.error ?? t("common.error-occurred", "An error occurred"));
			}

			const result = await response.json().catch(() => null);
			if (!result?.success) {
				throw new Error(result?.error ?? t("common.error-occurred", "An error occurred"));
			}

			return result.data as SkillWithRelations[];
		},
	});

	const skills = skillsResult ?? [];

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: async (skillId: string) => {
			const result = await deleteSkill(skillId);
			if (!result.success)
				throw new Error(
					actionErrorMessage(t, result, {}, [
						"settings.skills.deleteError",
						"Failed to delete skill",
					]),
				);
		},
		onSuccess: () => {
			toast.success(t("settings.skills.skillDeleted", "Skill deleted"));
			setDeleteTarget(null);
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.list(organizationId),
			});
		},
		// A failure is shown inside the confirmation dialog, which stays open for a retry.
	});

	const handleCreate = () => {
		setEditingSkill(null);
		setDialogOpen(true);
	};

	const handleEdit = (skill: SkillWithRelations) => {
		setEditingSkill(skill);
		setDialogOpen(true);
	};

	const handleDelete = (skill: SkillWithRelations) => {
		if (deleteMutation.isPending) return;
		deleteMutation.reset();
		setDeleteTarget(skill);
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.skills.list(organizationId),
		});
		setDialogOpen(false);
		setEditingSkill(null);
	};

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.skills.title", "Skills & Qualifications")}
					description={t(
						"settings.skills.description",
						"Manage skills and certifications that can be assigned to employees",
					)}
					actions={
						<>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => refetch()}
								disabled={isFetching}
								aria-label={t("settings.skills.refresh", "Refresh skill catalog")}
							>
								<IconRefresh
									className={`size-4 ${isFetching ? "motion-safe:animate-spin" : ""}`}
									aria-hidden="true"
								/>
							</Button>
							{canManageCatalog ? (
								<Button onClick={handleCreate}>
									<IconPlus className="mr-2 size-4" aria-hidden="true" />
									{t("settings.skills.addSkill", "Add Skill")}
								</Button>
							) : null}
						</>
					}
				/>

				{/* Content */}
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.skills.catalog", "Skill Catalog")}</CardTitle>
						<CardDescription>
							{t(
								"settings.skills.catalogDescription",
								"Define skills that can be required for subareas and shift templates",
							)}
						</CardDescription>
					</CardHeader>
					<SkillCatalogResults
						isLoading={isLoading}
						isError={isError}
						error={error}
						isFetching={isFetching}
						refetch={refetch}
						skills={skills}
						canManageCatalog={canManageCatalog}
						handleCreate={handleCreate}
						handleEdit={handleEdit}
						handleDelete={handleDelete}
						deleting={deleteMutation.isPending}
					/>
				</Card>

				{canManageCatalog && reminderLeadDays !== undefined ? (
					<SkillReminderSettingsCard leadDays={reminderLeadDays} />
				) : null}

				{/* Create/Edit ActionPanel */}
				{canManageCatalog ? (
					<SkillDialog
						organizationId={organizationId}
						skill={editingSkill}
						open={dialogOpen}
						onOpenChange={setDialogOpen}
						onSuccess={handleSuccess}
					/>
				) : null}

				{canManageCatalog ? (
					<DeleteConfirmDialog
						open={deleteTarget !== null}
						onOpenChange={(open) => {
							if (!open) setDeleteTarget(null);
						}}
						title={t("settings.skills.deleteDialog.title", "Delete skill?")}
						description={t(
							"settings.skills.deleteDialog.description",
							'"{name}" will be removed from the skill catalog.',
							{ name: deleteTarget?.name ?? "" },
						)}
						confirmLabel={t("settings.skills.deleteDialog.confirm", "Delete skill")}
						isDeleting={deleteMutation.isPending}
						error={
							deleteMutation.isError
								? deleteMutation.error.message ||
									t("settings.skills.deleteError", "Failed to delete skill")
								: null
						}
						onConfirm={() => {
							if (deleteTarget && !deleteMutation.isPending) deleteMutation.mutate(deleteTarget.id);
						}}
					/>
				) : null}
			</div>
		</div>
	);
}

// ============================================
// Skill ActionPanel Component
// ============================================

interface SkillDialogProps {
	organizationId: string;
	skill: SkillWithRelations | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess: () => void;
}

interface SkillFormValues {
	name: string;
	description: string;
	category: SkillCategory;
	customCategoryName: string;
	requiresExpiry: boolean;
}

function SkillDialog({ organizationId, skill, open, onOpenChange, onSuccess }: SkillDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!skill;

	const defaultValues: SkillFormValues = {
		name: skill?.name ?? "",
		description: skill?.description ?? "",
		category: (skill?.category as SkillCategory) ?? "certification",
		customCategoryName: skill?.customCategoryName ?? "",
		requiresExpiry: skill?.requiresExpiry ?? false,
	};

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (isEditing && skill) {
				updateMutation.mutate({ skillId: skill.id, ...value });
			} else {
				createMutation.mutate(value);
			}
		},
	});

	const createMutation = useMutation({
		mutationFn: async (data: SkillFormValues) => {
			const result = await createSkill({
				name: data.name,
				description: data.description || undefined,
				category: data.category,
				customCategoryName: data.category === "custom" ? data.customCategoryName : undefined,
				requiresExpiry: data.requiresExpiry,
			});
			if (!result.success)
				throw new Error(
					actionErrorMessage(t, result, {}, [
						"settings.skills.createError",
						"Failed to create skill",
					]),
				);
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.list(organizationId),
			});
			toast.success(t("settings.skills.skillCreated", "Skill created"));
			onSuccess();
		},
		onError: (error) => {
			toast.error(error.message || t("settings.skills.createError", "Failed to create skill"));
		},
	});

	const updateMutation = useMutation({
		mutationFn: async (data: SkillFormValues & { skillId: string }) => {
			const result = await updateSkill({
				skillId: data.skillId,
				data: {
					name: data.name,
					description: data.description || undefined,
					category: data.category,
					customCategoryName: data.category === "custom" ? data.customCategoryName : undefined,
					requiresExpiry: data.requiresExpiry,
				},
			});
			if (!result.success)
				throw new Error(
					actionErrorMessage(t, result, {}, [
						"settings.skills.updateError",
						"Failed to update skill",
					]),
				);
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.skills.list(organizationId),
			});
			toast.success(t("settings.skills.skillUpdated", "Skill updated"));
			onSuccess();
		},
		onError: (error) => {
			toast.error(error.message || t("settings.skills.updateError", "Failed to update skill"));
		},
	});

	const isMutating = createMutation.isPending || updateMutation.isPending;

	// Reset form when dialog opens/closes
	const handleOpenChange = (newOpen: boolean) => {
		if (newOpen) {
			form.reset();
			form.setFieldValue("name", skill?.name ?? "");
			form.setFieldValue("description", skill?.description ?? "");
			form.setFieldValue("category", (skill?.category as SkillCategory) ?? "certification");
			form.setFieldValue("customCategoryName", skill?.customCategoryName ?? "");
			form.setFieldValue("requiresExpiry", skill?.requiresExpiry ?? false);
		}
		onOpenChange(newOpen);
	};

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{isEditing
							? t("settings.skills.editSkill", "Edit Skill")
							: t("settings.skills.createSkill", "Create Skill")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{isEditing
							? t("settings.skills.editSkillDescription", "Update the skill details")
							: t(
									"settings.skills.createSkillDescription",
									"Create a new skill that can be assigned to employees",
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
					<ActionPanelBody className="grid content-start gap-4">
						{/* Name */}
						<form.Field
							name="name"
							validators={{
								onSubmit: ({ value }) =>
									value.trim()
										? undefined
										: t("settings.skills.nameRequired", "Enter a name for the skill."),
							}}
						>
							{(field) => {
								const error = field.state.meta.errors[0];
								return (
									<div className="grid gap-2">
										<Label htmlFor="skill-name">{t("settings.skills.skillName", "Name")} *</Label>
										<Input
											id="skill-name"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t("settings.skills.namePlaceholder", "e.g., Forklift License")}
											aria-invalid={error ? true : undefined}
											aria-describedby={error ? "skill-name-error" : undefined}
										/>
										{error ? (
											<p id="skill-name-error" className="text-sm text-destructive">
												{String(error)}
											</p>
										) : null}
									</div>
								);
							}}
						</form.Field>

						{/* Category */}
						<form.Field name="category">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="skill-category">
										{t("settings.skills.category", "Category")}
									</Label>
									<Select
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value as SkillCategory)}
									>
										<SelectTrigger id="skill-category">
											<SelectValue
												placeholder={t("settings.skills.selectCategory", "Select category")}
											/>
										</SelectTrigger>
										<SelectContent>
											{SKILL_CATEGORIES.map((cat) => (
												<SelectItem key={cat.value} value={cat.value}>
													<span className="flex items-center gap-2">
														<cat.icon className="size-4" aria-hidden="true" />
														{getCategoryLabel(cat.value, t)}
													</span>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{/* Custom Category Name (conditional) */}
						<form.Subscribe<SkillFormValues["category"]>
							selector={(state) => state.values.category}
						>
							{(category: SkillFormValues["category"]) =>
								category === "custom" && (
									<form.Field name="customCategoryName">
										{(field) => (
											<div className="grid gap-2">
												<Label htmlFor="skill-custom-category">
													{t("settings.skills.customCategoryName", "Custom Category Name")} *
												</Label>
												<Input
													id="skill-custom-category"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													placeholder={t(
														"settings.skills.customCategoryPlaceholder",
														"e.g., Compliance",
													)}
												/>
											</div>
										)}
									</form.Field>
								)
							}
						</form.Subscribe>

						{/* Description */}
						<form.Field name="description">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="skill-description">
										{t("settings.skills.description", "Description")}
									</Label>
									<Textarea
										id="skill-description"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.skills.descriptionPlaceholder",
											"Optional description of the skill or certification",
										)}
										rows={2}
									/>
								</div>
							)}
						</form.Field>

						{/* Requires Expiry */}
						<form.Field name="requiresExpiry">
							{(field) => (
								<div className="flex items-center justify-between rounded-lg border p-4">
									<div className="space-y-0.5">
										<Label htmlFor="skill-expiry">
											{t("settings.skills.requiresExpiry", "Requires Expiry Date")}
										</Label>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.skills.requiresExpiryHint",
												"Enable if this certification needs renewal (e.g., First Aid)",
											)}
										</p>
									</div>
									<Switch
										id="skill-expiry"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
									/>
								</div>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isMutating}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isMutating}>
							{isMutating && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
							{isEditing ? t("common.save", "Save") : t("common.create", "Create")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function SkillCatalogTable({
	skills,
	canManageCatalog,
	handleEdit,
	handleDelete,
	deleting,
}: {
	skills: SkillWithRelations[];
	canManageCatalog: boolean;
	handleEdit: (skill: SkillWithRelations) => void;
	handleDelete: (skill: SkillWithRelations) => void;
	deleting: boolean;
}) {
	const { t } = useTranslate();
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-[50px]">{t("settings.skills.category", "Category")}</TableHead>
					<TableHead>{t("settings.skills.name", "Name")}</TableHead>
					<TableHead>{t("settings.skills.expiry", "Expiry Tracking")}</TableHead>
					<TableHead className="w-[100px] text-right">{t("common.actions", "Actions")}</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{skills.map((skill) => {
					const CategoryIcon = getCategoryIcon(skill.category as SkillCategory);
					const categoryLabel =
						skill.category === "custom" && skill.customCategoryName
							? skill.customCategoryName
							: getCategoryLabel(skill.category as SkillCategory, t);
					return (
						<TableRow key={skill.id}>
							<TableCell>
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="flex items-center justify-center">
												<CategoryIcon className="size-5 text-muted-foreground" aria-hidden="true" />
												<span className="sr-only">{categoryLabel}</span>
											</div>
										</TooltipTrigger>
										<TooltipContent>{categoryLabel}</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							</TableCell>
							<TableCell className="max-w-xs">
								<div className="flex min-w-0 flex-col">
									<span className="truncate font-medium" title={skill.name}>
										{skill.name}
									</span>
									{skill.description && (
										<span
											className="text-xs text-muted-foreground line-clamp-1"
											title={skill.description}
										>
											{skill.description}
										</span>
									)}
								</div>
							</TableCell>
							<TableCell>
								{skill.requiresExpiry ? (
									<Badge variant="secondary">
										{t("settings.skills.expiryRequired", "Required")}
									</Badge>
								) : (
									<span className="text-muted-foreground text-sm">
										{t("settings.skills.noExpiry", "No")}
									</span>
								)}
							</TableCell>
							<TableCell className="text-right">
								<div className="flex items-center justify-end gap-1">
									{canManageCatalog ? (
										<>
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															className="size-8"
															onClick={() => handleEdit(skill)}
															aria-label={`${t("common.edit", "Edit")}: ${skill.name}`}
														>
															<IconEdit className="size-4" aria-hidden="true" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>{t("common.edit", "Edit")}</TooltipContent>
												</Tooltip>
											</TooltipProvider>
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															className="size-8"
															onClick={() => handleDelete(skill)}
															aria-label={`${t("common.delete", "Delete")}: ${skill.name}`}
															disabled={deleting}
														>
															<IconTrash className="size-4" aria-hidden="true" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>{t("common.delete", "Delete")}</TooltipContent>
												</Tooltip>
											</TooltipProvider>
										</>
									) : null}
								</div>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}

function SkillCatalogResults({
	isLoading,
	isError,
	error,
	isFetching,
	refetch,
	skills,
	canManageCatalog,
	handleCreate,
	handleEdit,
	handleDelete,
	deleting,
}: {
	isLoading: boolean;
	isError: boolean;
	error: Error | null;
	isFetching: boolean;
	refetch: () => void;
	skills: SkillWithRelations[];
	canManageCatalog: boolean;
	handleCreate: () => void;
	handleEdit: (skill: SkillWithRelations) => void;
	handleDelete: (skill: SkillWithRelations) => void;
	deleting: boolean;
}) {
	const { t } = useTranslate();
	return (
		<CardContent>
			{isLoading ? (
				<div
					className="flex items-center justify-center py-8"
					role="status"
					aria-label={t("common.loadingRegions.skillSettings", "Loading skill settings")}
				>
					<IconLoader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
				</div>
			) : isError ? (
				<div
					role="alert"
					className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
				>
					<p className="text-sm">
						{error?.message ||
							t("settings.skills.loadFailed", "The skill catalog could not be loaded.")}
					</p>
					<Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
						{t("common.retry", "Try again")}
					</Button>
				</div>
			) : skills.length === 0 ? (
				<div className="flex flex-col items-start gap-3 py-6 text-muted-foreground sm:items-center sm:text-center">
					<IconAward className="size-8 opacity-50" aria-hidden="true" />
					<div className="space-y-1">
						<p className="font-medium text-foreground">
							{t("settings.skills.noSkills", "No skills defined yet")}
						</p>
						{canManageCatalog ? (
							<p className="text-sm">
								{t("settings.skills.noSkillsHint", "Create your first skill to get started")}
							</p>
						) : null}
					</div>
					{canManageCatalog ? (
						<Button variant="outline" onClick={handleCreate}>
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.skills.addSkill", "Add Skill")}
						</Button>
					) : null}
				</div>
			) : (
				<SkillCatalogTable
					skills={skills}
					canManageCatalog={canManageCatalog}
					handleEdit={handleEdit}
					handleDelete={handleDelete}
					deleting={deleting}
				/>
			)}
		</CardContent>
	);
}
