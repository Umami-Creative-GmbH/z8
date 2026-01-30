"use client";

import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteOrganizationCategory,
	getOrganizationCategories,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
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
import { queryKeys } from "@/lib/query";
import { formatFactorAsMultiplier } from "@/lib/work-category/work-category.service";
import { WorkCategoryDialog } from "./work-category-dialog";

interface WorkCategoryTableProps {
	organizationId: string;
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

export function WorkCategoryTable({ organizationId }: WorkCategoryTableProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingCategory, setEditingCategory] = useState<CategoryData | null>(null);

	// Fetch org-level categories
	const {
		data: categoriesResult,
		isLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.workCategories.orgList(organizationId),
		queryFn: async () => {
			const result = await getOrganizationCategories(organizationId);
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
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategories.orgList(organizationId),
				});
				// Also invalidate sets as category counts may have changed
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategorySets.list(organizationId),
				});
			} else {
				toast.error(
					result.error ||
						t("settings.workCategories.categoryDeleteFailed", "Failed to delete category"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workCategories.categoryDeleteFailed", "Failed to delete category"));
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
		deleteMutation.mutate(category.id);
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
				<CardContent className="py-8">
					<p className="text-center text-destructive">
						{t("errors.failedToLoad", "Failed to load data")}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
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
						<Button onClick={handleCreateClick}>
							<IconPlus className="mr-2 h-4 w-4" aria-hidden="true" />
							{t("settings.workCategories.addCategory", "Add Category")}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{categories.length === 0 ? (
						<div className="py-8 text-center text-muted-foreground">
							<p>{t("settings.workCategories.noCategories", "No categories yet")}</p>
							<p className="text-sm">
								{t(
									"settings.workCategories.noCategoriesHint",
									"Create categories to assign them to sets",
								)}
							</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-[50px]">
										{t("settings.workCategories.color", "Color")}
									</TableHead>
									<TableHead>{t("settings.workCategories.categoryName", "Name")}</TableHead>
									<TableHead>{t("settings.workCategories.factor", "Factor")}</TableHead>
									<TableHead>{t("settings.workCategories.usedInSets", "Used in Sets")}</TableHead>
									<TableHead className="w-[100px] text-right">
										{t("common.actions", "Actions")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{categories.map((category) => (
									<TableRow key={category.id}>
										<TableCell>
											{category.color ? (
												<div
													className="h-6 w-6 rounded-full border"
													style={{ backgroundColor: category.color }}
													aria-hidden="true"
												/>
											) : (
												<div
													className="h-6 w-6 rounded-full border border-dashed bg-muted"
													aria-hidden="true"
												/>
											)}
										</TableCell>
										<TableCell>
											<div className="flex flex-col">
												<span className="font-medium">{category.name}</span>
												{category.description && (
													<span className="text-xs text-muted-foreground">
														{category.description}
													</span>
												)}
											</div>
										</TableCell>
										<TableCell>
											<Badge variant="outline">
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
										<TableCell className="text-right">
											<div className="flex items-center justify-end gap-1">
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="ghost"
																size="icon"
																className="h-8 w-8"
																onClick={() => handleEditClick(category)}
																aria-label={t("common.edit", "Edit")}
															>
																<IconEdit className="h-4 w-4" aria-hidden="true" />
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
																className="h-8 w-8 text-muted-foreground hover:text-destructive"
																onClick={() => handleDeleteClick(category)}
																disabled={deleteMutation.isPending || category.usedInSetsCount > 0}
																aria-label={
																	category.usedInSetsCount > 0
																		? t(
																				"settings.workCategories.cannotDeleteInUse",
																				"Remove from sets first",
																			)
																		: t("common.delete", "Delete")
																}
															>
																<IconTrash className="h-4 w-4" aria-hidden="true" />
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
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<WorkCategoryDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				organizationId={organizationId}
				category={editingCategory}
				onSuccess={handleDialogSuccess}
			/>
		</>
	);
}
