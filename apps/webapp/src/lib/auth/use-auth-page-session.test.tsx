/* @vitest-environment jsdom */

import {
	focusManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./auth-page-client", () => ({ authPageClient: { getSession } }));

import { useAuthPageSession } from "./use-auth-page-session";

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useAuthPageSession", () => {
	beforeEach(() => getSession.mockReset());
	afterEach(() => focusManager.setFocused(undefined));
	it("can refresh account scope on return to a long-lived join page", async () => {
		const first = { user: { id: "first", email: "first@example.test" } };
		const second = { user: { id: "second", email: "second@example.test" } };
		getSession
			.mockResolvedValueOnce({ data: first })
			.mockResolvedValueOnce({ data: second });
		const { result } = renderHook(
			() => useAuthPageSession({ refetchOnWindowFocus: true }),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.data).toEqual(first));
		await act(async () => {
			focusManager.setFocused(false);
			focusManager.setFocused(true);
		});
		await waitFor(() => expect(result.current.data).toEqual(second));
		focusManager.setFocused(undefined);
	});
	it("reads the session through the lazily loaded auth page client", async () => {
		const session = { user: { email: "person@example.com" } };
		getSession.mockResolvedValueOnce({ data: session, error: null });

		const { result } = renderHook(() => useAuthPageSession(), { wrapper });

		expect(result.current).toEqual({ data: null, isPending: true });
		await waitFor(() =>
			expect(result.current).toEqual({ data: session, isPending: false }),
		);
	});

	it("reports a signed-out visitor as no session", async () => {
		getSession.mockResolvedValueOnce({ data: null, error: null });

		const { result } = renderHook(() => useAuthPageSession(), { wrapper });

		await waitFor(() =>
			expect(result.current).toEqual({ data: null, isPending: false }),
		);
	});
});
