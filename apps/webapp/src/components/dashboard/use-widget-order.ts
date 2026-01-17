"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query/keys";
import { getUserSettings, updateWidgetOrder } from "./actions";
import { DEFAULT_WIDGET_ORDER, normalizeWidgetOrder, type WidgetId } from "./widget-registry";

/**
 * Hook for managing dashboard widget order with persistence.
 * Provides optimistic updates and automatic save on reorder.
 */
export function useWidgetOrder() {
	const queryClient = useQueryClient();

	// Fetch user settings
	const { data: settings, isLoading } = useQuery({
		queryKey: queryKeys.dashboard.widgetOrder(),
		queryFn: async () => {
			const result = await getUserSettings();
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		staleTime: 1000 * 60 * 5, // 5 minutes
	});

	// Mutation for saving widget order
	const { mutate: saveOrder, isPending: isSaving } = useMutation({
		mutationFn: async (order: WidgetId[]) => {
			const result = await updateWidgetOrder(order);
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		onMutate: async (newOrder) => {
			// Cancel any outgoing refetches
			await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.widgetOrder() });

			// Snapshot the previous value
			const previousSettings = queryClient.getQueryData(queryKeys.dashboard.widgetOrder());

			// Optimistically update the cache
			queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), {
				dashboardWidgetOrder: { order: newOrder, version: 1 },
			});

			return { previousSettings };
		},
		onError: (_error, _newOrder, context) => {
			// Rollback on error
			if (context?.previousSettings) {
				queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), context.previousSettings);
			}
			toast.error("Failed to save widget order", {
				description: "Your changes could not be saved. Please try again.",
			});
		},
		onSuccess: () => {
			toast.success("Dashboard layout saved");
		},
		onSettled: () => {
			// Always refetch after error or success
			queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.widgetOrder() });
		},
	});

	// Get the current widget order, normalized to handle new/removed widgets
	const widgetOrder = useMemo<WidgetId[]>(() => {
		const savedOrder = settings?.dashboardWidgetOrder?.order;
		if (savedOrder && savedOrder.length > 0) {
			return normalizeWidgetOrder(savedOrder);
		}
		return DEFAULT_WIDGET_ORDER;
	}, [settings?.dashboardWidgetOrder?.order]);

	// Handler for when widgets are reordered
	const onReorder = useCallback(
		(newOrder: WidgetId[]) => {
			saveOrder(newOrder);
		},
		[saveOrder],
	);

	// Reset to default order
	const resetOrder = useCallback(() => {
		saveOrder(DEFAULT_WIDGET_ORDER);
	}, [saveOrder]);

	return {
		/** Current widget order */
		widgetOrder,
		/** Loading state for initial fetch */
		isLoading,
		/** Saving state for persistence */
		isSaving,
		/** Handler to call when widgets are reordered */
		onReorder,
		/** Reset to default widget order */
		resetOrder,
	};
}
