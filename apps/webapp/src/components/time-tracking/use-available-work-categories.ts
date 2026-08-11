"use client";

import { useQuery } from "@tanstack/react-query";
import { getAvailableCategoriesForEmployee } from "@/app/[locale]/(app)/settings/work-categories/actions";
import { queryKeys } from "@/lib/query";

const EMPTY_CATEGORIES: WorkCategory[] = [];

export interface WorkCategory {
	id: string;
	name: string;
	factor: string;
	color: string | null;
}

export function useAvailableWorkCategories(employeeId: string, enabled = true) {
	const query = useQuery({
		queryKey: queryKeys.workCategories.available(employeeId),
		queryFn: async () => {
			const result = await getAvailableCategoriesForEmployee(employeeId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch categories");
			}
			return result.data as WorkCategory[];
		},
		enabled: enabled && !!employeeId,
	});

	return {
		categories: query.data || EMPTY_CATEGORIES,
		isLoading: query.isLoading,
		isError: query.isError,
	};
}
