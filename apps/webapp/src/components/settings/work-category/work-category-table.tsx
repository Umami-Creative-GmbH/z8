"use client";

import { IconEdit, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteOrganizationCategory,
	getOrganizationCategories,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query";
import { formatFactorAsMultiplier } from "@/lib/work-category/work-category.service";
import { WorkCategoryDialog } from "./work-category-dialog";

interface WorkCategoryTableProps {
	organizationId: string;
	canManage: boolean;
}

interface CategoryData {
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

export function WorkCategoryTable({ organizationId, canManage }: WorkCategoryTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingCategory, setEditingCategory] = useState<CategoryData | null>(null);
	const [categoryToDelete, setCategoryToDelete] = useState<CategoryData | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	// Fetch org-level categories
	const {
		data: categoriesResult,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: queryKeys.workCategories.orgList(organizationId),
		queryFn: async () => {
			const result = await getOrganizationCategories();
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch categories");
			}
			return result.data;
		},
	});

	// Delete category mutation
	const deleteMutation = useMutation({
		mutationFn: (categoryId: string) => deleteOrganizationCategory(categoryId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workCategories.categoryDeleted", "Category deleted"));
				setCategoryToDelete(null);
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategories.orgList(organizationId),
				});
				// Also invalidate sets as category counts may have changed
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategorySets.list(organizationId),
				});
			} else {
				// The dialog stays open with the reason so the deletion can be retried.
				setDeleteError(
					actionErrorMessage(t, result, {}, [
						"settings.workCategories.categoryDeleteFailed",
						"Failed to delete category",
					]),
				);
			}
		},
		onError: () => {
			setDeleteError(
				t("settings.workCategories.categoryDeleteFailed", "Failed to delete category"),
			);
		},
	});

	const handleCreateClick = () => {
		setEditingCategory(null);
		setDialogOpen(true);
	};

	const handleEditClick = (category: CategoryData) => {
		setEditingCategory(category);
		setDialogOpen(true);
	};

	const handleDeleteClick = (category: CategoryData) => {
		if (category.usedInSetsCount > 0) {
			toast.error(
				t(
					"settings.workCategories.categoryInUse",
					"Cannot delete a category that is used in {count} set(s). Remove it from all sets first.",
					{ count: category.usedInSetsCount },
				),
			);
			return;
		}
		setDeleteError(null);
		setCategoryToDelete(category);
	};

	const handleDeleteConfirm = () => {
		if (categoryToDelete && !deleteMutation.isPending) {
			setDeleteError(null);
			deleteMutation.mutate(categoryToDelete.id);
		}
	};

	const handleDialogSuccess = () => {
		setDialogOpen(false);
		setEditingCategory(null);
		queryClient.invalidateQueries({
			queryKey: queryKeys.workCategories.orgList(organizationId),
		});
	};

	const categories = categoriesResult || [];

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-4 w-64" />
				</CardHeader>
				<CardContent>
					<div className="space-y-2">
						{[1, 2, 3].map((i) => (
							<Skeleton key={i} className="h-12 w-full" />
						))}
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center gap-4 py-8 text-center">
					<p role="alert" className="text-destructive">
						{t("settings.workCategories.categoriesLoadError", "Work categories could not be loaded")}
					</p>
					<Button variant="outline" onClick={() => refetch()}>
						<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						{t("common.retry", "Retry")}
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="min-w-0 space-y-1.5">
							<CardTitle>
								{t("settings.workCategories.categoriesTitle", "Work Categories")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.workCategories.categoriesDescription",
									"Create and manage work categories that can be shared across multiple sets",
								)}
							</CardDescription>
						</div>
						{canManage ? (
							<Button onClick={handleCreateClick}>
								<IconPlus className="mr-2 size-4" aria-hidden="true" />
								{t("settings.workCategories.addCategory", "Add Category")}
							</Button>
						) : null}
					</div>
				</CardHeader>
				<CardContent>
					{categories.length === 0 ? (
						<div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
							<div>
								<p>{t("settings.workCategories.noCategories", "No categories yet")}</p>
								<p className="text-sm">
									{t(
										"settings.workCategories.noCategoriesHint",
										"Create categories to assign them to sets",
									)}
								</p>
							</div>
							{canManage ? (
								<Button variant="outline" onClick={handleCreateClick}>
									<IconPlus className="mr-2 size-4" aria-hidden="true" />
									{t("settings.workCategories.addCategory", "Add Category")}
								</Button>
							) : null}
						</div>
					) : (
						<Table mobileLayout="stacked">
							<TableHeader>
								<TableRow>
									<TableHead className="w-[50px]">
										{t("settings.workCategories.color", "Color")}
									</TableHead>
									<TableHead>{t("settings.workCategories.categoryName", "Name")}</TableHead>
									<TableHead>{t("settings.workCategories.factor", "Factor")}</TableHead>
									<TableHead>{t("settings.workCategories.usedInSets", "Used in Sets")}</TableHead>
									{canManage ? (
										<TableHead className="w-[100px] text-right">
											{t("common.actions", "Actions")}
										</TableHead>
									) : null}
								</TableRow>
							</TableHeader>
							<TableBody>
								{categories.map((category) => (
									<TableRow key={category.id}>
										<TableCell>
											{category.color ? (
												<div
													className="size-6 rounded-full border"
													style={{ backgroundColor: category.color }}
													aria-hidden="true"
												/>
											) : (
												<div
													className="size-6 rounded-full border border-dashed bg-muted"
													aria-hidden="true"
												/>
											)}
										</TableCell>
										<TableCell className="max-w-xs">
											<div className="flex min-w-0 flex-col">
												<span className="truncate font-medium" title={category.name}>
													{category.name}
												</span>
												{category.description && (
													<span className="break-words text-xs text-muted-foreground">
														{category.description}
													</span>
												)}
											</div>
										</TableCell>
										<TableCell>
											<Badge variant="outline" className="tabular-nums">
												{formatFactorAsMultiplier(parseFloat(category.factor))}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge variant="secondary" className="tabular-nums">
												{category.usedInSetsCount}{" "}
												{category.usedInSetsCount === 1
													? t("common.set", "set")
													: t("common.sets", "sets")}
											</Badge>
										</TableCell>
										{canManage ? (
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	variant="ghost"
																	size="icon"
																	className="size-8"
																	onClick={() => handleEditClick(category)}
																	aria-label={t(
																		"settings.workCategories.editCategoryNamed",
																		"Edit category {name}",
																		{ name: category.name },
																	)}
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
																	className="size-8 text-muted-foreground hover:text-destructive"
																	onClick={() => handleDeleteClick(category)}
																	disabled={
																		deleteMutation.isPending || category.usedInSetsCount > 0
																	}
																	aria-label={
																		category.usedInSetsCount > 0
																			? t(
																					"settings.workCategories.cannotDeleteInUse",
																					"Remove from sets first",
																				)
																			: t(
																					"settings.workCategories.deleteCategoryNamed",
																					"Delete category {name}",
																					{ name: category.name },
																				)
																	}
																>
																	<IconTrash className="size-4" aria-hidden="true" />
																</Button>
															</TooltipTrigger>
															<TooltipContent>
																{category.usedInSetsCount > 0
																	? t(
																			"settings.workCategories.cannotDeleteInUse",
																			"Remove from sets first",
																		)
																	: t("common.delete", "Delete")}
															</TooltipContent>
														</Tooltip>
													</TooltipProvider>
												</div>
											</TableCell>
										) : null}
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{canManage ? (
				<WorkCategoryDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					organizationId={organizationId}
					category={editingCategory}
					onSuccess={handleDialogSuccess}
				/>
			) : null}

			<DeleteConfirmDialog
				open={canManage && categoryToDelete !== null}
				onOpenChange={(open) => {
					if (!open) {
						setCategoryToDelete(null);
						setDeleteError(null);
					}
				}}
				title={t("settings.workCategories.deleteCategoryTitle", "Delete category?")}
				description={t(
					"settings.workCategories.deleteCategoryDescription",
					'The category "{name}" will be permanently deleted.',
					{ name: categoryToDelete?.name ?? "" },
				)}
				isDeleting={deleteMutation.isPending}
				error={deleteError}
				onConfirm={handleDeleteConfirm}
			/>
		</>
	);
}
