"use client";

import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { isUnauthorizedError } from "@/lib/fetch";

interface QueryProviderProps {
	children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
	const router = useRouter();

	const [queryClient] = useState(
		() =>
			new QueryClient({
				queryCache: new QueryCache({
					onError: (error) => {
						if (isUnauthorizedError(error)) {
							router.replace("/sign-in");
						}
					},
				}),
				defaultOptions: {
					queries: {
						// With SSR, we usually want to set some default staleTime
						// above 0 to avoid refetching immediately on the client
						staleTime: 60 * 1000, // 1 minute
						refetchOnWindowFocus: false,
						// Don't retry on auth errors
						retry: (failureCount, error) => {
							if (isUnauthorizedError(error)) {
								return false;
							}
							return failureCount < 3;
						},
					},
					mutations: {
						// Retry failed mutations once, but not auth errors
						retry: (failureCount, error) => {
							if (isUnauthorizedError(error)) {
								return false;
							}
							return failureCount < 1;
						},
						onError: (error) => {
							if (isUnauthorizedError(error)) {
								router.replace("/sign-in");
							}
						},
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>
			{children}
			<ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
		</QueryClientProvider>
	);
}
