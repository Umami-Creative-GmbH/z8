/**
 * Unified Employee Selection Component
 *
 * A modal-based employee selection component with:
 * - Server-side search and pagination (scales to 1000+ employees)
 * - Consistent display (avatar, name, email, position, role badge)
 * - Single-select and multi-select modes
 * - Filter capabilities (role, status, team)
 * - TanStack Form integration
 *
 * @example Basic usage with TanStack Form (single select)
 * ```tsx
 * <form.Field name="employeeId">
 *   {(field) => (
 *     <EmployeeSelectField
 *       mode="single"
 *       value={field.state.value}
 *       onChange={field.handleChange}
 *       label="Assign Employee"
 *       excludeIds={alreadyAssignedIds}
 *     />
 *   )}
 * </form.Field>
 * ```
 *
 * @example Multi-select with max selections
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
 *
 * @example Simplified components
 * ```tsx
 * // Single select (simpler API)
 * <EmployeeSingleSelect
 *   value={employeeId}
 *   onChange={setEmployeeId}
 *   label="Select Employee"
 * />
 *
 * // Multi-select (simpler API)
 * <EmployeeMultiSelect
 *   value={employeeIds}
 *   onChange={setEmployeeIds}
 *   label="Select Employees"
 *   maxSelections={5}
 * />
 * ```
 */

// Main components
export {
	EmployeeMultiSelect,
	EmployeeSelectField,
	EmployeeSingleSelect,
} from "./employee-select-field";
export { EmployeeSelectItem } from "./employee-select-item";
export { EmployeeSelectList } from "./employee-select-list";
export { EmployeeSelectModal } from "./employee-select-modal";
export { EmployeeChips, EmployeeSelectTrigger } from "./employee-select-trigger";
// Types
export type {
	EmployeeSelectCommonProps,
	EmployeeSelectFieldProps,
	EmployeeSelectFilters,
	EmployeeSelectItemProps,
	EmployeeSelectListProps,
	EmployeeSelectModalProps,
	EmployeeSelectParams,
	EmployeeSelectResponse,
	EmployeeSelectTriggerProps,
	MultiSelectProps,
	SelectableEmployee,
	SingleSelectProps,
} from "./types";
// Hooks
export { useEmployeeSelect, useSelectedEmployees } from "./use-employee-select";
