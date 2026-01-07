"use client";

import { useEffect, useState } from "react";
import { SOCIAL_PROVIDERS, type SocialProvider, type SocialProviderId } from "@/lib/social-providers";

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
 * Fetches the list of enabled providers from the API endpoint and caches
 * the result in sessionStorage for performance. The cache is cleared when
 * the browser session ends.
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
	const [enabledProviders, setEnabledProviders] = useState<SocialProvider[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		const fetchEnabledProviders = async () => {
			try {
				// Check sessionStorage cache first
				const cached = sessionStorage.getItem("enabled-providers");
				if (cached) {
					try {
						const ids = JSON.parse(cached) as SocialProviderId[];
						setEnabledProviders(SOCIAL_PROVIDERS.filter((p) => ids.includes(p.id)));
						setIsLoading(false);
						return;
					} catch (e) {
						// Invalid cache, continue to fetch
						sessionStorage.removeItem("enabled-providers");
					}
				}

				// Fetch from API
				const response = await fetch("/api/auth/providers");

				if (!response.ok) {
					throw new Error(`Failed to fetch providers: ${response.statusText}`);
				}

				const data = await response.json();
				const ids = data.providers as SocialProviderId[];

				// Cache the provider IDs
				sessionStorage.setItem("enabled-providers", JSON.stringify(ids));

				// Filter SOCIAL_PROVIDERS to only include enabled ones
				setEnabledProviders(SOCIAL_PROVIDERS.filter((p) => ids.includes(p.id)));
			} catch (err) {
				console.error("Error fetching enabled providers:", err);
				setError(err instanceof Error ? err : new Error("Unknown error"));
				// Fallback to empty array on error
				setEnabledProviders([]);
			} finally {
				setIsLoading(false);
			}
		};

		fetchEnabledProviders();
	}, []);

	return { enabledProviders, isLoading, error };
}
