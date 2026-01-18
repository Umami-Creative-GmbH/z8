"use client";

import {
	IconLoader2,
	IconPencil,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	deleteCategory,
	getHolidayCategories,
} from "@/app/[locale]/(app)/settings/holidays/actions";
import {
	DataTable,
	DataTableSkeleton,
	DataTableToolbar,
} from "@/components/data-table-server";
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
	const [search, setSearch] = useState("");

	// Delete confirmation state
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [categoryToDelete, setCategoryToDelete] = useState<HolidayCategory | null>(null);

	// Fetch categories with TanStack Query
	const {
		data: categories,
		isLoading,
		isError,
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

	// Filter categories by search (client-side since typically small list)
	const filteredCategories = useMemo(() => {
		if (!categories) return [];
		if (!search) return categories;

		const searchLower = search.toLowerCase();
		return categories.filter(
			(cat) =>
				cat.name.toLowerCase().includes(searchLower) ||
				cat.description?.toLowerCase().includes(searchLower),
		);
	}, [categories, search]);

	// Column definitions
	const columns = useMemo<ColumnDef<HolidayCategory>[]>(
		() => [
			{
				accessorKey: "name",
				header: t("settings.holidays.categories.name", "Name"),
				cell: ({ row }) => (
					<div>
						<div className="font-medium">{row.original.name}</div>
						{row.original.description && (
							<div className="text-sm text-muted-foreground">{row.original.description}</div>
						)}
					</div>
				),
			},
			{
				accessorKey: "type",
				header: t("settings.holidays.categories.type", "Type"),
				cell: ({ row }) => (
					<Badge variant="outline">{formatCategoryType(row.original.type)}</Badge>
				),
			},
			{
				accessorKey: "color",
				header: t("settings.holidays.categories.color", "Color"),
				cell: ({ row }) =>
					row.original.color ? (
						<div className="flex items-center gap-2">
							<div
								className="h-4 w-4 rounded-full border"
								style={{ backgroundColor: row.original.color }}
							/>
							<span className="text-sm text-muted-foreground">{row.original.color}</span>
						</div>
					) : (
						<span className="text-sm text-muted-foreground">
							{t("settings.holidays.categories.noColor", "No color")}
						</span>
					),
			},
			{
				accessorKey: "settings",
				header: t("settings.holidays.categories.settings", "Settings"),
				cell: ({ row }) => (
					<div className="flex gap-2">
						{row.original.blocksTimeEntry && (
							<Badge variant="secondary" className="text-xs">
								{t("settings.holidays.categories.blocks", "Blocks Time Entry")}
							</Badge>
						)}
						{row.original.excludeFromCalculations && (
							<Badge variant="secondary" className="text-xs">
								{t("settings.holidays.categories.excludes", "Excludes from Calc")}
							</Badge>
						)}
					</div>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<div className="flex justify-end gap-2">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => onEditClick(row.original)}
							disabled={deleteMutation.isPending}
						>
							<IconPencil className="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => handleDeleteClick(row.original)}
							disabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending && categoryToDelete?.id === row.original.id ? (
								<IconLoader2 className="h-4 w-4 animate-spin" />
							) : (
								<IconTrash className="h-4 w-4" />
							)}
						</Button>
					</div>
				),
			},
		],
		[t, onEditClick, deleteMutation.isPending, categoryToDelete?.id, formatCategoryType],
	);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-end">
					<Button onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.categories.add", "Add Category")}
					</Button>
				</div>
				<DataTableSkeleton columnCount={5} rowCount={5} />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
				<p className="text-destructive">
					{t("settings.holidays.categories.loadError", "Failed to load categories")}
				</p>
				<Button className="mt-4" variant="outline" onClick={() => refetch()}>
					<IconRefresh className="mr-2 h-4 w-4" />
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}

	return (
		<>
			<div className="space-y-4">
				<DataTableToolbar
					search={search}
					onSearchChange={setSearch}
					searchPlaceholder={t(
						"settings.holidays.categories.searchPlaceholder",
						"Search categories...",
					)}
					actions={
						<div className="flex items-center gap-2">
							<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
								{isFetching ? (
									<IconLoader2 className="h-4 w-4 animate-spin" />
								) : (
									<IconRefresh className="h-4 w-4" />
								)}
								<span className="sr-only">{t("common.refresh", "Refresh")}</span>
							</Button>
							<Button onClick={onAddClick}>
								<IconPlus className="mr-2 h-4 w-4" />
								{t("settings.holidays.categories.add", "Add Category")}
							</Button>
						</div>
					}
				/>

				<DataTable
					columns={columns}
					data={filteredCategories}
					isFetching={isFetching}
					emptyMessage={
						search
							? t("settings.holidays.categories.noSearchResults", "No categories match your search.")
							: t(
									"settings.holidays.categories.empty",
									"No categories found. Add your first category to get started.",
								)
					}
				/>
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
