"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { useCallback, useState } from "react";
import {
	getHolidays,
	type HolidayListParams,
	type HolidayWithCategory,
} from "@/app/[locale]/(app)/settings/holidays/actions";
import type { PaginatedResponse } from "@/lib/data-table/types";
import { queryKeys } from "./keys";

interface UseHolidaysOptions {
	organizationId: string;
	initialPageSize?: number;
}

export function useHolidays({ organizationId, initialPageSize = 20 }: UseHolidaysOptions) {
	const queryClient = useQueryClient();

	// Filter state
	const [search, setSearchState] = useState("");
	const [categoryId, setCategoryIdState] = useState<string>("all");

	// Pagination state (synced with react-table)
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: initialPageSize,
	});

	// Sorting state
	const [sorting, setSorting] = useState<SortingState>([]);

	// Build params from state
	const params: HolidayListParams = {
		search: search || undefined,
		categoryId: categoryId === "all" ? undefined : categoryId,
		limit: pagination.pageSize,
		offset: pagination.pageIndex * pagination.pageSize,
		sortBy: sorting[0]?.id,
		sortOrder: sorting[0]?.desc ? "desc" : "asc",
	};

	// Main holidays query
	const holidaysQuery = useQuery({
		queryKey: queryKeys.holidays.list(organizationId, params),
		queryFn: async (): Promise<PaginatedResponse<HolidayWithCategory>> => {
			const result = await getHolidays(organizationId, params);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: !!organizationId,
		staleTime: 30 * 1000,
		placeholderData: (prev) => prev,
	});

	// Filter setters (reset to page 0)
	const setSearch = useCallback((value: string) => {
		setSearchState(value);
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, []);

	const setCategoryId = useCallback((value: string) => {
		setCategoryIdState(value);
		setPagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, []);

	// Refresh
	const refresh = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.holidays.all });
	}, [queryClient]);

	return {
		// Data
		holidays: holidaysQuery.data?.data ?? [],
		total: holidaysQuery.data?.total ?? 0,
		hasMore: holidaysQuery.data?.hasMore ?? false,

		// Loading states
		isLoading: holidaysQuery.isLoading,
		isFetching: holidaysQuery.isFetching,
		isError: holidaysQuery.isError,

		// Filters
		search,
		categoryId,
		setSearch,
		setCategoryId,

		// Sorting
		sorting,
		setSorting,

		// Pagination (for react-table)
		pagination,
		setPagination,
		pageCount: Math.ceil((holidaysQuery.data?.total ?? 0) / pagination.pageSize) || 1,

		// Actions
		refresh,
	};
}
