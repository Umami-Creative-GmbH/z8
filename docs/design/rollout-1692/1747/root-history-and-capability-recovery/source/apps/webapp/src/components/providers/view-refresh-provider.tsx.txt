"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useRef,
	useState,
	useTransition,
} from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

type RefreshHandler = () => unknown;
type RegisterRefresh = (handler: RefreshHandler) => () => void;

const RefreshRegistrationContext = createContext<RegisterRefresh | null>(null);
const ViewRefreshContext = createContext<{
	refresh: () => void;
	isRefreshing: boolean;
} | null>(null);

/** Refresh fetched data in place. Never remount the route or reset its drafts. */
export function ViewRefreshProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { mutate } = useSWRConfig();
	const { t } = useTranslate();
	const [handlers] = useState(() => new Set<RefreshHandler>());
	const [isRefreshing, startTransition] = useTransition();
	const refreshing = useRef(false);

	useEffect(() => {
		if (!isRefreshing) refreshing.current = false;
	}, [isRefreshing]);

	const register = useCallback(
		(handler: RefreshHandler) => {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},
		[handlers],
	);

	const refresh = () => {
		if (refreshing.current) return;
		if (!navigator.onLine) {
			toast.error(
				t(
					"common.refreshDataFailed",
					"Could not refresh data. Please try again.",
				),
			);
			return;
		}
		const href = window.location.href;
		refreshing.current = true;
		startTransition(async () => {
			// Server-owned snapshots are refreshed by the RSC merge below. Stop local
			// retries first so an older GET cannot replace that accepted snapshot.
			await queryClient.cancelQueries({
				predicate: (query) => query.meta?.viewRefresh === "server",
			});
			// Independent owners start together; a slow secondary client/custom read
			// must not postpone server data. A navigation during cancellation wins.
			if (window.location.href === href)
				startTransition(() => router.refresh());
			const clientQueries = queryClient.getQueryCache().findAll({
				type: "active",
				predicate: (query) => query.meta?.viewRefresh !== "server",
			});
			// allSettled keeps pending feedback until every visible source has finished.
			const results = await Promise.allSettled([
				queryClient
					.invalidateQueries(
						{
							refetchType: "active",
							predicate: (query) => query.meta?.viewRefresh !== "server",
						},
						{ cancelRefetch: false },
					)
					.then(() => {
						// Wait for every client sibling, then report failures. Letting the
						// combined refetch reject early would end pending feedback too soon.
						if (clientQueries.some((query) => query.state.status === "error"))
							throw new Error("Client data could not be refreshed");
					}),
				mutate(() => true),
				...Array.from(handlers, (handler) => Promise.resolve().then(handler)),
			]);
			if (
				window.location.href === href &&
				results.some((result) => result.status === "rejected")
			) {
				toast.error(
					t(
						"common.refreshDataFailed",
						"Could not refresh data. Please try again.",
					),
				);
			}
		});
	};

	return (
		<RefreshRegistrationContext value={register}>
			<ViewRefreshContext value={{ refresh, isRefreshing }}>
				{children}
			</ViewRefreshContext>
		</RefreshRegistrationContext>
	);
}

/** Participate when a view loads data outside TanStack Query, SWR, or server props. */
export function useViewRefresh(handler: RefreshHandler) {
	const register = use(RefreshRegistrationContext);
	useEffect(() => register?.(handler), [register, handler]);
}

export function useViewRefreshAction() {
	const context = use(ViewRefreshContext);
	if (!context) throw new Error("ViewRefreshProvider is required");
	return context;
}
