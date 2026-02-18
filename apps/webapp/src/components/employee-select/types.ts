/**
 * Types for the unified employee selection component
 */

/**
 * Minimal employee data needed for selection display
 * Optimized to reduce payload size for large employee lists
 */
export interface SelectableEmployee {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	teamId: string | null;
	user: {
		id: string;
		name: string | null;
		email: string;
		image: string | null;
	};
	team: {
		id: string;
		name: string;
	} | null;
}

/**
 * Filter options for employee search
 */
export interface EmployeeSelectFilters {
	role?: "admin" | "manager" | "employee" | "all";
	status?: "active" | "inactive" | "all";
	teamId?: string;
}

/**
 * Parameters for the employee select query
 */
export interface EmployeeSelectParams {
	search?: string;
	filters?: EmployeeSelectFilters;
	excludeIds?: string[];
	limit?: number;
	offset?: number;
}

/**
 * Paginated response for employee selection
 */
export interface EmployeeSelectResponse {
	employees: SelectableEmployee[];
	total: number;
	hasMore: boolean;
}

/**
 * Props for single-select mode
 */
export interface SingleSelectProps {
	mode: "single";
	value: string | null;
	onChange: (value: string | null) => void;
}

/**
 * Props for multi-select mode
 */
export interface MultiSelectProps {
	mode: "multiple";
	value: string[];
	onChange: (value: string[]) => void;
	maxSelections?: number;
}

/**
 * Common props shared by both modes
 */
export interface EmployeeSelectCommonProps {
	/** IDs to exclude from the list (e.g., already assigned employees) */
	excludeIds?: string[];
	/** Pre-applied filters */
	filters?: EmployeeSelectFilters;
	/** Show filter controls in the modal */
	showFilters?: boolean;
	/** Field label */
	label?: string;
	/** Placeholder text for the trigger button */
	placeholder?: string;
	/** Whether the field is disabled */
	disabled?: boolean;
	/** Error message to display */
	error?: string;
	/** Additional class names for the trigger button */
	className?: string;
	/**
	 * Pre-filtered employee list (optional).
	 * When provided, skips server-side fetching and uses this list directly.
	 * Useful for permission-filtered lists or when data is already loaded.
	 */
	employees?: SelectableEmployee[];
}

/**
 * Combined props for the EmployeeSelectField component
 */
export type EmployeeSelectFieldProps = EmployeeSelectCommonProps &
	(SingleSelectProps | MultiSelectProps);

/**
 * Props for the trigger button component
 */
export interface EmployeeSelectTriggerProps {
	mode: "single" | "multiple";
	selectedEmployees: SelectableEmployee[];
	placeholder?: string;
	controlsId?: string;
	expanded?: boolean;
	disabled?: boolean;
	error?: string;
	className?: string;
	onClick: () => void;
}

/**
 * Props for the modal component
 */
export interface EmployeeSelectModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	listboxId?: string;
	mode: "single" | "multiple";
	selectedIds: string[];
	onSelect: (employee: SelectableEmployee) => void;
	onDeselect: (employeeId: string) => void;
	onConfirm: () => void;
	excludeIds?: string[];
	filters?: EmployeeSelectFilters;
	showFilters?: boolean;
	maxSelections?: number;
	/**
	 * Pre-filtered employee list (optional).
	 * When provided, uses this list instead of server-side fetching.
	 */
	employees?: SelectableEmployee[];
}

/**
 * Props for individual employee item in the list
 */
export interface EmployeeSelectItemProps {
	employee: SelectableEmployee;
	isSelected: boolean;
	mode: "single" | "multiple";
	onClick: () => void;
	disabled?: boolean;
}

/**
 * Props for the employee list component
 */
export interface EmployeeSelectListProps {
	employees: SelectableEmployee[];
	selectedIds: string[];
	mode: "single" | "multiple";
	onSelect: (employee: SelectableEmployee) => void;
	onDeselect: (employeeId: string) => void;
	isLoading: boolean;
	hasMore: boolean;
	onLoadMore: () => void;
	maxSelections?: number;
}
