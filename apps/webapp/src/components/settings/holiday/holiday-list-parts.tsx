"use client";

import { IconLoader2, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import type { PaginationState } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import type { Dispatch, SetStateAction } from "react";
import type { HolidayWithCategory } from "@/app/[locale]/(app)/settings/holidays/actions";
import {
	DataTablePagination,
	DataTableSkeleton,
	DataTableToolbar,
} from "@/components/data-table-server";
import type { DataTablePaginationTable } from "@/components/data-table-server/data-table-pagination";
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

export interface HolidayCategoryOption {
	id: string;
	name: string;
	color: string | null;
}

function AddHolidayButton({ onClick }: { onClick: () => void }) {
	const { t } = useTranslate();
	return (
		<Button size="sm" onClick={onClick}>
			<IconPlus className="mr-2 size-4" />
			{t("settings.holidays.add", "Add Holiday")}
		</Button>
	);
}

/** The list title, with the Add button for a manager while the table is not shown yet. */
export function HolidayListHeading({
	canManage = false,
	onAddClick,
}: {
	canManage?: boolean;
	onAddClick?: () => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex justify-between items-center">
			<h3 className="text-lg font-medium">{t("settings.holidays.list.title", "Holidays")}</h3>
			{canManage && onAddClick ? <AddHolidayButton onClick={onAddClick} /> : null}
		</div>
	);
}

export function HolidayListLoading({
	canManage,
	onAddClick,
}: {
	canManage: boolean;
	onAddClick: () => void;
}) {
	return (
		<div className="space-y-4">
			<HolidayListHeading canManage={canManage} onAddClick={onAddClick} />
			<DataTableSkeleton columnCount={canManage ? 5 : 4} rowCount={10} showSelection={canManage} />
		</div>
	);
}

export function HolidayListError({
	canManage,
	onAddClick,
	onRetry,
}: {
	canManage: boolean;
	onAddClick: () => void;
	onRetry: () => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-4">
			<HolidayListHeading canManage={canManage} onAddClick={onAddClick} />
			<div className="rounded-md border border-destructive/50 bg-destructive/10 p-8 flex flex-col items-center justify-center gap-4">
				<div className="text-destructive">
					{t("settings.holidays.loadError", "Failed to load holidays")}
				</div>
				<Button onClick={onRetry} variant="outline" size="sm">
					{t("common.retry", "Retry")}
				</Button>
			</div>
		</div>
	);
}

function HolidayBulkDeleteButton({
	count,
	isDeleting,
	onClick,
}: {
	count: number;
	isDeleting: boolean;
	onClick: () => void;
}) {
	const { t } = useTranslate();
	return (
		<Button size="sm" variant="destructive" onClick={onClick} disabled={isDeleting}>
			{isDeleting ? (
				<IconLoader2 className="mr-2 size-4 animate-spin" />
			) : (
				<IconTrash className="mr-2 size-4" />
			)}
			{t("settings.holidays.deleteSelected", "Delete ({count})", { count })}
		</Button>
	);
}

/** The category filter: "All" first, then the organization's holiday categories. */
function categoryFilterConfig(
	categories: HolidayCategoryOption[],
	t: ReturnType<typeof useTranslate>["t"],
): FilterConfig[] {
	return [
		{
			key: "categoryId",
			label: t("settings.holidays.list.category", "Category"),
			options: [
				{ label: t("common.all", "All"), value: "all" },
				...categories.map((cat) => ({ label: cat.name, value: cat.id })),
			],
			defaultValue: "all",
		},
	];
}

export function HolidayListToolbar({
	search,
	onSearchChange,
	categories,
	categoryId,
	onCategoryChange,
	canManage,
	selectedCount,
	isBulkDeleting,
	onBulkDelete,
	onAddClick,
}: {
	search: string;
	onSearchChange: (value: string) => void;
	categories: HolidayCategoryOption[];
	categoryId: string;
	onCategoryChange: (value: string) => void;
	canManage: boolean;
	selectedCount: number;
	isBulkDeleting: boolean;
	onBulkDelete: () => void;
	onAddClick: () => void;
}) {
	const { t } = useTranslate();
	return (
		<DataTableToolbar
			search={search}
			onSearchChange={onSearchChange}
			searchPlaceholder={t("settings.holidays.searchPlaceholder", "Search holidays...")}
			filters={categoryFilterConfig(categories, t)}
			filterValues={{ categoryId }}
			onFilterChange={(key, value) => {
				if (key === "categoryId") onCategoryChange(value);
			}}
			bulkActions={
				canManage && selectedCount > 0 ? (
					<HolidayBulkDeleteButton
						count={selectedCount}
						isDeleting={isBulkDeleting}
						onClick={onBulkDelete}
					/>
				) : null
			}
			actions={canManage ? <AddHolidayButton onClick={onAddClick} /> : null}
		/>
	);
}

export function HolidayNameCell({ holiday }: { holiday: HolidayWithCategory }) {
	return (
		<div>
			<div className="font-medium">{holiday.name}</div>
			{holiday.description && (
				<div className="text-sm text-muted-foreground">{holiday.description}</div>
			)}
		</div>
	);
}

export function HolidayCategoryCell({ holiday }: { holiday: HolidayWithCategory }) {
	return (
		<div className="flex items-center gap-2">
			{holiday.category.color && (
				<div
					className="size-3 rounded-full border"
					style={{ backgroundColor: holiday.category.color }}
				/>
			)}
			<span className="text-sm">{holiday.category.name}</span>
		</div>
	);
}

export function HolidayRecurrenceCell({ holiday }: { holiday: HolidayWithCategory }) {
	const { t } = useTranslate();
	return holiday.recurrenceType === "none" ? (
		<span className="text-sm text-muted-foreground">
			{t("settings.holidays.recurrence.none", "One-time")}
		</span>
	) : (
		<Badge variant="secondary">{t("settings.holidays.recurrence.yearly", "Yearly")}</Badge>
	);
}

export function HolidayRowActions({
	holiday,
	isDeleting,
	isDeletingThis,
	onEdit,
	onDelete,
}: {
	holiday: HolidayWithCategory;
	/** Any single deletion is running, which locks every row's actions. */
	isDeleting: boolean;
	/** This row's holiday is the one being deleted. */
	isDeletingThis: boolean;
	onEdit: (holiday: HolidayWithCategory) => void;
	onDelete: (holiday: HolidayWithCategory) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex justify-end gap-2">
			<Button
				variant="ghost"
				size="icon"
				onClick={() => onEdit(holiday)}
				aria-label={`${t("common.edit", "Edit")}: ${holiday.name}`}
				disabled={isDeleting}
			>
				<IconPencil className="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				onClick={() => onDelete(holiday)}
				aria-label={`${t("common.delete", "Delete")}: ${holiday.name}`}
				disabled={isDeleting}
			>
				{isDeletingThis ? (
					<IconLoader2 className="size-4 animate-spin" />
				) : (
					<IconTrash className="size-4" />
				)}
			</Button>
		</div>
	);
}

const NO_ROWS = { rows: [], flatRows: [], rowsById: {} };

/** Server-side pagination: the table facade `DataTablePagination` drives from the list's state. */
export function HolidayListPagination({
	pagination,
	setPagination,
	pageCount,
	total,
	showSelectedCount,
}: {
	pagination: PaginationState;
	setPagination: Dispatch<SetStateAction<PaginationState>>;
	pageCount: number;
	total: number;
	showSelectedCount: boolean;
}) {
	return (
		<DataTablePagination
			table={
				{
					state: { pagination },
					getPageCount: () => pageCount,
					getCanPreviousPage: () => pagination.pageIndex > 0,
					getCanNextPage: () => pagination.pageIndex < pageCount - 1,
					previousPage: () =>
						setPagination((prev) => ({
							...prev,
							pageIndex: prev.pageIndex - 1,
						})),
					nextPage: () =>
						setPagination((prev) => ({
							...prev,
							pageIndex: prev.pageIndex + 1,
						})),
					setPageIndex: (updater) =>
						setPagination((prev) => ({
							...prev,
							pageIndex: typeof updater === "function" ? updater(prev.pageIndex) : updater,
						})),
					setPageSize: (updater) =>
						setPagination((prev) => ({
							pageIndex: 0,
							pageSize: typeof updater === "function" ? updater(prev.pageSize) : updater,
						})),
					getFilteredSelectedRowModel: () => NO_ROWS,
					getFilteredRowModel: () => NO_ROWS,
				} satisfies DataTablePaginationTable<HolidayWithCategory>
			}
			totalRows={total}
			showSelectedCount={showSelectedCount}
		/>
	);
}

export function HolidayBulkDeleteDialog({
	open,
	onOpenChange,
	count,
	isDeleting,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	count: number;
	isDeleting: boolean;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.holidays.bulkDelete.title", "Delete Multiple Holidays")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.holidays.bulkDelete.description",
							"Are you sure you want to delete {count} holidays? This action cannot be undone.",
							{ count },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						disabled={isDeleting}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{isDeleting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("settings.holidays.bulkDelete.confirm", "Delete {count} Holidays", { count })}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
