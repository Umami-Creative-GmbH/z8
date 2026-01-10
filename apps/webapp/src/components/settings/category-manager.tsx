"use client";

import {
	IconAlertCircle,
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteCategory,
	getHolidayCategories,
} from "@/app/[locale]/(app)/settings/holidays/actions";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query";

interface HolidayCategory {
	id: string;
	type: string;
	name: string;
	description: string | null;
	color: string | null;
	blocksTimeEntry: boolean;
	excludeFromCalculations: boolean;
	isActive: boolean;
}

interface CategoryManagerProps {
	organizationId: string;
	onAddClick: () => void;
	onEditClick: (category: HolidayCategory) => void;
}

export function CategoryManager({ organizationId, onAddClick, onEditClick }: CategoryManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Delete confirmation state
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [categoryToDelete, setCategoryToDelete] = useState<HolidayCategory | null>(null);

	// Fetch categories with TanStack Query
	const {
		data: categories = [],
		isLoading,
		error,
		refetch,
		isFetching,
	} = useQuery({
		queryKey: queryKeys.holidayCategories.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayCategories(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to load categories");
			}
			return result.data as HolidayCategory[];
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (categoryId: string) => deleteCategory(categoryId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.categories.deleted", "Category deleted successfully"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.holidayCategories.list(organizationId),
				});
			} else {
				toast.error(
					result.error ||
						t("settings.holidays.categories.deleteFailed", "Failed to delete category"),
				);
			}
			setDeleteConfirmOpen(false);
			setCategoryToDelete(null);
		},
		onError: () => {
			toast.error(t("settings.holidays.categories.deleteFailed", "Failed to delete category"));
			setDeleteConfirmOpen(false);
			setCategoryToDelete(null);
		},
	});

	const handleDeleteClick = (category: HolidayCategory) => {
		setCategoryToDelete(category);
		setDeleteConfirmOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (categoryToDelete) {
			deleteMutation.mutate(categoryToDelete.id);
		}
	};

	const formatCategoryType = (type: string) => {
		const typeMap: Record<string, string> = {
			public_holiday: t("settings.holidays.categories.types.public", "Public Holiday"),
			company_holiday: t("settings.holidays.categories.types.company", "Company Holiday"),
			training_day: t("settings.holidays.categories.types.training", "Training Day"),
			custom: t("settings.holidays.categories.types.custom", "Custom"),
		};
		return typeMap[type] || type;
	};

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">
						{t("settings.holidays.categories.title", "Holiday Categories")}
					</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.categories.add", "Add Category")}
					</Button>
				</div>
				<div className="rounded-md border p-8 flex items-center justify-center">
					<div className="flex items-center gap-2 text-muted-foreground">
						<IconLoader2 className="h-5 w-5 animate-spin" />
						<span>{t("settings.holidays.categories.loading", "Loading categories...")}</span>
					</div>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">
						{t("settings.holidays.categories.title", "Holiday Categories")}
					</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.categories.add", "Add Category")}
					</Button>
				</div>
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-4">
					<div className="flex items-center gap-2 text-destructive">
						<IconAlertCircle className="h-5 w-5" />
						<span>{error instanceof Error ? error.message : "Failed to load categories"}</span>
					</div>
					<Button onClick={() => refetch()} variant="outline" size="sm">
						{t("common.retry", "Retry")}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<>
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">
						{t("settings.holidays.categories.title", "Holiday Categories")}
					</h3>
					<div className="flex items-center gap-2">
						<Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
							{isFetching ? (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<IconRefresh className="mr-2 h-4 w-4" />
							)}
							{t("common.refresh", "Refresh")}
						</Button>
						<Button size="sm" onClick={onAddClick}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.holidays.categories.add", "Add Category")}
						</Button>
					</div>
				</div>

				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("settings.holidays.categories.name", "Name")}</TableHead>
								<TableHead>{t("settings.holidays.categories.type", "Type")}</TableHead>
								<TableHead>{t("settings.holidays.categories.color", "Color")}</TableHead>
								<TableHead>{t("settings.holidays.categories.settings", "Settings")}</TableHead>
								<TableHead className="text-right">
									{t("settings.holidays.categories.actions", "Actions")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{categories.length === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="text-center text-muted-foreground h-24">
										{t(
											"settings.holidays.categories.empty",
											"No categories found. Add your first category to get started.",
										)}
									</TableCell>
								</TableRow>
							) : (
								categories.map((category) => (
									<TableRow key={category.id}>
										<TableCell>
											<div>
												<div className="font-medium">{category.name}</div>
												{category.description && (
													<div className="text-sm text-muted-foreground">
														{category.description}
													</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											<Badge variant="outline">{formatCategoryType(category.type)}</Badge>
										</TableCell>
										<TableCell>
											{category.color ? (
												<div className="flex items-center gap-2">
													<div
														className="h-4 w-4 rounded-full border"
														style={{ backgroundColor: category.color }}
													/>
													<span className="text-sm text-muted-foreground">{category.color}</span>
												</div>
											) : (
												<span className="text-sm text-muted-foreground">
													{t("settings.holidays.categories.noColor", "No color")}
												</span>
											)}
										</TableCell>
										<TableCell>
											<div className="flex gap-2">
												{category.blocksTimeEntry && (
													<Badge variant="secondary" className="text-xs">
														{t("settings.holidays.categories.blocks", "Blocks Time Entry")}
													</Badge>
												)}
												{category.excludeFromCalculations && (
													<Badge variant="secondary" className="text-xs">
														{t("settings.holidays.categories.excludes", "Excludes from Calc")}
													</Badge>
												)}
											</div>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-2">
												<Button
													variant="ghost"
													size="icon"
													onClick={() => onEditClick(category)}
													disabled={deleteMutation.isPending}
												>
													<IconPencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleDeleteClick(category)}
													disabled={deleteMutation.isPending}
												>
													{deleteMutation.isPending && categoryToDelete?.id === category.id ? (
														<IconLoader2 className="h-4 w-4 animate-spin" />
													) : (
														<IconTrash className="h-4 w-4" />
													)}
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</div>

			<AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.categories.delete.title", "Delete Category")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.holidays.categories.delete.description",
								'Are you sure you want to delete "{name}"? This action cannot be undone. Categories in use by holidays cannot be deleted.',
								{ name: categoryToDelete?.name || "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							disabled={deleteMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
