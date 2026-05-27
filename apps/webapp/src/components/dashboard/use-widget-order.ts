"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
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

type WidgetOrderSettings = {
	dashboardWidgetOrder?: Parameters<typeof normalizeWidgetLayout>[0];
};

function areWidgetLayoutsEqual(left: WidgetLayout, right: WidgetLayout) {
	return (
		left.version === right.version &&
		left.order.length === right.order.length &&
		left.hidden.length === right.hidden.length &&
		left.order.every((widgetId, index) => widgetId === right.order[index]) &&
		left.hidden.every((widgetId, index) => widgetId === right.hidden[index])
	);
}

/**
 * Hook for managing dashboard widget order with persistence.
 * Provides optimistic updates and automatic save on reorder.
 */
export function useWidgetOrder() {
	const { t } = useTranslate();
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

	const layout = (() => {
		return normalizeWidgetLayout(settings?.dashboardWidgetOrder ?? null);
	})();

	const getLatestLayout = () => {
		const cachedSettings = queryClient.getQueryData<WidgetOrderSettings>(
			queryKeys.dashboard.widgetOrder(),
		);

		if (!cachedSettings) {
			return layout;
		}

		return normalizeWidgetLayout(cachedSettings.dashboardWidgetOrder ?? null);
	};

	// Mutation for saving widget layout
	const { mutate: saveLayout, isPending: isSaving } = useMutation({
		scope: { id: "dashboard-layout" },
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
			const previousSettings = queryClient.getQueryData<WidgetOrderSettings>(
				queryKeys.dashboard.widgetOrder(),
			);

			// Optimistically update the cache
			queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), {
				dashboardWidgetOrder: newLayout,
			});

			return { previousSettings, newLayout };
		},
		onError: (_error, _newLayout, context) => {
			const currentSettings = queryClient.getQueryData<WidgetOrderSettings>(
				queryKeys.dashboard.widgetOrder(),
			);
			const currentLayout = currentSettings?.dashboardWidgetOrder;

			if (
				context &&
				(currentLayout === context.newLayout ||
					(currentLayout &&
						areWidgetLayoutsEqual(normalizeWidgetLayout(currentLayout), context.newLayout)))
			) {
				queryClient.setQueryData(queryKeys.dashboard.widgetOrder(), context.previousSettings);
			}
			toast.error(t("dashboard.layout.saveFailed", "Failed to save dashboard layout"), {
				description: t(
					"dashboard.layout.saveFailedDescription",
					"Your changes could not be saved. Please try again.",
				),
			});
		},
		onSuccess: () => {
			toast.success(t("dashboard.layout.saved", "Dashboard layout saved"));
			// Don't invalidate on success - optimistic update is already correct
		},
		// Only refetch on error (handled in onError with rollback)
	});

	const hiddenSet = new Set(layout.hidden);

	const visibleWidgetOrder = (() => {
		return layout.order.filter((widgetId) => !hiddenSet.has(widgetId));
	})();

	// Handler for when widgets are reordered
	const onReorder = (newVisibleOrder: WidgetId[]) => {
		const latestLayout = getLatestLayout();

		saveLayout({
			order: mergeVisibleWidgetOrder(latestLayout.order, newVisibleOrder, latestLayout.hidden),
			hidden: latestLayout.hidden,
			version: 1,
		});
	};

	const onVisibilityChange = (widgetId: WidgetId, visible: boolean) => {
		const latestLayout = getLatestLayout();
		const nextHidden = visible
			? latestLayout.hidden.filter((hiddenWidgetId) => hiddenWidgetId !== widgetId)
			: [...latestLayout.hidden, widgetId].filter(
					(hiddenWidgetId, index, hiddenWidgets) => hiddenWidgets.indexOf(hiddenWidgetId) === index,
				);

		saveLayout({
			order: latestLayout.order,
			hidden: nextHidden,
			version: 1,
		});
	};

	// Reset to default order
	const resetOrder = () => {
		saveLayout({ order: DEFAULT_WIDGET_ORDER, hidden: [], version: 1 });
	};

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
