"use client";

import { IconLoader2, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
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
	isLoading,
	hasMore,
	onLoadMore,
	maxSelections,
}: EmployeeSelectListProps) {
	const { t } = useTranslate();

	const handleItemClick = (employee: SelectableEmployee) => {
		const isSelected = selectedIds.includes(employee.id);

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
				<IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	// Show empty state
	if (!isLoading && employees.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
				<IconUsers className="h-10 w-10 mb-2 opacity-40" />
				<p className="text-sm">{t("employeeSelect.noEmployeesFound", "No employees found")}</p>
				<p className="text-xs mt-0.5 opacity-70">
					{t("employeeSelect.tryDifferentSearch", "Try adjusting your search or filters")}
				</p>
			</div>
		);
	}

	const isAtMaxSelections =
		mode === "multiple" && maxSelections !== undefined && selectedIds.length >= maxSelections;

	return (
		<div role="listbox" aria-multiselectable={mode === "multiple"}>
			{employees.map((employee) => {
				const isSelected = selectedIds.includes(employee.id);
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
			})}

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
						{isLoading ? <IconLoader2 className="h-4 w-4 animate-spin mr-2" /> : null}
						{t("common.loadMore", "Load more")}
					</Button>
				</div>
			)}

			{/* Loading indicator for pagination */}
			{isLoading && employees.length > 0 && (
				<div className="flex items-center justify-center py-2">
					<IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
				</div>
			)}
		</div>
	);
}
