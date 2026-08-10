"use client";

import {
	type ColumnDef,
	type ColumnFiltersState,
	type ColumnVisibilityState,
	flexRender,
	type OnChangeFn,
	type PaginationState,
	type RowData,
	type RowSelectionState,
	type SortingState,
	useTable,
} from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	type DataTableFeatures,
	dataTableFeatures,
} from "@/components/data-table-server/data-table-features";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableProps<TData extends RowData> {
	/**
	 * Column definitions
	 */
	columns: ColumnDef<DataTableFeatures, TData>[];
	/**
	 * Data to display
	 */
	data: TData[];
	/**
	 * Total page count (for server-side pagination)
	 */
	pageCount?: number;
	/**
	 * Pagination state (for server-side pagination)
	 */
	pagination?: PaginationState;
	/**
	 * Pagination change handler (for server-side pagination)
	 */
	onPaginationChange?: OnChangeFn<PaginationState>;
	/**
	 * Sorting state
	 */
	sorting?: SortingState;
	/**
	 * Sorting change handler
	 */
	onSortingChange?: OnChangeFn<SortingState>;
	/**
	 * Row selection state
	 */
	rowSelection?: RowSelectionState;
	/**
	 * Row selection change handler
	 */
	onRowSelectionChange?: OnChangeFn<RowSelectionState>;
	/**
	 * Enable manual/server-side pagination
	 * @default false
	 */
	manualPagination?: boolean;
	/**
	 * Enable manual/server-side sorting
	 * @default false
	 */
	manualSorting?: boolean;
	/**
	 * Enable manual/server-side filtering
	 * @default false
	 */
	manualFiltering?: boolean;
	/**
	 * Enable row selection
	 * @default false
	 */
	enableRowSelection?: boolean;
	/**
	 * Custom row ID accessor
	 */
	getRowId?: (row: TData) => string;
	/**
	 * Empty state message
	 */
	emptyMessage?: string;
	/**
	 * Whether data is currently loading (for opacity effect)
	 */
	isFetching?: boolean;
	/**
	 * Additional className for the table container
	 */
	className?: string;
	/**
	 * Click handler for row (passes the original data)
	 */
	onRowClick?: (row: TData) => void;
	/**
	 * Custom className for rows (can be a function based on row data)
	 */
	rowClassName?: string | ((row: TData) => string);
}

export function DataTable<TData extends RowData>({
	columns,
	data,
	pageCount,
	pagination,
	onPaginationChange,
	sorting: externalSorting,
	onSortingChange,
	rowSelection: externalRowSelection,
	onRowSelectionChange,
	manualPagination = false,
	manualSorting = false,
	manualFiltering = false,
	enableRowSelection = false,
	getRowId,
	emptyMessage,
	isFetching,
	className,
	onRowClick,
	rowClassName,
}: DataTableProps<TData>) {
	const { t } = useTranslate();

	// Internal state for uncontrolled mode
	const [internalSorting, setInternalSorting] = useState<SortingState>([]);
	const [internalPagination, setInternalPagination] = useState<PaginationState>(
		{
			pageIndex: 0,
			pageSize: 10,
		},
	);
	const [internalRowSelection, setInternalRowSelection] =
		useState<RowSelectionState>({});
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [columnVisibility, setColumnVisibility] =
		useState<ColumnVisibilityState>({});

	// Use external state if provided, otherwise use internal state
	const sorting = externalSorting ?? internalSorting;
	const currentPagination = pagination ?? internalPagination;
	const rowSelection = externalRowSelection ?? internalRowSelection;

	const table = useTable({
		features: dataTableFeatures,
		data,
		columns,
		pageCount: manualPagination ? pageCount : undefined,
		state: {
			sorting,
			columnVisibility,
			rowSelection,
			columnFilters,
			pagination: currentPagination,
		},
		getRowId,
		enableRowSelection,
		manualPagination,
		manualSorting,
		manualFiltering,
		onRowSelectionChange: onRowSelectionChange ?? setInternalRowSelection,
		onSortingChange: onSortingChange ?? setInternalSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
		onPaginationChange: onPaginationChange ?? setInternalPagination,
	});

	return (
		<div
			className={cn(
				"rounded-md border bg-card transition-opacity",
				isFetching && "opacity-60",
				className,
			)}
		>
			<Table>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<TableHead key={header.id} colSpan={header.colSpan}>
									{header.isPlaceholder
										? null
										: flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)}
								</TableHead>
							))}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{table.getRowModel().rows?.length ? (
						table.getRowModel().rows.map((row) => {
							const rowClassNameValue =
								typeof rowClassName === "function"
									? rowClassName(row.original)
									: rowClassName;

							return (
								<TableRow
									key={row.id}
									data-state={row.getIsSelected() && "selected"}
									className={rowClassNameValue}
									onClick={
										onRowClick ? () => onRowClick(row.original) : undefined
									}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							);
						})
					) : (
						<TableRow>
							<TableCell
								colSpan={columns.length}
								className="h-24 text-center text-muted-foreground"
							>
								{emptyMessage ?? t("table.noResults", "No results.")}
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	);
}
