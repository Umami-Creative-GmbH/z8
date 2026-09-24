"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useTolgee } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	createServerActionSkewHandler,
	isServerActionVersionSkewError,
} from "@/components/deployment-refresh/server-action-skew";
import { isUnauthorizedError } from "@/lib/fetch";

interface QueryProviderProps {
	children: ReactNode;
}

// Neither auth failures nor calls into a replaced deployment succeed on retry.
function isRetryable(error: unknown) {
	return !isUnauthorizedError(error) && !isServerActionVersionSkewError(error);
}

export function QueryProvider({ children }: QueryProviderProps) {
	const router = useRouter();
	// Stable instance; translating at notify time picks up the current language.
	const tolgee = useTolgee();

	const [handleSkewError] = useState(() =>
		createServerActionSkewHandler(() => {
			toast(tolgee.t("common.deployment.skew.title", "Z8 was updated"), {
				description: tolgee.t(
					"common.deployment.skew.description",
					"Reload the page to continue. Your last action was not saved.",
				),
				duration: Infinity,
				action: {
					label: tolgee.t("common.sw.update.reload", "Reload"),
					onClick: () => window.location.reload(),
				},
			});
		}),
	);

	const [queryClient] = useState(() => {
		const handleError = (error: unknown) => {
			if (handleSkewError(error)) return;
			if (isUnauthorizedError(error)) {
				router.replace("/sign-in");
			}
		};

		return new QueryClient({
			queryCache: new QueryCache({ onError: handleError }),
			mutationCache: new MutationCache({ onError: handleError }),
			defaultOptions: {
				queries: {
					// With SSR, we usually want to set some default staleTime
					// above 0 to avoid refetching immediately on the client
					staleTime: 60 * 1000, // 1 minute
					refetchOnWindowFocus: false,
					retry: (failureCount, error) => isRetryable(error) && failureCount < 3,
				},
				mutations: {
					// Retry failed mutations once
					retry: (failureCount, error) => isRetryable(error) && failureCount < 1,
				},
			},
		});
	});

	// Server actions called outside TanStack Query surface here when unhandled.
	useEffect(() => {
		const handleRejection = (event: PromiseRejectionEvent) => {
			handleSkewError(event.reason);
		};
		window.addEventListener("unhandledrejection", handleRejection);
		return () => window.removeEventListener("unhandledrejection", handleRejection);
	}, [handleSkewError]);

	return (
		<QueryClientProvider client={queryClient}>
			{children}
			<ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
		</QueryClientProvider>
	);
}
