"use client";

import { IconSearch, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ApprovalInboxType } from "@/lib/approvals/inbox/types";
import type { ApprovalInboxFilters } from "@/lib/query/use-approval-inbox";

interface ApprovalInboxToolbarProps {
	filters: ApprovalInboxFilters;
	onFiltersChange: (filters: ApprovalInboxFilters) => void;
	selectedCount: number;
	totalCount: number;
	allSelected: boolean;
	onSelectAll: (checked: boolean) => void;
	supportedTypes: ApprovalInboxType[];
}

const TYPE_LABELS: Record<ApprovalInboxType, string> = {
	absence_entry: "Absence Requests",
	time_entry: "Time Corrections",
	travel_expense_claim: "Travel Expenses",
};

const APPROVAL_TYPES: { value: ApprovalInboxType; label: string }[] = [
	{ value: "absence_entry", label: "Absence Requests" },
	{ value: "time_entry", label: "Time Corrections" },
	{ value: "travel_expense_claim", label: "Travel Expenses" },
];

export function ApprovalInboxToolbar({
	filters,
	onFiltersChange,
	selectedCount,
	totalCount,
	allSelected,
	onSelectAll,
	supportedTypes,
}: ApprovalInboxToolbarProps) {
	const { t } = useTranslate();
	const [searchInput, setSearchInput] = useState(filters.search ?? "");
	const visibleTypes = APPROVAL_TYPES.filter((type) => supportedTypes.includes(type.value));

	const activeFilterCount = (filters.types?.length ? 1 : 0) + (filters.search ? 1 : 0);

	const handleTypeToggle = (type: ApprovalInboxType) => {
		const currentTypes = filters.types || [];
		const newTypes = currentTypes.includes(type)
			? currentTypes.filter((t) => t !== type)
			: [...currentTypes, type];
		onFiltersChange({
			...filters,
			types: newTypes.length > 0 ? newTypes : undefined,
		});
	};

	useEffect(() => {
		setSearchInput(filters.search ?? "");
	}, [filters.search]);

	useEffect(() => {
		const nextSearch = searchInput || undefined;
		if (nextSearch === filters.search) return;

		const timeoutId = window.setTimeout(() => {
			onFiltersChange({
				...filters,
				search: nextSearch,
			});
		}, 300);

		return () => window.clearTimeout(timeoutId);
	}, [filters, onFiltersChange, searchInput]);

	const handleSearchChange = (value: string) => {
		setSearchInput(value);
	};

	const clearFilters = () => {
		setSearchInput("");
		onFiltersChange({ status: "pending" });
	};

	return (
		<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
				<div className="flex items-center gap-2">
					<Checkbox
						checked={allSelected}
						onCheckedChange={onSelectAll}
						aria-label={t("approvals:approvals.selectAll", "Select all")}
					/>
					<span className="text-sm text-muted-foreground">
						{selectedCount > 0
							? t("approvals:approvals.selectedCount", `${selectedCount} selected`, {
									selectedCount,
								})
							: t("approvals:approvals.totalCount", `${totalCount} pending`, {
									totalCount,
								})}
					</span>
				</div>

				<div className="relative w-full sm:w-72">
					<IconSearch
						className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						placeholder={t("approvals:approvals.searchPlaceholder", "Search by name or email…")}
						value={searchInput}
						onChange={(e) => handleSearchChange(e.target.value)}
						className="pl-9"
						aria-label={t("approvals:approvals.searchLabel", "Search approvals")}
					/>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm">
							{t("approvals:approvals.type", "Type")}
							{filters.types?.length ? (
								<Badge variant="secondary" className="ml-2">
									{filters.types.length}
								</Badge>
							) : null}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>
							{t("approvals:approvals.filterByType", "Filter by type")}
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{visibleTypes.map((type) => (
							<DropdownMenuCheckboxItem
								key={type.value}
								checked={filters.types?.includes(type.value) || false}
								onCheckedChange={() => handleTypeToggle(type.value)}
							>
								{t(`approvals:approvals.types.${type.value}`, TYPE_LABELS[type.value])}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>

				{activeFilterCount > 0 && (
					<Button variant="ghost" size="sm" onClick={clearFilters}>
						<IconX className="mr-1 size-4" aria-hidden="true" />
						{t("common.clear", "Clear")}
					</Button>
				)}
			</div>
		</div>
	);
}
