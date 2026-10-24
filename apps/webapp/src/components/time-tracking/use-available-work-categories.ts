"use client";

import { useQuery } from "@tanstack/react-query";
import { getAvailableCategoriesForEmployee } from "@/app/[locale]/(app)/settings/work-categories/actions";
import { useSession } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";

const EMPTY_CATEGORIES: WorkCategory[] = [];

export interface WorkCategory {
	id: string;
	name: string;
	factor: string;
	color: string | null;
}

export function useAvailableWorkCategories(employeeId: string, enabled = true) {
	const { data: session, isPending } = useSession();
	const scope = {
		userId: session?.user.id ?? null,
		organizationId: session?.session.activeOrganizationId ?? null,
		isLoading: isPending,
	};
	const query = useQuery({
		queryKey: queryKeys.workCategories.available(employeeId, scope.organizationId, scope.userId),
		queryFn: async () => {
			const result = await getAvailableCategoriesForEmployee(employeeId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch categories");
			}
			return result.data as WorkCategory[];
		},
		enabled:
			enabled && !!employeeId && !!scope.userId && !!scope.organizationId && !scope.isLoading,
		staleTime: 60_000,
		retry: false,
	});

	return {
		categories: query.data || EMPTY_CATEGORIES,
		isLoading: query.isLoading,
		isError: query.isError,
		refetch: query.refetch,
	};
}
