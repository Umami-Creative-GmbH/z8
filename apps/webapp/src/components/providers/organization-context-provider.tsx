"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	use,
	useEffect,
	useLayoutEffect,
} from "react";
import {
	ORGANIZATION_CONTEXT_HEADERS,
	type OrganizationDisplayContext,
} from "@/lib/auth/organization-display-context";
import { useSession } from "@/lib/auth-client";
import { ApiError, fetchApi } from "@/lib/fetch";
import { queryKeys } from "@/lib/query/keys";
import { useRouter } from "@/navigation";
import {
	OrganizationSettingsStoreProvider,
	useOrganizationSettings,
} from "@/stores/organization-settings-store";

export interface OrganizationContext {
	organizationId: string | null;
	employeeId: string | null;
	role: "admin" | "manager" | "employee" | null;
	isLoading: boolean;
	error: string | null;
	isAdmin: boolean;
	isManager: boolean;
	isManagerOrAbove: boolean;
	refetch: () => Promise<void>;
}

const SharedOrganizationContext = createContext<OrganizationContext | null>(
	null,
);

type ContextResponse = {
	user: { id: string };
	session: { activeOrganizationId: string | null };
	employee: OrganizationDisplayContext["employee"];
	organizationSettings: OrganizationDisplayContext["organizationSettings"];
};

async function fetchOrganizationDisplayContext(
	userId: string | null,
	organizationId: string | null,
	signal: AbortSignal,
): Promise<OrganizationDisplayContext> {
	const response = await fetchApi<ContextResponse>("/api/auth/context", {
		cache: "no-store",
		signal,
		headers: {
			[ORGANIZATION_CONTEXT_HEADERS.user]: userId ?? "",
			[ORGANIZATION_CONTEXT_HEADERS.organization]: organizationId ?? "",
		},
	});
	if (
		response.user.id !== userId ||
		(response.session.activeOrganizationId ?? null) !== organizationId ||
		(response.employee &&
			response.employee.organizationId !== organizationId) ||
		(response.organizationSettings &&
			response.organizationSettings.organizationId !== organizationId)
	) {
		throw new ApiError(
			"Organization context changed. Refresh to continue.",
			409,
		);
	}
	return {
		userId: response.user.id,
		organizationId: response.session.activeOrganizationId,
		employee: response.employee,
		organizationSettings: response.organizationSettings,
		updatedAt: Date.now(),
	};
}

function useOrganizationQuery(
	bootstrap?: OrganizationDisplayContext | null,
	enabled = true,
) {
	const { data: session, isPending } = useSession();
	const { userId, organizationId } = displayScope(
		session,
		isPending,
		bootstrap,
	);
	const initial =
		bootstrap?.userId === userId && bootstrap.organizationId === organizationId
			? bootstrap
			: undefined;
	const query = useQuery({
		queryKey: queryKeys.organizationContext.current(userId, organizationId),
		enabled: enabled && Boolean(userId) && !isPending,
		initialData: initial,
		initialDataUpdatedAt: initial?.updatedAt,
		staleTime: 60_000,
		retry: false,
		refetchOnWindowFocus: false,
		queryFn: ({ signal }) =>
			fetchOrganizationDisplayContext(userId, organizationId, signal),
	});
	const data =
		userId && !query.isError
			? latestDisplayContext(initial, query.data)
			: undefined;
	const role = data?.employee?.role ?? null;
	const context: OrganizationContext = {
		organizationId: data?.employee?.organizationId ?? null,
		employeeId: data?.employee?.employeeId ?? null,
		role,
		isLoading: !data && (isPending || (Boolean(userId) && query.isPending)),
		error: query.error?.message ?? null,
		isAdmin: role === "admin",
		isManager: role === "manager",
		isManagerOrAbove: role === "admin" || role === "manager",
		refetch: async () => {
			if (userId && !isPending) await query.refetch({ cancelRefetch: false });
		},
	};
	return { userId, organizationId, data, context, error: query.error };
}

function displayScope(
	session: ReturnType<typeof useSession>["data"],
	isPending: boolean,
	bootstrap?: OrganizationDisplayContext | null,
) {
	if (session?.user.id) {
		return {
			userId: session.user.id,
			organizationId: session.session.activeOrganizationId ?? null,
		};
	}
	if (isPending && bootstrap) {
		return {
			userId: bootstrap.userId,
			organizationId: bootstrap.organizationId,
		};
	}
	return { userId: null, organizationId: null };
}

function latestDisplayContext(
	bootstrap: OrganizationDisplayContext | undefined,
	cached: OrganizationDisplayContext | undefined,
) {
	if (bootstrap && (!cached || bootstrap.updatedAt > cached.updatedAt))
		return bootstrap;
	return cached;
}

type QueryState = ReturnType<typeof useOrganizationQuery>;

function useHydrateOrganizationSettings(
	data: OrganizationDisplayContext | undefined,
	enabled = true,
) {
	const hydrate = useOrganizationSettings((store) => store.hydrate);
	const reset = useOrganizationSettings((store) => store.reset);
	useLayoutEffect(() => {
		if (!enabled) return;
		if (data?.organizationSettings) hydrate(data.organizationSettings);
		else reset();
	}, [hydrate, reset, data, enabled]);
}

function useContextRedirect(error: Error | null, enabled = true) {
	const { replace } = useRouter();
	useEffect(() => {
		if (enabled && error instanceof ApiError && error.isUnauthorized())
			replace("/sign-in");
	}, [error, enabled, replace]);
}

function SynchronizeOrganization({ state }: { state: QueryState }) {
	const client = useQueryClient();
	useHydrateOrganizationSettings(state.data);
	useContextRedirect(state.error);
	useLayoutEffect(() => {
		if (state.data) {
			const key = queryKeys.organizationContext.current(
				state.userId,
				state.organizationId,
			);
			if (
				state.data.updatedAt > (client.getQueryState(key)?.dataUpdatedAt ?? 0)
			) {
				client.setQueryData(key, state.data, {
					updatedAt: state.data.updatedAt,
				});
			}
		}
		client.removeQueries({
			queryKey: queryKeys.organizationContext.all,
			predicate: (query) =>
				query.queryKey[1] !== state.userId ||
				query.queryKey[2] !== state.organizationId,
		});
	}, [client, state.userId, state.organizationId, state.data]);
	return null;
}

export function OrganizationContextProvider({
	children,
	initialContext,
}: {
	children: ReactNode;
	initialContext: OrganizationDisplayContext | null;
}) {
	const state = useOrganizationQuery(initialContext);
	return (
		<OrganizationSettingsStoreProvider
			key={JSON.stringify([state.userId, state.organizationId])}
			initialSettings={state.data?.organizationSettings}
		>
			<SharedOrganizationContext value={state.context}>
				<SynchronizeOrganization state={state} />
				{children}
			</SharedOrganizationContext>
		</OrganizationSettingsStoreProvider>
	);
}

export function useOrganization(): OrganizationContext {
	const shared = use(SharedOrganizationContext);
	const fallback = useOrganizationQuery(undefined, shared === null);
	useHydrateOrganizationSettings(fallback.data, shared === null);
	useContextRedirect(fallback.error, shared === null);
	return shared ?? fallback.context;
}
