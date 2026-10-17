"use client";

import * as React from "react";
import "./responsive-table.css";

import { cn } from "@/lib/utils";

type TableProps = React.ComponentProps<"table"> & {
	/** Present each row as labeled details on phones; keep the desktop table. */
	mobileLayout?: "scroll" | "stacked";
};

const TableLayoutContext =
	React.createContext<TableProps["mobileLayout"]>("scroll");

function Table({
	className,
	children,
	mobileLayout = "scroll",
	ref,
	...props
}: TableProps) {
	const tableRef = React.useRef<HTMLTableElement>(null);
	React.useImperativeHandle(ref, () => {
		const table = tableRef.current;
		if (!table) throw new Error("Table ref must be attached before use");
		return table;
	}, []);

	React.useLayoutEffect(() => {
		const table = tableRef.current;
		if (mobileLayout !== "stacked" || !table || children == null) return;

		// Read the rendered, localized headers, including custom sortable headers.
		// Keep the original cells and controls mounted instead of duplicating row actions.
		const header = table.tHead?.rows[table.tHead.rows.length - 1];
		const labels = header
			? Array.from(header.cells, (cell) =>
					(cell.innerText ?? cell.textContent ?? "").trim(),
				)
			: [];
		for (const body of Array.from(table.tBodies)) {
			for (const row of Array.from(body.rows)) {
				let column = 0;
				for (const cell of Array.from(row.cells)) {
					cell.dataset.label = cell.colSpan === 1 ? (labels[column] ?? "") : "";
					column += cell.colSpan;
				}
			}
		}
	}, [children, mobileLayout]);
	return (
		<TableLayoutContext value={mobileLayout}>
			<div
				className="relative w-full min-w-0 max-w-full overflow-x-auto"
				data-slot="table-container"
			>
				{/* Preserve table semantics when phone CSS changes its display. */}
				<table
					ref={tableRef}
					role={mobileLayout === "stacked" ? "table" : undefined}
					data-mobile-layout={mobileLayout}
					className={cn("w-full caption-bottom text-sm", className)}
					data-slot="table"
					{...props}
				>
					{children}
				</table>
			</div>
		</TableLayoutContext>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return (
		<thead
			className={cn("[&_tr]:border-b", className)}
			data-slot="table-header"
			{...props}
		/>
	);
}

function TableHeaderRow({
	columns,
}: {
	columns: readonly {
		id: string;
		label: React.ReactNode;
		className?: string;
	}[];
}) {
	return (
		<TableHeader>
			<TableRow>
				{columns.map((column) => (
					<TableHead key={column.id} className={column.className}>
						{column.label}
					</TableHead>
				))}
			</TableRow>
		</TableHeader>
	);
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody
			className={cn("[&_tr:last-child]:border-0", className)}
			data-slot="table-body"
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			className={cn(
				"border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
				className,
			)}
			data-slot="table-footer"
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			className={cn(
				"border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
				className,
			)}
			data-slot="table-row"
			{...props}
		/>
	);
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
	return (
		<th
			className={cn(
				"h-10 whitespace-nowrap px-2 text-left align-middle font-medium text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			data-slot="table-head"
			{...props}
		/>
	);
}

function TableCell({
	className,
	children,
	...props
}: React.ComponentProps<"td">) {
	const mobileLayout = React.use(TableLayoutContext);
	return (
		<td
			className={cn(
				"whitespace-nowrap p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
				className,
			)}
			data-slot="table-cell"
			{...props}
		>
			{mobileLayout === "stacked" ? (
				<div data-slot="table-cell-value">{children}</div>
			) : (
				children
			)}
		</td>
	);
}

function TableCaption({
	className,
	...props
}: React.ComponentProps<"caption">) {
	return (
		<caption
			className={cn("mt-4 text-muted-foreground text-sm", className)}
			data-slot="table-caption"
			{...props}
		/>
	);
}

export {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableHeaderRow,
	TableRow,
};
