"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/use-organization";

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
	const { organizationId } = useOrganization();
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const prevOrgIdRef = useRef<string | null>(null);

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

	// Initial load
	useEffect(() => {
		loadData(false);
	}, [loadData]);

	// Re-fetch when organization changes
	useEffect(() => {
		if (prevOrgIdRef.current !== null && prevOrgIdRef.current !== organizationId) {
			setLoading(true);
			setData(null);
			loadData(false);
		}
		prevOrgIdRef.current = organizationId;
	}, [organizationId, loadData]);

	const refetch = useCallback(() => {
		loadData(true);
	}, [loadData]);

	return { data, loading, refreshing, refetch };
}
