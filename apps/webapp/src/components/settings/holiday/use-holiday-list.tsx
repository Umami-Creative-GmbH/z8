"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	bulkDeleteHolidays,
	deleteHoliday,
	getHolidayCategories,
	type HolidayWithCategory,
} from "@/app/[locale]/(app)/settings/holidays/actions";
import { createSelectionColumn, DataTableColumnHeader } from "@/components/data-table-server";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { queryKeys } from "@/lib/query";
import {
	HolidayCategoryCell,
	type HolidayCategoryOption,
	HolidayNameCell,
	HolidayRecurrenceCell,
	HolidayRowActions,
} from "./holiday-list-parts";

function formatDateRange(startDate: Date | string, endDate: Date | string) {
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
}

/** The organization's holiday categories, for the list's category filter. */
export function useHolidayCategoryOptions(organizationId: string) {
	const { data: categories = [] } = useQuery({
		queryKey: queryKeys.holidayCategories.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayCategories(organizationId);
			if (!result.success) throw new Error(result.error);
			return result.data as HolidayCategoryOption[];
		},
		enabled: !!organizationId,
	});
	return categories;
}

/**
 * Row selection and the single and bulk deletions of the holiday list, each
 * behind its confirmation dialog.
 */
export function useHolidayDeletion() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [holidayToDelete, setHolidayToDelete] = useState<HolidayWithCategory | null>(null);
	const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

	const closeDeleteConfirm = () => {
		setDeleteConfirmOpen(false);
		setHolidayToDelete(null);
	};

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
			closeDeleteConfirm();
		},
		onError: () => {
			toast.error(t("settings.holidays.deleteFailed", "Failed to delete holiday"));
			closeDeleteConfirm();
		},
	});

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

	const selectedIds = Object.keys(rowSelection);

	return {
		rowSelection,
		setRowSelection,
		selectedCount: selectedIds.length,
		deleteConfirmOpen,
		setDeleteConfirmOpen,
		holidayToDelete,
		deleteMutation,
		bulkDeleteConfirmOpen,
		setBulkDeleteConfirmOpen,
		bulkDeleteMutation,
		requestDelete: (holiday: HolidayWithCategory) => {
			setHolidayToDelete(holiday);
			setDeleteConfirmOpen(true);
		},
		confirmDelete: () => {
			if (holidayToDelete) deleteMutation.mutate(holidayToDelete.id);
		},
		requestBulkDelete: () => {
			if (selectedIds.length > 0) setBulkDeleteConfirmOpen(true);
		},
		confirmBulkDelete: () => bulkDeleteMutation.mutate(selectedIds),
	};
}

export function useHolidayColumns({
	canManage,
	isDeleting,
	deletingId,
	onEditClick,
	onDeleteClick,
}: {
	canManage: boolean;
	isDeleting: boolean;
	deletingId: string | undefined;
	onEditClick: (holiday: HolidayWithCategory) => void;
	onDeleteClick: (holiday: HolidayWithCategory) => void;
}): ColumnDef<DataTableFeatures, HolidayWithCategory>[] {
	const { t } = useTranslate();
	const actionsColumn: ColumnDef<DataTableFeatures, HolidayWithCategory> = {
		id: "actions",
		header: () => (
			<div className="text-right">{t("settings.holidays.list.actions", "Actions")}</div>
		),
		cell: ({ row }) => (
			<HolidayRowActions
				holiday={row.original}
				isDeleting={isDeleting}
				isDeletingThis={isDeleting && deletingId === row.original.id}
				onEdit={onEditClick}
				onDelete={onDeleteClick}
			/>
		),
	};

	return [
		...(canManage ? [createSelectionColumn<HolidayWithCategory>()] : []),
		{
			accessorKey: "name",
			header: ({ column }) => (
				<DataTableColumnHeader column={column} title={t("settings.holidays.list.name", "Name")} />
			),
			cell: ({ row }) => <HolidayNameCell holiday={row.original} />,
		},
		{
			accessorKey: "category",
			header: t("settings.holidays.list.category", "Category"),
			cell: ({ row }) => <HolidayCategoryCell holiday={row.original} />,
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
			cell: ({ row }) => <HolidayRecurrenceCell holiday={row.original} />,
		},
		...(canManage ? [actionsColumn] : []),
	];
}
