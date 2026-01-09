"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type ActionResult<T> = {
	success: boolean;
	data?: T;
	error?: string;
};

interface UseWidgetDataOptions {
	errorMessage?: string;
}

export function useWidgetData<T>(
	fetcher: () => Promise<ActionResult<T>>,
	options?: UseWidgetDataOptions,
) {
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);

	const loadData = useCallback(
		async (isRefresh = false) => {
			if (isRefresh) {
				setRefreshing(true);
			}
			try {
				const result = await fetcher();
				if (result.success && result.data) {
					setData(result.data);
				}
			} catch {
				toast.error(options?.errorMessage ?? "Failed to load data");
			} finally {
				setLoading(false);
				setRefreshing(false);
			}
		},
		[fetcher, options?.errorMessage],
	);

	useEffect(() => {
		loadData(false);
	}, [loadData]);

	const refetch = useCallback(() => {
		loadData(true);
	}, [loadData]);

	return { data, loading, refreshing, refetch };
}
