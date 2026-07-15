/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import { useEnabledProviders } from "./use-enabled-providers";

const originalFetch = globalThis.fetch;

function createQueryHarness() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return {
		queryClient,
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	};
}

describe("useEnabledProviders", () => {
	afterEach(() => {
		Object.defineProperty(globalThis, "fetch", {
			configurable: true,
			value: originalFetch,
		});
	});

	it("shares provider configuration through the query cache", async () => {
		Object.defineProperty(globalThis, "fetch", {
			configurable: true,
			value: vi
				.fn()
				.mockResolvedValue(new Response(JSON.stringify({ providers: ["github", "google"] }))),
		});
		const { wrapper } = createQueryHarness();

		const { result } = renderHook(() => [useEnabledProviders(), useEnabledProviders()] as const, {
			wrapper,
		});

		await waitFor(() =>
			expect(result.current[0].enabledProviders.map(({ id }) => id)).toEqual(["google", "github"]),
		);
		expect(result.current[1].enabledProviders.map(({ id }) => id)).toEqual(["google", "github"]);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("refreshes cached provider configuration after invalidation", async () => {
		Object.defineProperty(globalThis, "fetch", {
			configurable: true,
			value: vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ providers: ["google"] })))
				.mockResolvedValueOnce(new Response(JSON.stringify({ providers: ["apple"] }))),
		});
		const { queryClient, wrapper } = createQueryHarness();
		const { result } = renderHook(() => useEnabledProviders(), { wrapper });
		await waitFor(() => expect(result.current.enabledProviders[0]?.id).toBe("google"));

		await queryClient.invalidateQueries({
			queryKey: queryKeys.auth.providers(),
		});

		await waitFor(() => expect(result.current.enabledProviders[0]?.id).toBe("apple"));
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
