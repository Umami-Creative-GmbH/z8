"use client";

import { IconLoader2, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	bulkDeleteHolidays,
	deleteHoliday,
	getHolidayCategories,
	type HolidayWithCategory,
} from "@/app/[locale]/(app)/settings/holidays/actions";
import {
	createSelectionColumn,
	DataTable,
	DataTableColumnHeader,
	DataTablePagination,
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
import type { FilterConfig } from "@/lib/data-table/types";
import { queryKeys } from "@/lib/query";
import { useHolidays } from "@/lib/query/use-holidays";

interface HolidayListProps {
	organizationId: string;
	onAddClick: () => void;
	onEditClick: (holiday: HolidayWithCategory) => void;
}

export function HolidayList({ organizationId, onAddClick, onEditClick }: HolidayListProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Use the holidays hook for data fetching
	const {
		holidays,
		total,
		isLoading,
		isFetching,
		isError,
		search,
		setSearch,
		categoryId,
		setCategoryId,
		sorting,
		setSorting,
		pagination,
		setPagination,
		pageCount,
		refresh,
	} = useHolidays({ organizationId });

	// Fetch categories for filter dropdown
	const { data: categories = [] } = useQuery({
		queryKey: queryKeys.holidayCategories.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayCategories(organizationId);
			if (!result.success) throw new Error(result.error);
			return result.data as Array<{ id: string; name: string; color: string | null }>;
		},
		enabled: !!organizationId,
	});

	// Row selection state
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

	// Delete confirmation state
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [holidayToDelete, setHolidayToDelete] = useState<HolidayWithCategory | null>(null);
	const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

	// Single delete mutation
	const deleteMutation = useMutation({
		mutationFn: (holidayId: string) => deleteHoliday(holidayId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.deleted", "Holiday deleted successfully"));
				queryClient.invalidateQueries({ queryKey: queryKeys.holidays.all });
			} else {
				toast.error(
					result.error || t("settings.holidays.deleteFailed", "Failed to delete holiday"),
				);
			}
			setDeleteConfirmOpen(false);
			setHolidayToDelete(null);
		},
		onError: () => {
			toast.error(t("settings.holidays.deleteFailed", "Failed to delete holiday"));
			setDeleteConfirmOpen(false);
			setHolidayToDelete(null);
		},
	});

	// Bulk delete mutation
	const bulkDeleteMutation = useMutation({
		mutationFn: (ids: string[]) => bulkDeleteHolidays(ids),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.holidays.bulkDeleted", "{count} holidays deleted", {
						count: result.data.deleted,
					}),
				);
				queryClient.invalidateQueries({ queryKey: queryKeys.holidays.all });
				setRowSelection({});
			} else {
				toast.error(
					result.error || t("settings.holidays.bulkDeleteFailed", "Failed to delete holidays"),
				);
			}
			setBulkDeleteConfirmOpen(false);
		},
		onError: () => {
			toast.error(t("settings.holidays.bulkDeleteFailed", "Failed to delete holidays"));
			setBulkDeleteConfirmOpen(false);
		},
	});

	const handleDeleteClick = (holiday: HolidayWithCategory) => {
		setHolidayToDelete(holiday);
		setDeleteConfirmOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (holidayToDelete) {
			deleteMutation.mutate(holidayToDelete.id);
		}
	};

	const handleBulkDeleteClick = () => {
		const selectedIds = Object.keys(rowSelection);
		if (selectedIds.length > 0) {
			setBulkDeleteConfirmOpen(true);
		}
	};

	const handleBulkDeleteConfirm = () => {
		const selectedIds = Object.keys(rowSelection);
		bulkDeleteMutation.mutate(selectedIds);
	};

	const formatDateRange = (startDate: Date | string, endDate: Date | string) => {
		const start = new Date(startDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
		const end = new Date(endDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});

		if (start === end) {
			return start;
		}

		return `${start} - ${end}`;
	};

	// Build filter config from categories
	const filterConfig: FilterConfig[] = useMemo(() => {
		const categoryOptions = [
			{ label: t("common.all", "All"), value: "all" },
			...categories.map((cat) => ({ label: cat.name, value: cat.id })),
		];

		return [
			{
				key: "categoryId",
				label: t("settings.holidays.list.category", "Category"),
				options: categoryOptions,
				defaultValue: "all",
			},
		];
	}, [categories, t]);

	// Column definitions
	const columns = useMemo<ColumnDef<HolidayWithCategory>[]>(
		() => [
			createSelectionColumn<HolidayWithCategory>(),
			{
				accessorKey: "name",
				header: ({ column }) => (
					<DataTableColumnHeader column={column} title={t("settings.holidays.list.name", "Name")} />
				),
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
				accessorKey: "category",
				header: t("settings.holidays.list.category", "Category"),
				cell: ({ row }) => (
					<div className="flex items-center gap-2">
						{row.original.category.color && (
							<div
								className="h-3 w-3 rounded-full border"
								style={{ backgroundColor: row.original.category.color }}
							/>
						)}
						<span className="text-sm">{row.original.category.name}</span>
					</div>
				),
			},
			{
				accessorKey: "startDate",
				header: ({ column }) => (
					<DataTableColumnHeader column={column} title={t("settings.holidays.list.date", "Date")} />
				),
				cell: ({ row }) => formatDateRange(row.original.startDate, row.original.endDate),
			},
			{
				accessorKey: "recurrenceType",
				header: t("settings.holidays.list.recurrence", "Recurrence"),
				cell: ({ row }) =>
					row.original.recurrenceType === "none" ? (
						<span className="text-sm text-muted-foreground">
							{t("settings.holidays.recurrence.none", "One-time")}
						</span>
					) : (
						<Badge variant="secondary">{t("settings.holidays.recurrence.yearly", "Yearly")}</Badge>
					),
			},
			{
				id: "actions",
				header: () => (
					<div className="text-right">{t("settings.holidays.list.actions", "Actions")}</div>
				),
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
							{deleteMutation.isPending && holidayToDelete?.id === row.original.id ? (
								<IconLoader2 className="h-4 w-4 animate-spin" />
							) : (
								<IconTrash className="h-4 w-4" />
							)}
						</Button>
					</div>
				),
			},
		],
		[t, onEditClick, deleteMutation.isPending, holidayToDelete?.id],
	);

	const selectedCount = Object.keys(rowSelection).length;

	// Loading state
	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.add", "Add Holiday")}
					</Button>
				</div>
				<DataTableSkeleton columnCount={5} rowCount={10} showSelection />
			</div>
		);
	}

	// Error state
	if (isError) {
		return (
			<div className="space-y-4">
				<div className="flex justify-between items-center">
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
					<Button size="sm" onClick={onAddClick}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.holidays.add", "Add Holiday")}
					</Button>
				</div>
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-4">
					<div className="text-destructive">
						{t("settings.holidays.loadError", "Failed to load holidays")}
					</div>
					<Button onClick={refresh} variant="outline" size="sm">
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
					<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
				</div>

				<DataTableToolbar
					search={search}
					onSearchChange={setSearch}
					searchPlaceholder={t("settings.holidays.searchPlaceholder", "Search holidays...")}
					filters={filterConfig}
					filterValues={{ categoryId }}
					onFilterChange={(key, value) => {
						if (key === "categoryId") setCategoryId(value);
					}}
					bulkActions={
						selectedCount > 0 ? (
							<Button
								size="sm"
								variant="destructive"
								onClick={handleBulkDeleteClick}
								disabled={bulkDeleteMutation.isPending}
							>
								{bulkDeleteMutation.isPending ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<IconTrash className="mr-2 h-4 w-4" />
								)}
								{t("settings.holidays.deleteSelected", "Delete ({count})", {
									count: selectedCount,
								})}
							</Button>
						) : null
					}
					actions={
						<Button size="sm" onClick={onAddClick}>
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.holidays.add", "Add Holiday")}
						</Button>
					}
				/>

				<DataTable
					columns={columns}
					data={holidays}
					pageCount={pageCount}
					pagination={pagination}
					onPaginationChange={setPagination}
					sorting={sorting}
					onSortingChange={setSorting}
					rowSelection={rowSelection}
					onRowSelectionChange={setRowSelection}
					manualPagination
					manualSorting
					enableRowSelection
					getRowId={(row) => row.id}
					isFetching={isFetching}
					emptyMessage={t(
						"settings.holidays.list.empty",
						"No holidays found. Add your first holiday to get started.",
					)}
				/>

				<DataTablePagination
					table={
						{
							getState: () => ({ pagination }),
							getPageCount: () => pageCount,
							getCanPreviousPage: () => pagination.pageIndex > 0,
							getCanNextPage: () => pagination.pageIndex < pageCount - 1,
							previousPage: () =>
								setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex - 1 })),
							nextPage: () => setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex + 1 })),
							setPageIndex: (index: number) =>
								setPagination((prev) => ({ ...prev, pageIndex: index })),
							setPageSize: (size: number) => setPagination({ pageIndex: 0, pageSize: size }),
							getFilteredSelectedRowModel: () => ({ rows: [] }),
							getFilteredRowModel: () => ({ rows: [] }),
						} as any
					}
					totalRows={total}
					showSelectedCount={selectedCount > 0}
				/>
			</div>

			{/* Single Delete Confirmation */}
			<AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.delete.title", "Delete Holiday")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.holidays.delete.description",
								'Are you sure you want to delete "{name}"? This action cannot be undone.',
								{ name: holidayToDelete?.name || "" },
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

			{/* Bulk Delete Confirmation */}
			<AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.bulkDelete.title", "Delete Multiple Holidays")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.holidays.bulkDelete.description",
								"Are you sure you want to delete {count} holidays? This action cannot be undone.",
								{ count: selectedCount },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={bulkDeleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleBulkDeleteConfirm}
							disabled={bulkDeleteMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{bulkDeleteMutation.isPending && (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							{t("settings.holidays.bulkDelete.confirm", "Delete {count} Holidays", {
								count: selectedCount,
							})}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
