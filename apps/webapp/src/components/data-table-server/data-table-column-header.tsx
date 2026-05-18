"use client";

import { IconArrowDown, IconArrowUp, IconSelector } from "@tabler/icons-react";
import type { Column } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue> extends React.HTMLAttributes<HTMLDivElement> {
	column: Column<TData, TValue>;
	title: string;
}

export function DataTableColumnHeader<TData, TValue>({
	column,
	title,
	className,
}: DataTableColumnHeaderProps<TData, TValue>) {
	const { t } = useTranslate();

	if (!column.getCanSort()) {
		return <div className={cn(className)}>{title}</div>;
	}

	return (
		<div className={cn("flex items-center space-x-2", className)}>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="sm" className="-ml-3 h-8 data-[state=open]:bg-accent">
						<span>{title}</span>
						{column.getIsSorted() === "desc" ? (
							<IconArrowDown className="ml-2 size-4" />
						) : column.getIsSorted() === "asc" ? (
							<IconArrowUp className="ml-2 size-4" />
						) : (
							<IconSelector className="ml-2 size-4" />
						)}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuItem onClick={() => column.toggleSorting(false)}>
						<IconArrowUp className="mr-2 size-3.5 text-muted-foreground/70" />
						{t("table.sortAscending", "Ascending")}
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => column.toggleSorting(true)}>
						<IconArrowDown className="mr-2 size-3.5 text-muted-foreground/70" />
						{t("table.sortDescending", "Descending")}
					</DropdownMenuItem>
					{column.getIsSorted() && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => column.clearSorting()}>
								{t("table.clearSort", "Clear sort")}
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
