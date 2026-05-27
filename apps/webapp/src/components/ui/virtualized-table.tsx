"use client";

/**
 * Virtualized Table Component
 *
 * High-performance table for large datasets (1,000+ rows).
 * Uses @tanstack/react-virtual for windowed rendering.
 *
 * Key features:
 * - Only renders visible rows (+ overscan buffer)
 * - Smooth scrolling with consistent row heights
 * - Integrates with existing shadcn/ui table styles
 * - Supports row selection and memoization
 */

import {
	elementScroll,
	observeElementOffset,
	observeElementRect,
	Virtualizer,
} from "@tanstack/react-virtual";
import * as React from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface VirtualizedTableColumn<T> {
	id: string;
	header: React.ReactNode;
	cell: (row: T, index: number) => React.ReactNode;
	width?: number | string;
	className?: string;
}

export interface VirtualizedTableProps<T> {
	data: T[];
	columns: VirtualizedTableColumn<T>[];
	rowKey: (row: T) => string;
	rowHeight?: number;
	overscan?: number;
	maxHeight?: number | string;
	onRowClick?: (row: T, index: number) => void;
	selectedRowKey?: string;
	className?: string;
	emptyMessage?: React.ReactNode;
}

/**
 * Memoized table row component for better performance
 */
const MemoizedTableRow = function MemoizedTableRow<T>({
	row,
	index,
	columns,
	rowKey,
	isSelected,
	onClick,
	style,
}: {
	row: T;
	index: number;
	columns: VirtualizedTableColumn<T>[];
	rowKey: string;
	isSelected: boolean;
	onClick?: () => void;
	style: React.CSSProperties;
}) {
	return (
		<TableRow
			data-index={index}
			data-key={rowKey}
			className={cn(
				"absolute left-0 right-0",
				isSelected && "bg-muted",
				onClick && "cursor-pointer hover:bg-muted/50",
			)}
			style={{
				...style,
				// content-visibility optimization for better rendering performance
				contentVisibility: "auto",
				containIntrinsicSize: `auto ${style.height}`,
			}}
			onClick={onClick}
		>
			{columns.map((column) => (
				<TableCell
					key={column.id}
					className={cn("py-2", column.className)}
					style={{ width: column.width }}
				>
					{column.cell(row, index)}
				</TableCell>
			))}
		</TableRow>
	);
} as <T>(props: {
	row: T;
	index: number;
	columns: VirtualizedTableColumn<T>[];
	rowKey: string;
	isSelected: boolean;
	onClick?: () => void;
	style: React.CSSProperties;
}) => React.ReactElement;

/**
 * Virtualized table component for large datasets
 */
export function VirtualizedTable<T>({
	data,
	columns,
	rowKey,
	rowHeight = 48,
	overscan = 5,
	maxHeight = 600,
	onRowClick,
	selectedRowKey,
	className,
	emptyMessage = "No data available",
}: VirtualizedTableProps<T>) {
	const [scrollElement, setScrollElement] = React.useState<HTMLDivElement | null>(null);
	// Store onRowClick in ref to avoid recreating callbacks (rerender-functional-setstate)
	const onRowClickRef = React.useRef(onRowClick);
	React.useEffect(() => {
		onRowClickRef.current = onRowClick;
	}, [onRowClick]);

	const [, forceUpdate] = React.useReducer((version: number) => version + 1, 0);
	const [virtualizer] = React.useState(
		() =>
			new Virtualizer<HTMLDivElement, Element>({
				count: data.length,
				getScrollElement: () => null,
				estimateSize: () => rowHeight,
				overscan,
				observeElementRect,
				observeElementOffset,
				scrollToFn: elementScroll,
			}),
	);

	virtualizer.setOptions({
		count: data.length,
		getScrollElement: () => scrollElement,
		estimateSize: () => rowHeight,
		overscan,
		observeElementRect,
		observeElementOffset,
		scrollToFn: elementScroll,
		onChange: () => React.startTransition(forceUpdate),
	});

	React.useLayoutEffect(() => {
		return virtualizer._didMount();
	}, [virtualizer]);

	React.useLayoutEffect(() => {
		return virtualizer._willUpdate();
	});

	const virtualRows = virtualizer.getVirtualItems();

	// Stable callback creator using ref
	const handleRowClick = (row: T, index: number) => {
		onRowClickRef.current?.(row, index);
	};

	if (data.length === 0) {
		return (
			<div className={cn("rounded-md border", className)}>
				<Table>
					<TableHeader>
						<TableRow>
							{columns.map((column) => (
								<TableHead key={column.id} style={{ width: column.width }}>
									{column.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
				</Table>
				<div className="flex items-center justify-center p-8 text-muted-foreground">
					{emptyMessage}
				</div>
			</div>
		);
	}

	return (
		<div className={cn("rounded-md border", className)}>
			<Table>
				<TableHeader>
					<TableRow>
						{columns.map((column) => (
							<TableHead key={column.id} style={{ width: column.width }}>
								{column.header}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
			</Table>

			<div ref={setScrollElement} className="overflow-auto" style={{ maxHeight }}>
				<div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
					<Table>
						<TableBody>
							{virtualRows.map((virtualRow) => {
								const row = data[virtualRow.index];
								const key = rowKey(row);

								return (
									<MemoizedTableRow
										key={key}
										row={row}
										index={virtualRow.index}
										columns={columns}
										rowKey={key}
										isSelected={selectedRowKey === key}
										onClick={onRowClick ? () => handleRowClick(row, virtualRow.index) : undefined}
										style={{
											height: `${virtualRow.size}px`,
											transform: `translateY(${virtualRow.start}px)`,
										}}
									/>
								);
							})}
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	);
}

/**
 * Hook for row memoization with custom comparison
 * Use this when rendering complex row content
 */
export function useRowMemoization<T>(
	data: T[],
	getRowId: (row: T) => string,
	getRowVersion: (row: T) => string | number,
) {
	const [rowVersions, setRowVersions] = React.useState<Map<string, string | number>>(
		() => new Map(),
	);
	const memoizedRows = (() => {
		const newVersions = new Map<string, string | number>();

		data.forEach((row) => {
			const id = getRowId(row);
			const version = getRowVersion(row);
			newVersions.set(id, version);
		});

		// Check which rows actually changed
		const changedRows = new Set<string>();
		newVersions.forEach((version, id) => {
			if (rowVersions.get(id) !== version) {
				changedRows.add(id);
			}
		});

		return { data, changedRows, newVersions };
	})();

	React.useEffect(() => {
		if (areRowVersionsEqual(rowVersions, memoizedRows.newVersions)) {
			return;
		}

		React.startTransition(() => setRowVersions(memoizedRows.newVersions));
	}, [memoizedRows.newVersions, rowVersions]);

	return { data: memoizedRows.data, changedRows: memoizedRows.changedRows };
}

function areRowVersionsEqual(
	previous: Map<string, string | number>,
	next: Map<string, string | number>,
) {
	if (previous.size !== next.size) {
		return false;
	}

	for (const [id, version] of next) {
		if (previous.get(id) !== version) {
			return false;
		}
	}

	return true;
}
