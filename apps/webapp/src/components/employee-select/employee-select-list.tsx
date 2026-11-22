"use client";

import { IconCheck, IconLoader2, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmployeeSelectItem } from "./employee-select-item";
import type { EmployeeSelectListProps, SelectableEmployee } from "./types";

/**
 * Scrollable list of employees with pagination support
 */
export function EmployeeSelectList({
	employees,
	selectedIds,
	mode,
	onSelect,
	onDeselect,
	allowClear = false,
	clearLabel,
	onClear,
	pinnedIds,
	emptyMessage,
	isLoading,
	hasMore,
	onLoadMore,
	maxSelections,
}: EmployeeSelectListProps) {
	const { t } = useTranslate();
	const selectedIdSet = new Set(selectedIds);
	const showClearOption = mode === "single" && allowClear && Boolean(onClear);

	const handleItemClick = (employee: SelectableEmployee) => {
		const isSelected = selectedIdSet.has(employee.id);

		if (isSelected) {
			onDeselect(employee.id);
		} else {
			// Check max selections for multi-select
			if (mode === "multiple" && maxSelections && selectedIds.length >= maxSelections) {
				return; // Don't allow more selections
			}
			onSelect(employee);
		}
	};

	// Show loading state
	if (isLoading && employees.length === 0) {
		return (
			<div className="flex items-center justify-center h-48">
				<IconLoader2 className="size-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	// Show empty state
	if (!isLoading && employees.length === 0 && !showClearOption) {
		return (
			<div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
				<IconUsers className="size-10 mb-2 opacity-40" />
				<p className="text-sm">
					{emptyMessage ?? t("common:employeeSelect.noEmployeesFound", "No employees found")}
				</p>
				<p className="text-xs mt-0.5 opacity-70">
					{t("common:employeeSelect.tryDifferentSearch", "Try adjusting your search or filters")}
				</p>
			</div>
		);
	}

	const isAtMaxSelections =
		mode === "multiple" && maxSelections !== undefined && selectedIds.length >= maxSelections;
	const pinnedIdSet = pinnedIds && pinnedIds.length > 0 ? new Set(pinnedIds) : null;
	const pinnedEmployees = pinnedIdSet
		? employees.filter((employee) => pinnedIdSet.has(employee.id))
		: [];
	const regularEmployees = pinnedIdSet
		? employees.filter((employee) => !pinnedIdSet.has(employee.id))
		: employees;
	const effectiveClearLabel = clearLabel ?? t("common.clear", "Clear selection");
	const isClearedSelected = selectedIds.length === 0;

	const renderEmployee = (employee: SelectableEmployee) => {
		const isSelected = selectedIdSet.has(employee.id);
		const isDisabled = !isSelected && isAtMaxSelections;

		return (
			<EmployeeSelectItem
				key={employee.id}
				employee={employee}
				isSelected={isSelected}
				mode={mode}
				onClick={() => handleItemClick(employee)}
				disabled={isDisabled}
			/>
		);
	};

	return (
		<div role="listbox">
			{showClearOption && onClear && (
				<div
					role="option"
					aria-selected={isClearedSelected}
					tabIndex={0}
					onClick={onClear}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onClear();
						}
					}}
					className={cn(
						"flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer select-none",
						"transition-colors duration-100",
						"hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
						isClearedSelected && "bg-primary/10 text-primary",
					)}
				>
					<div className="size-4 flex items-center justify-center shrink-0">
						{isClearedSelected && <IconCheck className="size-4 text-primary" />}
					</div>
					<span className="font-medium truncate text-sm">{effectiveClearLabel}</span>
				</div>
			)}

			{pinnedEmployees.length > 0 && (
				<>
					{pinnedEmployees.map(renderEmployee)}
					{regularEmployees.length > 0 && (
						<div aria-hidden="true" className="my-1.5 h-px bg-border/60" />
					)}
				</>
			)}

			{regularEmployees.map(renderEmployee)}

			{!isLoading && employees.length === 0 && showClearOption && (
				<div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
					<p className="text-sm">
						{emptyMessage ?? t("common:employeeSelect.noEmployeesFound", "No employees found")}
					</p>
				</div>
			)}

			{/* Load more button */}
			{hasMore && (
				<div className="pt-2 pb-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="w-full h-8 text-xs"
						onClick={onLoadMore}
						disabled={isLoading}
					>
						{isLoading ? <IconLoader2 className="size-4 animate-spin mr-2" /> : null}
						{t("common.loadMore", "Load more")}
					</Button>
				</div>
			)}

			{/* Loading indicator for pagination */}
			{isLoading && employees.length > 0 && (
				<div className="flex items-center justify-center py-2">
					<IconLoader2 className="size-4 animate-spin text-muted-foreground" />
				</div>
			)}
		</div>
	);
}
