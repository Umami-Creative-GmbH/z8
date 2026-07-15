"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import {
	SOCIAL_PROVIDERS,
	type SocialProvider,
	type SocialProviderId,
} from "@/lib/social-providers";

interface UseEnabledProvidersReturn {
	/** List of enabled social providers */
	enabledProviders: SocialProvider[];
	/** Loading state */
	isLoading: boolean;
	/** Error state */
	error: Error | null;
}

/**
 * React hook to fetch and cache enabled social OAuth providers
 *
 * Fetches the list of enabled providers from the API endpoint and keeps a
 * short-lived shared query cache so login and signup stay in sync.
 *
 * @returns Object with enabledProviders array, loading state, and error state
 *
 * @example
 * ```tsx
 * function LoginForm() {
 *   const { enabledProviders, isLoading } = useEnabledProviders();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *
 *   return (
 *     <div>
 *       {enabledProviders.map(provider => (
 *         <button key={provider.id} onClick={() => login(provider.id)}>
 *           <provider.icon /> {provider.name}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useEnabledProviders(): UseEnabledProvidersReturn {
	const providersQuery = useQuery({
		queryKey: queryKeys.auth.providers(),
		queryFn: async ({ signal }) => {
			const response = await fetch("/api/auth/providers", { signal });
			if (!response.ok) {
				throw new Error(`Failed to fetch providers: ${response.statusText}`);
			}

			const data = (await response.json()) as {
				providers?: SocialProviderId[];
			};
			const enabledIds = new Set(data.providers ?? []);
			return SOCIAL_PROVIDERS.filter((provider) => enabledIds.has(provider.id));
		},
		staleTime: 5 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		refetchOnWindowFocus: true,
	});

	return {
		enabledProviders: providersQuery.data ?? [],
		isLoading: providersQuery.isLoading,
		error: providersQuery.error instanceof Error ? providersQuery.error : null,
	};
}
