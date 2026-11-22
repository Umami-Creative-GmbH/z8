"use client";

import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { EmployeeSelectModal } from "./employee-select-modal";
import { EmployeeChips, EmployeeSelectTrigger } from "./employee-select-trigger";
import type {
	EmployeeSelectCommonProps,
	EmployeeSelectFieldProps,
	MultiSelectProps,
	SelectableEmployee,
	SingleSelectProps,
} from "./types";
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
	if (props.employees !== undefined) {
		return <EmployeeSelectFieldInner props={props} fetchedEmployees={EMPTY_EMPLOYEES} />;
	}
	return <ServerEmployeeSelectField props={props} />;
}

const EMPTY_EMPLOYEES: SelectableEmployee[] = [];

function ServerEmployeeSelectField({ props }: { props: EmployeeSelectFieldProps }) {
	const selectedIds = props.mode === "single" ? (props.value ? [props.value] : []) : props.value || [];
	const { employees: fetchedEmployees } = useSelectedEmployees(selectedIds);
	return <EmployeeSelectFieldInner props={props} fetchedEmployees={fetchedEmployees} />;
}

function EmployeeSelectFieldInner({
	props,
	fetchedEmployees,
}: {
	props: EmployeeSelectFieldProps;
	fetchedEmployees: SelectableEmployee[];
}) {
	const {
		id,
		excludeIds,
		filters,
		includeFormerEmployees,
		showFilters = true,
		label,
		placeholder,
		searchPlaceholder,
		emptyMessage,
		modalTitle,
		modalDescription,
		onSearchChange,
		isLoading,
		disabled = false,
		error,
		className,
		triggerClassName,
		onBlur,
		"aria-label": ariaLabel,
		"aria-labelledby": ariaLabelledBy,
		"aria-describedby": ariaDescribedBy,
		"aria-invalid": ariaInvalid,
		"aria-required": ariaRequired,
		employees: preFilteredEmployees,
		pinnedIds,
	} = props;

	const [modalOpen, setModalOpen] = useState(false);
	const generatedTriggerId = useId();
	const triggerId = id ?? generatedTriggerId;
	const employeeListboxId = useId();

	const handleModalOpenChange = (nextOpen: boolean) => {
		setModalOpen(nextOpen);
		if (!nextOpen) {
			onBlur?.();
		}
	};

	// Track selected employees locally for immediate UI updates
	const [localSelectedEmployees, setLocalSelectedEmployees] = useState<
		Map<string, SelectableEmployee>
	>(new Map());

	// Determine selected IDs based on mode
	const selectedIds = (() => {
		if (props.mode === "single") {
			return props.value ? [props.value] : [];
		}
		return props.value || [];
	})();
	const selectedIdSet = new Set(selectedIds);

	// Merge fetched employees with locally tracked ones
	const selectedEmployees = (() => {
		const employeeMap = new Map<string, SelectableEmployee>();

		// If pre-filtered list provided, use it as the source
		if (preFilteredEmployees) {
			for (const emp of preFilteredEmployees) {
				if (selectedIdSet.has(emp.id)) {
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
			if (selectedIdSet.has(id)) {
				employeeMap.set(id, emp);
			}
		}

		// Return in order of selectedIds
		return selectedIds.flatMap((id) => {
			const employee = employeeMap.get(id);
			return employee ? [employee] : [];
		});
	})();

	// Handle selection
	const handleSelect = (employee: SelectableEmployee) => {
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
	};

	// Handle deselection
	const handleDeselect = (employeeId: string) => {
		if (props.mode === "single") {
			props.onChange(null);
		} else {
			const currentIds = props.value || [];
			props.onChange(currentIds.filter((id) => id !== employeeId));
		}
	};

	// Handle confirm (for multi-select)
	const handleConfirm = (confirmedIds?: string[], confirmedEmployees?: SelectableEmployee[]) => {
		if (props.mode === "multiple" && confirmedIds) {
			props.onChange(confirmedIds);
			if (confirmedEmployees) {
				setLocalSelectedEmployees((prev) => {
					const next = new Map(prev);
					for (const employee of confirmedEmployees) {
						next.set(employee.id, employee);
					}
					return next;
				});
			}
		}
		setModalOpen(false);
	};

	// Get mode-specific options
	const maxSelections = props.mode === "multiple" ? props.maxSelections : undefined;
	const showChips = props.mode === "multiple" ? (props.showChips ?? true) : false;
	const allowClear = props.mode === "single" ? props.allowClear : undefined;
	const clearLabel = props.mode === "single" ? props.clearLabel : undefined;

	return (
		<div className={cn("space-y-2", className)}>
			{label && <Label htmlFor={triggerId}>{label}</Label>}

			<EmployeeSelectTrigger
				id={triggerId}
				mode={props.mode}
				selectedEmployees={selectedEmployees}
				placeholder={placeholder}
				controlsId={employeeListboxId}
				expanded={modalOpen}
				disabled={disabled}
				error={error}
				className={triggerClassName}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				aria-describedby={ariaDescribedBy}
				aria-invalid={ariaInvalid}
				aria-required={ariaRequired}
				onClick={() => setModalOpen(true)}
				onBlur={onBlur}
			/>

			{/* Show chips for multi-select below the trigger */}
			{props.mode === "multiple" && showChips && selectedEmployees.length > 0 && (
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
				onOpenChange={handleModalOpenChange}
				listboxId={employeeListboxId}
				mode={props.mode}
				selectedIds={selectedIds}
				onSelect={handleSelect}
				onDeselect={handleDeselect}
				onConfirm={handleConfirm}
				allowClear={allowClear}
				clearLabel={clearLabel}
				searchPlaceholder={searchPlaceholder}
				emptyMessage={emptyMessage}
				title={modalTitle}
				description={modalDescription}
				onSearchChange={onSearchChange}
				isLoading={isLoading}
				excludeIds={excludeIds}
				filters={filters}
				includeFormerEmployees={includeFormerEmployees}
				showFilters={showFilters}
				maxSelections={maxSelections}
				employees={preFilteredEmployees}
				pinnedIds={pinnedIds}
			/>
		</div>
	);
}

/**
 * Simplified single-select component for common use cases
 */
export type EmployeeSingleSelectProps = Omit<
	EmployeeSelectCommonProps & SingleSelectProps,
	"mode"
>;

export function EmployeeSingleSelect(props: EmployeeSingleSelectProps) {
	return <EmployeeSelectField mode="single" {...props} />;
}

/**
 * Simplified multi-select component for common use cases
 */
export type EmployeeMultiSelectProps = Omit<
	EmployeeSelectCommonProps & MultiSelectProps,
	"mode"
>;

export function EmployeeMultiSelect(props: EmployeeMultiSelectProps) {
	return <EmployeeSelectField mode="multiple" {...props} />;
}
