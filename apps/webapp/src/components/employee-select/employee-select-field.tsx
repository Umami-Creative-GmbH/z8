"use client";

import { useCallback, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { EmployeeSelectModal } from "./employee-select-modal";
import { EmployeeChips, EmployeeSelectTrigger } from "./employee-select-trigger";
import type { EmployeeSelectFieldProps, SelectableEmployee } from "./types";
import { useSelectedEmployees } from "./use-employee-select";

/**
 * Unified employee selection field component
 *
 * Supports both single and multi-select modes with:
 * - Modal-based selection with search and filters
 * - Server-side pagination for large employee lists
 * - Consistent display with avatars
 * - TanStack Form compatible (via value/onChange pattern)
 *
 * @example Single select
 * ```tsx
 * <form.Field name="employeeId">
 *   {(field) => (
 *     <EmployeeSelectField
 *       mode="single"
 *       value={field.state.value}
 *       onChange={field.handleChange}
 *       label="Assign Employee"
 *     />
 *   )}
 * </form.Field>
 * ```
 *
 * @example Multi-select
 * ```tsx
 * <form.Field name="employeeIds">
 *   {(field) => (
 *     <EmployeeSelectField
 *       mode="multiple"
 *       value={field.state.value}
 *       onChange={field.handleChange}
 *       label="Select Employees"
 *       maxSelections={10}
 *     />
 *   )}
 * </form.Field>
 * ```
 */
export function EmployeeSelectField(props: EmployeeSelectFieldProps) {
	const {
		excludeIds,
		filters,
		showFilters = true,
		label,
		placeholder,
		disabled = false,
		error,
		className,
		employees: preFilteredEmployees,
	} = props;

	const [modalOpen, setModalOpen] = useState(false);

	// Track selected employees locally for immediate UI updates
	const [localSelectedEmployees, setLocalSelectedEmployees] = useState<
		Map<string, SelectableEmployee>
	>(new Map());

	// Determine selected IDs based on mode
	const selectedIds = useMemo(() => {
		if (props.mode === "single") {
			return props.value ? [props.value] : [];
		}
		return props.value || [];
	}, [props.mode, props.value]);

	// Fetch selected employees for display (skip if pre-filtered list provided)
	const { employees: fetchedEmployees } = useSelectedEmployees(
		preFilteredEmployees ? [] : selectedIds,
	);

	// Merge fetched employees with locally tracked ones
	const selectedEmployees = useMemo(() => {
		const employeeMap = new Map<string, SelectableEmployee>();

		// If pre-filtered list provided, use it as the source
		if (preFilteredEmployees) {
			for (const emp of preFilteredEmployees) {
				if (selectedIds.includes(emp.id)) {
					employeeMap.set(emp.id, emp);
				}
			}
		} else {
			// Add fetched employees
			for (const emp of fetchedEmployees) {
				employeeMap.set(emp.id, emp);
			}
		}

		// Add locally tracked employees (takes precedence)
		for (const [id, emp] of localSelectedEmployees) {
			if (selectedIds.includes(id)) {
				employeeMap.set(id, emp);
			}
		}

		// Return in order of selectedIds
		return selectedIds.map((id) => employeeMap.get(id)).filter(Boolean) as SelectableEmployee[];
	}, [fetchedEmployees, localSelectedEmployees, selectedIds, preFilteredEmployees]);

	// Handle selection
	const handleSelect = useCallback(
		(employee: SelectableEmployee) => {
			// Track locally for immediate UI
			setLocalSelectedEmployees((prev) => new Map(prev).set(employee.id, employee));

			if (props.mode === "single") {
				props.onChange(employee.id);
			} else {
				const currentIds = props.value || [];
				if (!currentIds.includes(employee.id)) {
					props.onChange([...currentIds, employee.id]);
				}
			}
		},
		[props],
	);

	// Handle deselection
	const handleDeselect = useCallback(
		(employeeId: string) => {
			if (props.mode === "single") {
				props.onChange(null);
			} else {
				const currentIds = props.value || [];
				props.onChange(currentIds.filter((id) => id !== employeeId));
			}
		},
		[props],
	);

	// Handle confirm (for multi-select)
	const handleConfirm = useCallback(() => {
		// Selection changes are already applied via handleSelect/handleDeselect
		setModalOpen(false);
	}, []);

	// Get maxSelections for multi-select
	const maxSelections = props.mode === "multiple" ? props.maxSelections : undefined;

	return (
		<div className={cn("space-y-2", className)}>
			{label && <Label>{label}</Label>}

			<EmployeeSelectTrigger
				mode={props.mode}
				selectedEmployees={selectedEmployees}
				placeholder={placeholder}
				disabled={disabled}
				error={error}
				onClick={() => setModalOpen(true)}
			/>

			{/* Show chips for multi-select below the trigger */}
			{props.mode === "multiple" && selectedEmployees.length > 0 && (
				<EmployeeChips
					employees={selectedEmployees}
					onRemove={handleDeselect}
					disabled={disabled}
				/>
			)}

			{/* Error message */}
			{error && <p className="text-sm text-destructive">{error}</p>}

			{/* Selection modal */}
			<EmployeeSelectModal
				open={modalOpen}
				onOpenChange={setModalOpen}
				mode={props.mode}
				selectedIds={selectedIds}
				onSelect={handleSelect}
				onDeselect={handleDeselect}
				onConfirm={handleConfirm}
				excludeIds={excludeIds}
				filters={filters}
				showFilters={showFilters}
				maxSelections={maxSelections}
				employees={preFilteredEmployees}
			/>
		</div>
	);
}

/**
 * Simplified single-select component for common use cases
 */
export interface EmployeeSingleSelectProps {
	value: string | null;
	onChange: (value: string | null) => void;
	excludeIds?: string[];
	filters?: EmployeeSelectFieldProps["filters"];
	showFilters?: boolean;
	label?: string;
	placeholder?: string;
	disabled?: boolean;
	error?: string;
	className?: string;
	/** Pre-filtered employee list (uses client-side search when provided) */
	employees?: SelectableEmployee[];
}

export function EmployeeSingleSelect(props: EmployeeSingleSelectProps) {
	return <EmployeeSelectField mode="single" {...props} />;
}

/**
 * Simplified multi-select component for common use cases
 */
export interface EmployeeMultiSelectProps {
	value: string[];
	onChange: (value: string[]) => void;
	excludeIds?: string[];
	filters?: EmployeeSelectFieldProps["filters"];
	showFilters?: boolean;
	label?: string;
	placeholder?: string;
	disabled?: boolean;
	error?: string;
	className?: string;
	maxSelections?: number;
	/** Pre-filtered employee list (uses client-side search when provided) */
	employees?: SelectableEmployee[];
}

export function EmployeeMultiSelect(props: EmployeeMultiSelectProps) {
	return <EmployeeSelectField mode="multiple" {...props} />;
}
