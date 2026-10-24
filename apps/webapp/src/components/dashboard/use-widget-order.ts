"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useMemo } from "react";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/use-organization";
import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import { ApiError, fetchApi } from "@/lib/fetch";
import { queryKeys } from "@/lib/query/keys";
import { updateWidgetOrder } from "./actions";
import type { DashboardLayoutBootstrap, DashboardScope } from "./dashboard-types";
import { sameDashboardScope } from "./use-dashboard-widget";
import {
	DEFAULT_WIDGET_ORDER,
	eligibleWidgetIds,
	mergeVisibleWidgetOrder,
	normalizeWidgetLayout,
	type WidgetId,
} from "./widget-registry";

type WidgetLayout = {
	order: WidgetId[];
	hidden: WidgetId[];
	version: 1;
};

type LayoutSnapshot = DashboardLayoutBootstrap & { pending?: WidgetLayout };

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
export function useWidgetOrder(
	initialLayout?: DashboardLayoutBootstrap,
	{ waitForServerLayout = false } = {},
) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const organization = useOrganization();
	const scope =
		organization.userId && organization.organizationId
			? {
					userId: organization.userId,
					organizationId: organization.organizationId,
				}
			: null;
	const queryKey = useMemo(
		() => queryKeys.dashboard.widgetOrder(scope?.userId ?? null, scope?.organizationId ?? null),
		[scope?.userId, scope?.organizationId],
	);
	const initial =
		initialLayout && sameDashboardScope(initialLayout.scope, scope) ? initialLayout : undefined;

	const { data: saved, isLoading } = useQuery<LayoutSnapshot>({
		queryKey,
		enabled: Boolean(scope) && !organization.isLoading && !waitForServerLayout,
		initialData: initial,
		initialDataUpdatedAt: initial?.updatedAt,
		queryFn: async ({ signal }) => {
			if (!scope) throw new ApiError("Authentication required", 401);
			const result = await fetchApi<DashboardLayoutBootstrap>("/api/dashboard/layout", {
				signal,
				cache: "no-store",
				headers: {
					[ORGANIZATION_CONTEXT_HEADERS.user]: scope.userId,
					[ORGANIZATION_CONTEXT_HEADERS.organization]: scope.organizationId,
				},
			});
			if (!sameDashboardScope(result.scope, scope))
				throw new ApiError("Dashboard context changed. Refresh to continue.", 409);
			return result;
		},
		staleTime: 1000 * 60 * 5, // 5 minutes
		retry: false,
		refetchOnWindowFocus: false,
		meta: { viewRefresh: "server" },
	});
	useLayoutEffect(() => {
		if (!initial) return;
		// Preserve an in-flight layout edit while accepting newer display eligibility.
		if (saved?.pending) {
			if (
				initial.updatedAt > saved.updatedAt &&
				initial.availableWidgetIds?.join("|") !== saved.availableWidgetIds?.join("|")
			) {
				queryClient.setQueryData<LayoutSnapshot>(queryKey, (current) =>
					current?.pending
						? { ...current, availableWidgetIds: initial.availableWidgetIds }
						: current,
				);
			}
			return;
		}
		if (saved && saved.updatedAt >= initial.updatedAt) return;
		void queryClient.cancelQueries({ queryKey, exact: true }).then(() => {
			const latest = queryClient.getQueryData<LayoutSnapshot>(queryKey);
			if (!latest?.pending && (!latest || latest.updatedAt < initial.updatedAt))
				queryClient.setQueryData(queryKey, initial, {
					updatedAt: initial.updatedAt,
				});
		});
	}, [initial, saved, queryClient, queryKey]);
	const snapshot = scope
		? !saved?.pending && initial && (!saved || initial.updatedAt > saved.updatedAt)
			? initial
			: saved
		: undefined;
	const settings = snapshot?.settings;
	const roleEligible = new Set(eligibleWidgetIds({ role: organization.role }));
	const availableWidgetIds = (snapshot?.availableWidgetIds ?? DEFAULT_WIDGET_ORDER).filter((id) =>
		roleEligible.has(id),
	);

	const layout = (() => {
		return normalizeWidgetLayout(settings?.dashboardWidgetOrder ?? null, availableWidgetIds);
	})();

	const getLatestLayout = () => {
		const cachedSettings = queryClient.getQueryData<LayoutSnapshot>(queryKey);

		if (!cachedSettings) {
			return layout;
		}

		return normalizeWidgetLayout(
			cachedSettings.settings.dashboardWidgetOrder ?? null,
			availableWidgetIds,
		);
	};

	// Mutation for saving widget layout
	const { mutate, isPending: isSaving } = useMutation({
		scope: { id: "dashboard-layout" },
		mutationFn: async ({
			layout,
			scope,
		}: {
			layout: WidgetLayout;
			scope: DashboardScope;
			queryKey: ReturnType<typeof queryKeys.dashboard.widgetOrder>;
		}) => {
			const result = await updateWidgetOrder(layout, scope);
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		onMutate: async ({ layout: newLayout, scope, queryKey }) => {
			// Cancel any outgoing refetches
			await queryClient.cancelQueries({ queryKey, exact: true });

			// Snapshot the previous value
			const previousSettings = queryClient.getQueryData<LayoutSnapshot>(queryKey);

			// Optimistically update the cache
			queryClient.setQueryData<LayoutSnapshot>(queryKey, {
				scope,
				availableWidgetIds: previousSettings?.availableWidgetIds,
				updatedAt: previousSettings?.updatedAt ?? 0,
				settings: { dashboardWidgetOrder: newLayout },
				pending: newLayout,
			});

			return { previousSettings, newLayout };
		},
		onError: (_error, { queryKey }, context) => {
			const currentSettings = queryClient.getQueryData<LayoutSnapshot>(queryKey);
			const currentLayout = currentSettings?.settings.dashboardWidgetOrder;

			if (
				context &&
				(currentLayout === context.newLayout ||
					(currentLayout &&
						areWidgetLayoutsEqual(normalizeWidgetLayout(currentLayout), context.newLayout)))
			) {
				queryClient.setQueryData(queryKey, context.previousSettings);
			}
			toast.error(t("dashboard.layout.saveFailed", "Failed to save dashboard layout"), {
				description: t(
					"dashboard.layout.saveFailedDescription",
					"Your changes could not be saved. Please try again.",
				),
			});
		},
		onSuccess: (result, { layout: newLayout, queryKey }) => {
			queryClient.setQueryData<LayoutSnapshot>(queryKey, (current) =>
				current?.pending === newLayout
					? { ...current, pending: undefined, updatedAt: result.updatedAt }
					: current,
			);
			toast.success(t("dashboard.layout.saved", "Dashboard layout saved"));
			// Don't invalidate on success - optimistic update is already correct
		},
		// Only refetch on error (handled in onError with rollback)
	});
	const saveLayout = (layout: WidgetLayout) => {
		if (scope) mutate({ layout, scope, queryKey });
	};

	const hiddenSet = new Set([
		...layout.hidden,
		...DEFAULT_WIDGET_ORDER.filter((id) => !availableWidgetIds.includes(id)),
	]);

	const visibleWidgetOrder = (() => {
		return layout.order.filter((widgetId) => !hiddenSet.has(widgetId));
	})();

	// Handler for when widgets are reordered
	const onReorder = (newVisibleOrder: WidgetId[]) => {
		const latestLayout = getLatestLayout();

		saveLayout({
			order: mergeVisibleWidgetOrder(latestLayout.order, newVisibleOrder, [
				...latestLayout.hidden,
				...DEFAULT_WIDGET_ORDER.filter((id) => !availableWidgetIds.includes(id)),
			]),
			hidden: latestLayout.hidden,
			version: 1,
		});
	};

	const onVisibilityChange = (widgetId: WidgetId, visible: boolean) => {
		if (!availableWidgetIds.includes(widgetId)) return;
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
		saveLayout({ order: availableWidgetIds, hidden: [], version: 1 });
	};

	return {
		/** Current widget order */
		widgetOrder: layout.order,
		availableWidgetIds,
		visibleWidgetOrder,
		hiddenWidgets: [...hiddenSet],
		/** Loading state for initial fetch */
		isLoading: isLoading || (waitForServerLayout && !snapshot),
		/** Saving state for persistence */
		isSaving,
		/** Handler to call when widgets are reordered */
		onReorder,
		onVisibilityChange,
		/** Reset to default widget order */
		resetOrder,
	};
}
