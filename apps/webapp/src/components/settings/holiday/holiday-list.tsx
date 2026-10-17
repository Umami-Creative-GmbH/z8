"use client";

import { useTranslate } from "@tolgee/react";
import type { HolidayWithCategory } from "@/app/[locale]/(app)/settings/holidays/actions";
import { DataTable } from "@/components/data-table-server";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { useHolidays } from "@/lib/query/use-holidays";
import {
	HolidayBulkDeleteDialog,
	HolidayListError,
	HolidayListHeading,
	HolidayListLoading,
	HolidayListPagination,
	HolidayListToolbar,
} from "./holiday-list-parts";
import {
	useHolidayCategoryOptions,
	useHolidayColumns,
	useHolidayDeletion,
} from "./use-holiday-list";

interface HolidayListProps {
	organizationId: string;
	canManage: boolean;
	onAddClick: () => void;
	onEditClick: (holiday: HolidayWithCategory) => void;
}

export function HolidayList({
	organizationId,
	canManage,
	onAddClick,
	onEditClick,
}: HolidayListProps) {
	const { t } = useTranslate();

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

	const categories = useHolidayCategoryOptions(organizationId);
	const deletion = useHolidayDeletion();
	const { selectedCount } = deletion;

	const columns = useHolidayColumns({
		canManage,
		isDeleting: deletion.deleteMutation.isPending,
		deletingId: deletion.holidayToDelete?.id,
		onEditClick,
		onDeleteClick: deletion.requestDelete,
	});

	if (isLoading) {
		return <HolidayListLoading canManage={canManage} onAddClick={onAddClick} />;
	}

	if (isError) {
		return <HolidayListError canManage={canManage} onAddClick={onAddClick} onRetry={refresh} />;
	}

	return (
		<>
			<div className="space-y-4">
				<HolidayListHeading />

				<HolidayListToolbar
					search={search}
					onSearchChange={setSearch}
					categories={categories}
					categoryId={categoryId}
					onCategoryChange={setCategoryId}
					canManage={canManage}
					selectedCount={selectedCount}
					isBulkDeleting={deletion.bulkDeleteMutation.isPending}
					onBulkDelete={deletion.requestBulkDelete}
					onAddClick={onAddClick}
				/>

				<DataTable
					columns={columns}
					data={holidays}
					pageCount={pageCount}
					pagination={pagination}
					onPaginationChange={setPagination}
					sorting={sorting}
					onSortingChange={setSorting}
					rowSelection={deletion.rowSelection}
					onRowSelectionChange={deletion.setRowSelection}
					manualPagination
					manualSorting
					enableRowSelection={canManage}
					getRowId={(row) => row.id}
					isFetching={isFetching}
					emptyMessage={t(
						"settings.holidays.list.empty",
						"No holidays found. Add your first holiday to get started.",
					)}
				/>

				<HolidayListPagination
					pagination={pagination}
					setPagination={setPagination}
					pageCount={pageCount}
					total={total}
					showSelectedCount={canManage && selectedCount > 0}
				/>
			</div>

			{canManage ? (
				<DeleteConfirmDialog
					open={deletion.deleteConfirmOpen}
					onOpenChange={deletion.setDeleteConfirmOpen}
					title={t("settings.holidays.delete.title", "Delete Holiday")}
					description={t(
						"settings.holidays.delete.description",
						'Are you sure you want to delete "{name}"? This action cannot be undone.',
						{ name: deletion.holidayToDelete?.name || "" },
					)}
					isDeleting={deletion.deleteMutation.isPending}
					onConfirm={deletion.confirmDelete}
				/>
			) : null}

			{canManage ? (
				<HolidayBulkDeleteDialog
					open={deletion.bulkDeleteConfirmOpen}
					onOpenChange={deletion.setBulkDeleteConfirmOpen}
					count={selectedCount}
					isDeleting={deletion.bulkDeleteMutation.isPending}
					onConfirm={deletion.confirmBulkDelete}
				/>
			) : null}
		</>
	);
}
