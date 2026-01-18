/**
 * Shared types for server-side paginated tables
 */

/**
 * Standard pagination parameters for server actions
 */
export interface PaginatedParams {
	limit?: number;
	offset?: number;
	search?: string;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
	filters?: Record<string, string | string[]>;
}

/**
 * Standard paginated response from server actions
 */
export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	hasMore: boolean;
}

/**
 * Filter option for dropdowns/selects
 */
export interface FilterOption {
	label: string;
	value: string;
	icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Filter configuration for toolbar
 */
export interface FilterConfig {
	key: string;
	label: string;
	options: FilterOption[];
	defaultValue?: string;
}
