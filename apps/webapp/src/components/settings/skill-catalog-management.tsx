"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import {
	IconAward,
	IconCertificate,
	IconEdit,
	IconLanguage,
	IconLoader2,
	IconPlus,
	IconRefresh,
	IconShieldCheck,
	IconTools,
	IconTrash,
	IconSchool,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	createSkill,
	updateSkill,
	deleteSkill,
} from "@/app/[locale]/(app)/settings/skills/actions";
import type { SkillWithRelations } from "@/lib/effect/services/skill.service";
import { queryKeys } from "@/lib/query/keys";

type SkillCategory = "safety" | "equipment" | "certification" | "training" | "language" | "custom";

interface SkillCatalogManagementProps {
	organizationId: string;
}

const SKILL_CATEGORIES: Array<{ value: SkillCategory; label: string; icon: typeof IconShieldCheck }> = [
	{ value: "safety", label: "Safety", icon: IconShieldCheck },
	{ value: "equipment", label: "Equipment", icon: IconTools },
	{ value: "certification", label: "Certification", icon: IconCertificate },
	{ value: "training", label: "Training", icon: IconSchool },
	{ value: "language", label: "Language", icon: IconLanguage },
	{ value: "custom", label: "Custom", icon: IconAward },
];

function getCategoryIcon(category: SkillCategory) {
	const found = SKILL_CATEGORIES.find((c) => c.value === category);
	return found?.icon ?? IconAward;
}

function getCategoryLabel(category: SkillCategory) {
	const found = SKILL_CATEGORIES.find((c) => c.value === category);
	return found?.label ?? category;
}

export function SkillCatalogManagement({ organizationId }: SkillCatalogManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingSkill, setEditingSkill] = useState<SkillWithRelations | null>(null);

	// Fetch skills
	const {
		data: skillsResult,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.skills.list(organizationId, false),
		queryFn: async () => {
			const response = await fetch("/api/settings/skills?includeInactive=false", {
				method: "GET",
			});

			const result = await response.json().catch(() => null);
			if (!response.ok || !result?.success) {
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
			if (!result.success) throw new Error(result.error);
		},
		onSuccess: () => {
			toast.success(t("settings.skills.skillDeleted", "Skill deleted"));
			queryClient.invalidateQueries({ queryKey: queryKeys.skills.list(organizationId) });
		},
		onError: (error) => {
			toast.error(error.message || t("settings.skills.deleteError", "Failed to delete skill"));
		},
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
		if (confirm(t("settings.skills.confirmDelete", "Are you sure you want to delete this skill?"))) {
			deleteMutation.mutate(skill.id);
		}
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.skills.list(organizationId) });
		setDialogOpen(false);
		setEditingSkill(null);
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.skills.title", "Skills & Qualifications")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.skills.description",
							"Manage skills and certifications that can be assigned to employees"
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						<IconRefresh className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
					</Button>
					<Button onClick={handleCreate}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.skills.addSkill", "Add Skill")}
					</Button>
				</div>
			</div>

			{/* Content */}
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.skills.catalog", "Skill Catalog")}</CardTitle>
					<CardDescription>
						{t(
							"settings.skills.catalogDescription",
							"Define skills that can be required for subareas and shift templates"
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					) : skills.length === 0 ? (
						<div className="py-8 text-center text-muted-foreground">
							<IconAward className="mx-auto h-12 w-12 mb-4 opacity-50" />
							<p>{t("settings.skills.noSkills", "No skills defined yet")}</p>
							<p className="text-sm mt-1">
								{t("settings.skills.noSkillsHint", "Create your first skill to get started")}
							</p>
						</div>
					) : (
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
									return (
										<TableRow key={skill.id}>
											<TableCell>
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<div className="flex items-center justify-center">
																<CategoryIcon className="h-5 w-5 text-muted-foreground" />
															</div>
														</TooltipTrigger>
														<TooltipContent>
															{skill.category === "custom" && skill.customCategoryName
																? skill.customCategoryName
																: getCategoryLabel(skill.category as SkillCategory)}
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											</TableCell>
											<TableCell>
												<div className="flex flex-col">
													<span className="font-medium">{skill.name}</span>
													{skill.description && (
														<span className="text-xs text-muted-foreground line-clamp-1">
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
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	variant="ghost"
																	size="icon"
																	className="h-8 w-8"
																	onClick={() => handleEdit(skill)}
																>
																	<IconEdit className="h-4 w-4" />
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
																	className="h-8 w-8"
																	onClick={() => handleDelete(skill)}
																	disabled={deleteMutation.isPending}
																>
																	<IconTrash className="h-4 w-4" />
																</Button>
															</TooltipTrigger>
															<TooltipContent>{t("common.delete", "Delete")}</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Create/Edit Dialog */}
			<SkillDialog
				organizationId={organizationId}
				skill={editingSkill}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSuccess={handleSuccess}
			/>
		</div>
	);
}

// ============================================
// Skill Dialog Component
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
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.skills.skillCreated", "Skill created"));
			onSuccess();
		},
		onError: (error) => {
			toast.error(error.message || t("settings.skills.createError", "Failed to create skill"));
		},
	});

	const updateMutation = useMutation({
		mutationFn: async (data: SkillFormValues & { skillId: string }) => {
			const result = await updateSkill(data.skillId, {
				name: data.name,
				description: data.description || undefined,
				category: data.category,
				customCategoryName: data.category === "custom" ? data.customCategoryName : undefined,
				requiresExpiry: data.requiresExpiry,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
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
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.skills.editSkill", "Edit Skill")
							: t("settings.skills.createSkill", "Create Skill")}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? t("settings.skills.editSkillDescription", "Update the skill details")
							: t(
									"settings.skills.createSkillDescription",
									"Create a new skill that can be assigned to employees"
								)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<div className="grid gap-4 py-4">
						{/* Name */}
						<form.Field name="name">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="skill-name">
										{t("settings.skills.skillName", "Name")} *
									</Label>
									<Input
										id="skill-name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("settings.skills.namePlaceholder", "e.g., Forklift License")}
									/>
								</div>
							)}
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
											<SelectValue placeholder={t("settings.skills.selectCategory", "Select category")} />
										</SelectTrigger>
										<SelectContent>
											{SKILL_CATEGORIES.map((cat) => (
												<SelectItem key={cat.value} value={cat.value}>
													<span className="flex items-center gap-2">
														<cat.icon className="h-4 w-4" />
														{cat.label}
													</span>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{/* Custom Category Name (conditional) */}
						<form.Subscribe selector={(state) => state.values.category}>
							{(category) =>
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
													placeholder={t("settings.skills.customCategoryPlaceholder", "e.g., Compliance")}
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
											"Optional description of the skill or certification"
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
												"Enable if this certification needs renewal (e.g., First Aid)"
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
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isMutating}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isMutating}>
							{isMutating && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing
								? t("common.save", "Save")
								: t("common.create", "Create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
