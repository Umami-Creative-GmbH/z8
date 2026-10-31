/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./auth-page-client", () => ({ authPageClient: { getSession } }));

import { useAuthPageSession } from "./use-auth-page-session";

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAuthPageSession", () => {
	it("reads the session through the lazily loaded auth page client", async () => {
		const session = { user: { email: "person@example.com" } };
		getSession.mockResolvedValueOnce({ data: session, error: null });

		const { result } = renderHook(() => useAuthPageSession(), { wrapper });

		expect(result.current).toEqual({ data: null, isPending: true });
		await waitFor(() => expect(result.current).toEqual({ data: session, isPending: false }));
	});

	it("reports a signed-out visitor as no session", async () => {
		getSession.mockResolvedValueOnce({ data: null, error: null });

		const { result } = renderHook(() => useAuthPageSession(), { wrapper });

		await waitFor(() => expect(result.current).toEqual({ data: null, isPending: false }));
	});
});
