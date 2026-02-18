"use client";

import { IconSearch, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { FilterConfig } from "@/lib/data-table/types";

interface DataTableToolbarProps {
	/**
	 * Search input value
	 */
	search?: string;
	/**
	 * Callback when search value changes (debounced by parent)
	 */
	onSearchChange?: (value: string) => void;
	/**
	 * Placeholder for search input
	 */
	searchPlaceholder?: string;
	/**
	 * Filter configurations
	 */
	filters?: FilterConfig[];
	/**
	 * Current filter values
	 */
	filterValues?: Record<string, string>;
	/**
	 * Callback when a filter changes
	 */
	onFilterChange?: (key: string, value: string) => void;
	/**
	 * Actions to render on the right side (e.g., Add button)
	 */
	actions?: React.ReactNode;
	/**
	 * Bulk actions to render when items are selected
	 */
	bulkActions?: React.ReactNode;
	/**
	 * Debounce delay for search input (ms)
	 * @default 300
	 */
	searchDebounceMs?: number;
	/**
	 * Whether search is currently loading
	 */
	isSearching?: boolean;
}

export function DataTableToolbar({
	search,
	onSearchChange,
	searchPlaceholder,
	filters,
	filterValues,
	onFilterChange,
	actions,
	bulkActions,
	isSearching,
}: DataTableToolbarProps) {
	const { t } = useTranslate();
	const currentSearch = search ?? "";

	const hasActiveFilters =
		filterValues && Object.values(filterValues).some((v) => v && v !== "all");

	const clearAllFilters = () => {
		if (onSearchChange) {
			onSearchChange("");
		}
		if (onFilterChange && filters) {
			for (const filter of filters) {
				onFilterChange(filter.key, filter.defaultValue ?? "all");
			}
		}
	};

	return (
		<div className="flex items-center justify-between gap-2">
			<div className="flex flex-1 items-center gap-2">
				{onSearchChange && (
					<div className="relative w-full max-w-sm">
						<IconSearch className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder={searchPlaceholder ?? t("table.searchPlaceholder", "Search...")}
							value={currentSearch}
							onChange={(e) => onSearchChange(e.target.value)}
							className="h-9 w-full pl-8 pr-8"
						/>
						{currentSearch && (
							<Button
								variant="ghost"
								size="icon"
								className="absolute right-0 top-0 h-9 w-9 hover:bg-transparent"
								onClick={() => {
									onSearchChange("");
								}}
							>
								<IconX className="h-4 w-4" />
								<span className="sr-only">{t("common.clearSearch", "Clear search")}</span>
							</Button>
						)}
					</div>
				)}

				{filters?.map((filter) => (
					<Select
						key={filter.key}
						value={filterValues?.[filter.key] ?? filter.defaultValue ?? "all"}
						onValueChange={(value) => onFilterChange?.(filter.key, value)}
					>
						<SelectTrigger className="h-9 w-[140px]">
							<SelectValue placeholder={filter.label} />
						</SelectTrigger>
						<SelectContent>
							{filter.options.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									<div className="flex items-center gap-2">
										{option.icon && <option.icon className="h-4 w-4 text-muted-foreground" />}
										{option.label}
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				))}

				{(hasActiveFilters || currentSearch) && (
					<Button variant="ghost" onClick={clearAllFilters} className="h-9 px-2 lg:px-3">
						{t("table.clearFilters", "Clear filters")}
						<IconX className="ml-2 h-4 w-4" />
					</Button>
				)}
			</div>

			<div className="flex items-center gap-2">
				{bulkActions}
				{actions}
			</div>
		</div>
	);
}
