"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useLayoutEffect, useMemo } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { ORGANIZATION_CONTEXT_HEADERS } from "@/lib/auth/organization-display-context";
import { ApiError, fetchApi } from "@/lib/fetch";
import { queryKeys } from "@/lib/query/keys";
import type {
	DashboardScope,
	DashboardWidgetData,
	DashboardWidgetSnapshot,
	ServerWidgetId,
} from "./dashboard-types";
import { DashboardWidgetRefreshOwnerContext } from "./dashboard-widget-refresh-context";

export function sameDashboardScope(left: DashboardScope, right: DashboardScope | null) {
	return (
		right !== null && left.userId === right.userId && left.organizationId === right.organizationId
	);
}

export function useDashboardWidget<K extends ServerWidgetId>(
	id: K,
	initialSnapshot?: DashboardWidgetSnapshot<DashboardWidgetData[K]>,
) {
	const organization = useOrganization();
	const refreshOwner = use(DashboardWidgetRefreshOwnerContext);
	const client = useQueryClient();
	const scope =
		organization.userId && organization.organizationId
			? {
					userId: organization.userId,
					organizationId: organization.organizationId,
				}
			: null;
	const initial =
		initialSnapshot && sameDashboardScope(initialSnapshot.scope, scope)
			? initialSnapshot
			: undefined;
	const key = useMemo(
		() => queryKeys.dashboard.widget(id, scope?.userId ?? null, scope?.organizationId ?? null),
		[id, scope?.userId, scope?.organizationId],
	);
	const query = useQuery({
		queryKey: key,
		enabled: Boolean(scope) && !organization.isLoading,
		initialData: initial,
		initialDataUpdatedAt: initial?.updatedAt,
		staleTime: 60_000,
		// The server already owns initial delivery, including a slowly streamed snapshot.
		refetchOnMount: !initial,
		retry: false,
		refetchOnWindowFocus: false,
		meta: { viewRefresh: refreshOwner },
		queryFn: async ({ signal }) => {
			if (!scope) throw new ApiError("Authentication required", 401);
			const result = await fetchApi<DashboardWidgetSnapshot<DashboardWidgetData[K]>>(
				`/api/dashboard/widgets/${id}`,
				{
					signal,
					cache: "no-store",
					headers: {
						[ORGANIZATION_CONTEXT_HEADERS.user]: scope.userId,
						[ORGANIZATION_CONTEXT_HEADERS.organization]: scope.organizationId,
					},
				},
			);
			if (!sameDashboardScope(result.scope, scope))
				throw new ApiError("Dashboard context changed. Refresh to continue.", 409);
			return result;
		},
	});
	const initialIsNewer = initial && (!query.data || initial.updatedAt > query.data.updatedAt);
	const snapshot = scope ? (initialIsNewer ? initial : query.data) : undefined;
	// Compare server snapshot time, never the browser's query dataUpdatedAt clock.
	useLayoutEffect(() => {
		if (!initial) return;
		const cached = client.getQueryData<DashboardWidgetSnapshot<DashboardWidgetData[K]>>(key);
		if (cached && cached.updatedAt >= initial.updatedAt) return;
		void client.cancelQueries({ queryKey: key, exact: true }).then(() => {
			const latest = client.getQueryData<DashboardWidgetSnapshot<DashboardWidgetData[K]>>(key);
			if (!latest || latest.updatedAt < initial.updatedAt) {
				client.setQueryData(key, initial, { updatedAt: initial.updatedAt });
			}
		});
	}, [client, key, initial]);
	const error =
		(!initialIsNewer && query.error?.message) ||
		(snapshot?.result.success === false ? snapshot.result.error : null);
	return {
		data: snapshot?.result.success ? snapshot.result.data : null,
		loading: Boolean(scope) && !snapshot && query.isPending,
		refreshing: query.isFetching && Boolean(snapshot),
		error,
		role: organization.role,
		refetch: () => query.refetch({ cancelRefetch: false }),
	};
}
