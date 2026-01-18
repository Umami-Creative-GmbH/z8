"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconChevronsLeft,
	IconChevronsRight,
} from "@tabler/icons-react";
import type { Table } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

interface DataTablePaginationProps<TData> {
	table: Table<TData>;
	/**
	 * Total number of rows (for server-side pagination)
	 */
	totalRows?: number;
	/**
	 * Page size options
	 * @default [10, 20, 30, 50]
	 */
	pageSizeOptions?: number[];
	/**
	 * Whether to show the selected row count
	 * @default false
	 */
	showSelectedCount?: boolean;
}

export function DataTablePagination<TData>({
	table,
	totalRows,
	pageSizeOptions = [10, 20, 30, 50],
	showSelectedCount = false,
}: DataTablePaginationProps<TData>) {
	const { t } = useTranslate();

	const pageCount = table.getPageCount();
	const currentPage = table.getState().pagination.pageIndex + 1;
	const pageSize = table.getState().pagination.pageSize;

	// Use totalRows if provided (server-side), otherwise use filtered row count
	const total = totalRows ?? table.getFilteredRowModel().rows.length;
	const selectedCount = table.getFilteredSelectedRowModel().rows.length;

	return (
		<div className="flex items-center justify-between px-2">
			<div className="flex-1 text-sm text-muted-foreground">
				{showSelectedCount && selectedCount > 0 ? (
					t("table.selectedOfTotal", "{selected} of {total} row(s) selected", {
						selected: selectedCount,
						total,
					})
				) : (
					t("table.totalRows", "{total} row(s)", { total })
				)}
			</div>

			<div className="flex items-center gap-6 lg:gap-8">
				<div className="flex items-center gap-2">
					<p className="text-sm font-medium">
						{t("table.rowsPerPage", "Rows per page")}
					</p>
					<Select
						value={`${pageSize}`}
						onValueChange={(value) => {
							table.setPageSize(Number(value));
						}}
					>
						<SelectTrigger className="h-8 w-[70px]">
							<SelectValue placeholder={pageSize} />
						</SelectTrigger>
						<SelectContent side="top">
							{pageSizeOptions.map((size) => (
								<SelectItem key={size} value={`${size}`}>
									{size}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex w-[100px] items-center justify-center text-sm font-medium">
					{t("table.pageOfPages", "Page {current} of {total}", {
						current: currentPage,
						total: pageCount || 1,
					})}
				</div>

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						className="hidden h-8 w-8 p-0 lg:flex"
						onClick={() => table.setPageIndex(0)}
						disabled={!table.getCanPreviousPage()}
					>
						<span className="sr-only">{t("table.goToFirstPage", "Go to first page")}</span>
						<IconChevronsLeft className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						className="h-8 w-8 p-0"
						onClick={() => table.previousPage()}
						disabled={!table.getCanPreviousPage()}
					>
						<span className="sr-only">{t("table.goToPreviousPage", "Go to previous page")}</span>
						<IconChevronLeft className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						className="h-8 w-8 p-0"
						onClick={() => table.nextPage()}
						disabled={!table.getCanNextPage()}
					>
						<span className="sr-only">{t("table.goToNextPage", "Go to next page")}</span>
						<IconChevronRight className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						className="hidden h-8 w-8 p-0 lg:flex"
						onClick={() => table.setPageIndex(pageCount - 1)}
						disabled={!table.getCanNextPage()}
					>
						<span className="sr-only">{t("table.goToLastPage", "Go to last page")}</span>
						<IconChevronsRight className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}
