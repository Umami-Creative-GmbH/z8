"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query/keys";
import { getUserSettings, updateWidgetOrder } from "./actions";
import {
	DEFAULT_WIDGET_ORDER,
	mergeVisibleWidgetOrder,
	normalizeWidgetLayout,
	type WidgetId,
} from "./widget-registry";

type WidgetLayout = {
	order: WidgetId[];
	hidden: WidgetId[];
	version: 1;
};

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

	// Mutation for saving widget layout
	const { mutate: saveLayout, isPending: isSaving } = useMutation({
		mutationFn: async (layout: WidgetLayout) => {
			const result = await updateWidgetOrder(layout);
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		onMutate: async (newLayout) => {
			// Cancel any outgoing refetches
			await queryClient.cancelQueries({ queryKey: queryKeys.dashboard.widgetOrder() });

			// Snapshot the previous value
			const previousSettings = queryClient.getQueryData(queryKeys.dashboard.widgetOrder());

			// Optimistically update the cache
			queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), {
				dashboardWidgetOrder: newLayout,
			});

			return { previousSettings };
		},
		onError: (_error, _newLayout, context) => {
			// Rollback on error
			if (context?.previousSettings) {
				queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), context.previousSettings);
			}
			toast.error("Failed to save dashboard layout", {
				description: "Your changes could not be saved. Please try again.",
			});
		},
		onSuccess: () => {
			toast.success("Dashboard layout saved");
			// Don't invalidate on success - optimistic update is already correct
		},
		// Only refetch on error (handled in onError with rollback)
	});

	const layout = useMemo<WidgetLayout>(() => {
		return normalizeWidgetLayout(
			settings?.dashboardWidgetOrder ?? { order: DEFAULT_WIDGET_ORDER, hidden: [], version: 1 },
		);
	}, [settings?.dashboardWidgetOrder]);

	const hiddenSet = useMemo(() => new Set(layout.hidden), [layout.hidden]);

	const visibleWidgetOrder = useMemo<WidgetId[]>(() => {
		return layout.order.filter((widgetId) => !hiddenSet.has(widgetId));
	}, [hiddenSet, layout.order]);

	// Handler for when widgets are reordered
	const onReorder = useCallback(
		(newVisibleOrder: WidgetId[]) => {
			saveLayout({
				order: mergeVisibleWidgetOrder(layout.order, newVisibleOrder, layout.hidden),
				hidden: layout.hidden,
				version: 1,
			});
		},
		[layout.hidden, layout.order, saveLayout],
	);

	const onVisibilityChange = useCallback(
		(widgetId: WidgetId, visible: boolean) => {
			const nextHidden = visible
				? layout.hidden.filter((hiddenWidgetId) => hiddenWidgetId !== widgetId)
				: [...layout.hidden, widgetId].filter(
						(hiddenWidgetId, index, hiddenWidgets) =>
							hiddenWidgets.indexOf(hiddenWidgetId) === index,
					);

			saveLayout({
				order: layout.order,
				hidden: nextHidden,
				version: 1,
			});
		},
		[layout.hidden, layout.order, saveLayout],
	);

	// Reset to default order
	const resetOrder = useCallback(() => {
		saveLayout({ order: DEFAULT_WIDGET_ORDER, hidden: [], version: 1 });
	}, [saveLayout]);

	return {
		/** Current widget order */
		widgetOrder: layout.order,
		visibleWidgetOrder,
		hiddenWidgets: layout.hidden,
		/** Loading state for initial fetch */
		isLoading,
		/** Saving state for persistence */
		isSaving,
		/** Handler to call when widgets are reordered */
		onReorder,
		onVisibilityChange,
		/** Reset to default widget order */
		resetOrder,
	};
}
