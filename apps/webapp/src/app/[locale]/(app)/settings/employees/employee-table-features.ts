import {
	columnVisibilityFeature,
	createSortedRowModel,
	rowPaginationFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_basic,
	sortFn_text,
	tableFeatures,
} from "@tanstack/react-table";

export const employeeTableFeatures = tableFeatures({
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		text: sortFn_text,
		basic: sortFn_basic,
	},
});

export type EmployeeTableFeatures = typeof employeeTableFeatures;
