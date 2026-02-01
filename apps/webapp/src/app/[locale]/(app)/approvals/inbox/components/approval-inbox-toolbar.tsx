"use client";

import { IconFilter, IconSearch, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { ApprovalInboxFilters } from "@/lib/query/use-approval-inbox";
import type { ApprovalPriority, ApprovalType } from "@/lib/approvals/domain/types";

interface ApprovalInboxToolbarProps {
	filters: ApprovalInboxFilters;
	onFiltersChange: (filters: ApprovalInboxFilters) => void;
	selectedCount: number;
	totalCount: number;
	allSelected: boolean;
	onSelectAll: (checked: boolean) => void;
}

const APPROVAL_TYPES: { value: ApprovalType; label: string }[] = [
	{ value: "absence_entry", label: "Absence Requests" },
	{ value: "time_entry", label: "Time Corrections" },
	{ value: "shift_request", label: "Shift Requests" },
];

const PRIORITIES: { value: ApprovalPriority; label: string; color: string }[] = [
	{ value: "urgent", label: "Urgent", color: "destructive" },
	{ value: "high", label: "High", color: "warning" },
	{ value: "normal", label: "Normal", color: "default" },
	{ value: "low", label: "Low", color: "secondary" },
];

const AGE_OPTIONS: { value: number; label: string }[] = [
	{ value: 1, label: "Older than 1 day" },
	{ value: 3, label: "Older than 3 days" },
	{ value: 7, label: "Older than 1 week" },
	{ value: 14, label: "Older than 2 weeks" },
];

export function ApprovalInboxToolbar({
	filters,
	onFiltersChange,
	selectedCount,
	totalCount,
	allSelected,
	onSelectAll,
}: ApprovalInboxToolbarProps) {
	const { t } = useTranslate();

	const activeFilterCount =
		(filters.types?.length ? 1 : 0) +
		(filters.priority ? 1 : 0) +
		(filters.minAgeDays ? 1 : 0) +
		(filters.search ? 1 : 0);

	const handleTypeToggle = (type: ApprovalType) => {
		const currentTypes = filters.types || [];
		const newTypes = currentTypes.includes(type)
			? currentTypes.filter((t) => t !== type)
			: [...currentTypes, type];
		onFiltersChange({
			...filters,
			types: newTypes.length > 0 ? newTypes : undefined,
		});
	};

	const handlePriorityToggle = (priority: ApprovalPriority) => {
		onFiltersChange({
			...filters,
			priority: filters.priority === priority ? undefined : priority,
		});
	};

	const handleAgeToggle = (age: number) => {
		onFiltersChange({
			...filters,
			minAgeDays: filters.minAgeDays === age ? undefined : age,
		});
	};

	const handleSearchChange = (value: string) => {
		onFiltersChange({
			...filters,
			search: value || undefined,
		});
	};

	const clearFilters = () => {
		onFiltersChange({ status: "pending" });
	};

	return (
		<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			{/* Left side: Select all + Search */}
			<div className="flex items-center gap-4">
				<div className="flex items-center gap-2">
					<Checkbox
						checked={allSelected}
						onCheckedChange={onSelectAll}
						aria-label={t("approvals.selectAll", "Select all")}
					/>
					{selectedCount > 0 && (
						<span className="text-sm text-muted-foreground">
							{selectedCount} {t("common.selected", "selected")}
						</span>
					)}
				</div>

				<div className="relative w-64">
					<IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
					<Input
						placeholder={t("approvals.searchPlaceholder", "Search by name or email…")}
						value={filters.search || ""}
						onChange={(e) => handleSearchChange(e.target.value)}
						className="pl-9"
						aria-label={t("approvals.searchLabel", "Search approvals")}
					/>
				</div>
			</div>

			{/* Right side: Filters */}
			<div className="flex items-center gap-2">
				{/* Type filter */}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm">
							{t("approvals.type", "Type")}
							{filters.types?.length ? (
								<Badge variant="secondary" className="ml-2">
									{filters.types.length}
								</Badge>
							) : null}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>{t("approvals.filterByType", "Filter by type")}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{APPROVAL_TYPES.map((type) => (
							<DropdownMenuCheckboxItem
								key={type.value}
								checked={filters.types?.includes(type.value) || false}
								onCheckedChange={() => handleTypeToggle(type.value)}
							>
								{t(`approvals.types.${type.value}`, type.label)}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>

				{/* Priority filter */}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm">
							{t("approvals.priority", "Priority")}
							{filters.priority && (
								<Badge variant="secondary" className="ml-2">
									1
								</Badge>
							)}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>{t("approvals.filterByPriority", "Filter by priority")}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{PRIORITIES.map((priority) => (
							<DropdownMenuCheckboxItem
								key={priority.value}
								checked={filters.priority === priority.value}
								onCheckedChange={() => handlePriorityToggle(priority.value)}
							>
								{t(`approvals.priorities.${priority.value}`, priority.label)}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>

				{/* Age filter */}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm">
							{t("approvals.age", "Age")}
							{filters.minAgeDays && (
								<Badge variant="secondary" className="ml-2">
									1
								</Badge>
							)}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuLabel>{t("approvals.filterByAge", "Filter by age")}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{AGE_OPTIONS.map((age) => (
							<DropdownMenuCheckboxItem
								key={age.value}
								checked={filters.minAgeDays === age.value}
								onCheckedChange={() => handleAgeToggle(age.value)}
							>
								{t(`approvals.ages.${age.value}`, age.label)}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>

				{/* Clear filters */}
				{activeFilterCount > 0 && (
					<Button variant="ghost" size="sm" onClick={clearFilters}>
						<IconX className="mr-1 h-4 w-4" aria-hidden="true" />
						{t("common.clear", "Clear")}
					</Button>
				)}
			</div>
		</div>
	);
}
