"use client";

import { IconCheck, IconGripVertical, IconLoader2, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createWorkCategorySet,
	getOrganizationCategories,
	getWorkCategorySetDetail,
	reorderSetCategories,
	updateSetCategories,
	updateWorkCategorySet,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query";
import { formatFactorAsMultiplier } from "@/lib/work-category/work-category.service";

interface WorkCategorySetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	categorySet?: {
		id: string;
		name: string;
		description: string | null;
	} | null;
	onSuccess: () => void;
}

interface OrgCategory {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	factor: string;
	color: string | null;
	isActive: boolean;
	createdAt: Date;
	usedInSetsCount: number;
}

interface SetCategory {
	id: string;
	name: string;
	description: string | null;
	factor: string;
	color: string | null;
	sortOrder: number;
}

export function WorkCategorySetDialog({
	open,
	onOpenChange,
	organizationId,
	categorySet,
	onSuccess,
}: WorkCategorySetDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!categorySet;
	const metaScopeKey = `${open}:${categorySet?.id ?? "new"}`;

	const [metaDraft, setMetaDraft] = useState<{
		scopeKey: string;
		name: string;
		description: string;
	} | null>(null);
	const [selectionDraft, setSelectionDraft] = useState<{
		scopeKey: string;
		ids: string[];
	} | null>(null);

	// Fetch all org-level categories
	const { data: orgCategoriesResult, isLoading: isLoadingOrgCategories } = useQuery({
		queryKey: queryKeys.workCategories.orgList(organizationId),
		queryFn: async () => {
			const result = await getOrganizationCategories(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch categories");
			}
			return result.data;
		},
		enabled: open,
	});

	// Fetch category set details when editing
	const { data: setDetail, isLoading: isLoadingDetail } = useQuery({
		queryKey: queryKeys.workCategorySets.detail(categorySet?.id || ""),
		queryFn: async () => {
			if (!categorySet?.id) return null;
			const result = await getWorkCategorySetDetail(categorySet.id);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch category set");
			}
			return result.data as { set: typeof categorySet; categories: SetCategory[] };
		},
		enabled: isEditing && open,
	});

	const selectionScopeKey = `${metaScopeKey}:${setDetail?.categories.map((c) => c.id).join(",") ?? ""}`;

	const initialSelectedCategoryIds = isEditing ? (setDetail?.categories.map((c) => c.id) ?? []) : [];
	const selectedCategoryIds =
		selectionDraft?.scopeKey === selectionScopeKey
			? selectionDraft.ids
			: initialSelectedCategoryIds;

	const metaValues =
		metaDraft?.scopeKey === metaScopeKey
			? { name: metaDraft.name, description: metaDraft.description }
			: {
				name: categorySet?.name || "",
				description: categorySet?.description || "",
			};

	// Create set mutation
	const createSetMutation = useMutation({
		mutationFn: (data: { name: string; description: string | null; categoryIds: string[] }) =>
			createWorkCategorySet({
				organizationId,
				name: data.name,
				description: data.description,
				categoryIds: data.categoryIds,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workCategories.setCreated", "Category set created"));
				onSuccess();
			} else {
				toast.error(
					result.error ||
						t("settings.workCategories.setCreateFailed", "Failed to create category set"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workCategories.setCreateFailed", "Failed to create category set"));
		},
	});

	// Update set mutation
	const updateSetMutation = useMutation({
		mutationFn: (data: { setId: string; name: string; description: string | null }) =>
			updateWorkCategorySet({ setId: data.setId, name: data.name, description: data.description }),
		onSuccess: async (result) => {
			if (result.success) {
				// Also update the categories in the set
				const updateResult = await updateSetCategories(categorySet!.id, selectedCategoryIds);
				if (updateResult.success) {
					toast.success(t("settings.workCategories.setUpdated", "Category set updated"));
					queryClient.invalidateQueries({
						queryKey: queryKeys.workCategorySets.detail(categorySet!.id),
					});
					queryClient.invalidateQueries({
						queryKey: queryKeys.workCategorySets.list(organizationId),
					});
					onSuccess();
				} else {
					toast.error(
						updateResult.error ||
							t("settings.workCategories.setUpdateFailed", "Failed to update categories"),
					);
				}
			} else {
				toast.error(
					result.error ||
						t("settings.workCategories.setUpdateFailed", "Failed to update category set"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workCategories.setUpdateFailed", "Failed to update category set"));
		},
	});

	// Toggle category selection
	const handleToggleCategory = (categoryId: string) => {
		setSelectionDraft((prev) => {
			const currentIds = prev?.scopeKey === selectionScopeKey ? prev.ids : selectedCategoryIds;
			const nextIds = currentIds.includes(categoryId)
				? currentIds.filter((id) => id !== categoryId)
				: [...currentIds, categoryId];

			return {
				scopeKey: selectionScopeKey,
				ids: nextIds,
			};
		});
	};

	// Move category up in order
	const moveUp = (index: number) => {
		if (index === 0) return;
		setSelectionDraft((prev) => {
			const currentIds = prev?.scopeKey === selectionScopeKey ? prev.ids : selectedCategoryIds;
			const newIds = [...currentIds];
			[newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
			return {
				scopeKey: selectionScopeKey,
				ids: newIds,
			};
		});
	};

	// Move category down in order
	const moveDown = (index: number) => {
		setSelectionDraft((prev) => {
			const currentIds = prev?.scopeKey === selectionScopeKey ? prev.ids : selectedCategoryIds;
			if (index === currentIds.length - 1) {
				return {
					scopeKey: selectionScopeKey,
					ids: currentIds,
				};
			}

			const newIds = [...currentIds];
			[newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]];
			return {
				scopeKey: selectionScopeKey,
				ids: newIds,
			};
		});
	};

	// Remove category from selection
	const removeCategory = (categoryId: string) => {
		setSelectionDraft((prev) => {
			const currentIds = prev?.scopeKey === selectionScopeKey ? prev.ids : selectedCategoryIds;
			return {
				scopeKey: selectionScopeKey,
				ids: currentIds.filter((id) => id !== categoryId),
			};
		});
	};

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();

		if (isEditing && categorySet) {
			updateSetMutation.mutate({
				setId: categorySet.id,
				name: metaValues.name,
				description: metaValues.description || null,
			});
			return;
		}

		createSetMutation.mutate({
			name: metaValues.name,
			description: metaValues.description || null,
			categoryIds: selectedCategoryIds,
		});
	};

	const orgCategories = orgCategoriesResult || [];
	const isLoading = isLoadingOrgCategories || (isEditing && isLoadingDetail);
	const isMutating = createSetMutation.isPending || updateSetMutation.isPending;

	// Get selected categories in order with their data
	const selectedCategories = selectedCategoryIds
		.map((id) => orgCategories.find((c) => c.id === id))
		.filter((c): c is OrgCategory => c !== undefined);

	// Get unselected categories
	const unselectedCategories = orgCategories.filter((c) => !selectedCategoryIds.includes(c.id));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.workCategories.editSet", "Edit Category Set")
							: t("settings.workCategories.createSet", "Create Category Set")}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? t(
									"settings.workCategories.editSetDescription",
									"Update the category set details and manage its categories",
								)
							: t(
									"settings.workCategories.createSetDescription",
									"Create a new category set and select which categories to include",
								)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={handleSubmit}
					className="flex-1 overflow-hidden flex flex-col"
				>
					<div className="flex-1 overflow-y-auto space-y-4 py-4">
						{/* Set Name */}
						<div className="space-y-2 px-1">
							<Label htmlFor="set-name">{t("settings.workCategories.setName", "Name")}</Label>
							<Input
								id="set-name"
								value={metaValues.name}
								onChange={(e) => {
									setMetaDraft({
										scopeKey: metaScopeKey,
										name: e.target.value,
										description: metaValues.description,
									});
								}}
								placeholder={t(
									"settings.workCategories.setNamePlaceholder",
									"e.g., Travel Categories",
								)}
							/>
						</div>

						{/* Set Description */}
						<div className="space-y-2 px-1">
							<Label htmlFor="set-description">
								{t("settings.workCategories.setDescription", "Description")}
							</Label>
							<Textarea
								id="set-description"
								value={metaValues.description}
								onChange={(e) => {
									setMetaDraft({
										scopeKey: metaScopeKey,
										name: metaValues.name,
										description: e.target.value,
									});
								}}
								placeholder={t(
									"settings.workCategories.setDescriptionPlaceholder",
									"Optional description for this category set",
								)}
								rows={2}
							/>
						</div>

						<Separator />

						{/* Categories Section */}
						<div className="space-y-4 px-1">
							<div className="flex items-center justify-between">
								<Label>{t("settings.workCategories.selectCategories", "Select Categories")}</Label>
								<Badge variant="secondary">
									{selectedCategoryIds.length} {t("common.selected", "selected")}
								</Badge>
							</div>

							{isLoading ? (
								<div className="space-y-2">
									{[1, 2, 3].map((i) => (
										<Skeleton key={i} className="h-12 w-full" />
									))}
								</div>
							) : orgCategories.length === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									<p>
										{t("settings.workCategories.noCategoriesAvailable", "No categories available")}
									</p>
									<p className="text-sm">
										{t(
											"settings.workCategories.createCategoriesFirst",
											"Create categories in the Categories tab first",
										)}
									</p>
								</div>
							) : (
								<div className="space-y-4">
									{/* Selected categories (sortable) */}
									{selectedCategories.length > 0 && (
										<div className="space-y-2">
											<p className="text-sm text-muted-foreground">
												{t(
													"settings.workCategories.selectedCategories",
													"Selected categories (drag to reorder)",
												)}
											</p>
											<div className="space-y-1 rounded-lg border p-2">
												{selectedCategories.map((category, index) => (
													<div
														key={category.id}
														className="flex items-center gap-2 rounded-md bg-muted/50 p-2"
													>
														<div className="flex flex-col gap-0.5">
															<Button
																type="button"
																variant="ghost"
																size="icon"
																className="h-4 w-4 p-0"
																onClick={() => moveUp(index)}
																disabled={index === 0}
																aria-label={t("common.moveUp", "Move up")}
															>
																<span className="text-xs" aria-hidden="true">
																	&#9650;
																</span>
															</Button>
															<Button
																type="button"
																variant="ghost"
																size="icon"
																className="h-4 w-4 p-0"
																onClick={() => moveDown(index)}
																disabled={index === selectedCategories.length - 1}
																aria-label={t("common.moveDown", "Move down")}
															>
																<span className="text-xs" aria-hidden="true">
																	&#9660;
																</span>
															</Button>
														</div>
														{category.color && (
															<div
																className="h-4 w-4 rounded-full flex-shrink-0"
																style={{ backgroundColor: category.color }}
																aria-hidden="true"
															/>
														)}
														<span className="flex-1 font-medium text-sm">{category.name}</span>
														<Badge variant="outline" className="text-xs">
															{formatFactorAsMultiplier(parseFloat(category.factor))}
														</Badge>
														<Button
															type="button"
															variant="ghost"
															size="icon"
															className="h-6 w-6"
															onClick={() => removeCategory(category.id)}
															aria-label={t("common.remove", "Remove")}
														>
															<IconX className="h-3 w-3" aria-hidden="true" />
														</Button>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Available categories to add */}
									{unselectedCategories.length > 0 && (
										<div className="space-y-2">
											<p className="text-sm text-muted-foreground">
												{t("settings.workCategories.availableCategories", "Available categories")}
											</p>
											<ScrollArea className="h-[200px] rounded-lg border p-2">
												<div className="space-y-1">
													{unselectedCategories.map((category) => (
														<div
															key={category.id}
															role="button"
															tabIndex={0}
															className="flex items-center gap-2 rounded-md p-2 hover:bg-muted/50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
															onClick={() => handleToggleCategory(category.id)}
															onKeyDown={(e) => {
																if (e.key === "Enter" || e.key === " ") {
																	e.preventDefault();
																	handleToggleCategory(category.id);
																}
															}}
														>
															<Checkbox
																checked={selectedCategoryIds.includes(category.id)}
																onCheckedChange={() => handleToggleCategory(category.id)}
																tabIndex={-1}
															/>
															{category.color && (
																<div
																	className="h-4 w-4 rounded-full flex-shrink-0"
																	style={{ backgroundColor: category.color }}
																	aria-hidden="true"
																/>
															)}
															<span className="flex-1 text-sm">{category.name}</span>
															<Badge variant="outline" className="text-xs">
																{formatFactorAsMultiplier(parseFloat(category.factor))}
															</Badge>
														</div>
													))}
												</div>
											</ScrollArea>
										</div>
									)}
								</div>
							)}
						</div>
					</div>

					<DialogFooter className="pt-4 border-t">
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isMutating || isLoading}>
							{isMutating ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									{t("common.saving", "Saving...")}
								</>
							) : isEditing ? (
								t("common.save", "Save")
							) : (
								t("common.create", "Create")
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
