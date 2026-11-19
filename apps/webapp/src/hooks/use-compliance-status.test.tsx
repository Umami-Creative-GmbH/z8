/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClockComplianceSnapshot } from "@/lib/compliance/clock-compliance-types";
import { queryKeys } from "@/lib/query/keys";
import { useComplianceStatus } from "./use-compliance-status";

const state = vi.hoisted(() => ({
	organization: {
		userId: "user-a" as string | null,
		activeOrganizationId: "org-a" as string | null,
		employeeId: "employee-a" as string | null,
		isLoading: false,
		error: null as string | null,
	},
	fetch: vi.fn(),
	requestException: vi.fn(async () => ({ success: true, data: "exception-a" })),
	hasValidException: vi.fn(),
}));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => state.organization }));
vi.mock("@/lib/query/clock-compliance-client", () => ({ fetchClockCompliance: state.fetch }));
vi.mock("@/app/[locale]/(app)/settings/compliance/actions", () => ({
	hasValidException: state.hasValidException,
	requestComplianceException: state.requestException,
}));

const clients: QueryClient[] = [];
function wrapper() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity } },
	});
	clients.push(client);
	return {
		client,
		Wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	};
}
function snapshot(mode: "idle" | "active" = "idle"): ClockComplianceSnapshot {
	return {
		scope: { userId: "user-a", organizationId: "org-a", employeeId: "employee-a" },
		mode,
		alerts: [],
		myExceptions: [],
		restPeriod:
			mode === "idle"
				? {
						canClockIn: false,
						enforcement: "block",
						violation: null,
						hasValidException: false,
						minutesUntilAllowed: 20,
					}
				: null,
	};
}

describe("useComplianceStatus clock display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.organization = {
			userId: "user-a",
			activeOrganizationId: "org-a",
			employeeId: "employee-a",
			isLoading: false,
			error: null,
		};
		state.fetch.mockImplementation(async (_scope, mode) => snapshot(mode));
	});
	afterEach(() => {
		clients.splice(0).forEach((client) => client.clear());
	});

	it("uses one GET snapshot for idle notices and never queues read actions", async () => {
		const { Wrapper, client } = wrapper();
		const { result } = renderHook(() => useComplianceStatus(), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.restPeriodEnforcement).toBe("block"));
		expect(result.current.canClockIn).toBe(false);
		expect(state.fetch).toHaveBeenCalledTimes(1);
		expect(state.fetch).toHaveBeenCalledWith(snapshot().scope, "idle", 0, expect.any(AbortSignal));
		expect(client.getQueryCache().getAll()).toHaveLength(1);
	});

	it("waits for a complete actor scope instead of fetching under a shared current key", async () => {
		state.organization.userId = null;
		const { Wrapper } = wrapper();
		const { result } = renderHook(() => useComplianceStatus(), { wrapper: Wrapper });
		await act(async () => {});
		expect(state.fetch).not.toHaveBeenCalled();
		expect(result.current.restPeriodCheck).toBeUndefined();
	});

	it("cancels superseded requests and removes prior-organization display data immediately", async () => {
		const { Wrapper } = wrapper();
		const { result, rerender } = renderHook(() => useComplianceStatus(), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.canClockIn).toBe(false));
		let signal: AbortSignal | undefined;
		state.fetch.mockImplementation((_scope, _mode, _minutes, requestSignal: AbortSignal) => {
			signal = requestSignal;
			return new Promise(() => {});
		});
		void result.current.refreshAll();
		await waitFor(() => expect(signal).toBeDefined());
		state.organization = {
			...state.organization,
			activeOrganizationId: "org-b",
			employeeId: "employee-b",
		};
		rerender();
		expect(result.current.restPeriodCheck).toBeUndefined();
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3));
		// The request for the old scope was consumed and aborted by TanStack Query.
		expect(state.fetch.mock.calls[1][3].aborted).toBe(true);
	});

	it("reuses one active cache entry while polling the latest session minutes", async () => {
		const { Wrapper, client } = wrapper();
		const { rerender } = renderHook(
			({ minutes }) =>
				useComplianceStatus({
					isClockedIn: true,
					currentSessionMinutes: minutes,
					enablePolling: true,
					pollingInterval: 30,
				}),
			{ initialProps: { minutes: 1 }, wrapper: Wrapper },
		);
		await waitFor(() => expect(state.fetch).toHaveBeenCalled());
		rerender({ minutes: 2 });
		await waitFor(() => expect(state.fetch.mock.calls.some((call) => call[2] === 2)).toBe(true));
		expect(client.getQueryCache().getAll()).toHaveLength(1);
	});

	it("rereads rest and exception notices when returning to idle after clock-out", async () => {
		const { Wrapper } = wrapper();
		const { rerender } = renderHook(({ active }) => useComplianceStatus({ isClockedIn: active }), {
			initialProps: { active: false },
			wrapper: Wrapper,
		});
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
		rerender({ active: true });
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
		rerender({ active: false });
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3));
		expect(state.fetch.mock.calls.map((call) => call[1])).toEqual(["idle", "active", "idle"]);
	});

	it("invalidates both display modes only in the actor's scope after an exception request", async () => {
		const { Wrapper, client } = wrapper();
		const idle = queryKeys.compliance.clock("user-a", "org-a", "employee-a", "idle");
		const other = queryKeys.compliance.clock("user-b", "org-b", "employee-b", "idle");
		client.setQueryData(idle, snapshot());
		client.setQueryData(other, snapshot());
		const { result } = renderHook(() => useComplianceStatus({ isClockedIn: true }), {
			wrapper: Wrapper,
		});
		await waitFor(() => expect(result.current.isLoading).toBe(false));
		await act(async () => {
			await result.current.requestException({
				exceptionType: "rest_period",
				reason: "A changed shift",
			});
		});
		expect(client.getQueryState(idle)?.isInvalidated).toBe(true);
		expect(client.getQueryState(other)?.isInvalidated).toBe(false);
	});

	it("keeps the last same-scope rest blocker visible when a refresh fails", async () => {
		const { Wrapper } = wrapper();
		const { result } = renderHook(() => useComplianceStatus(), { wrapper: Wrapper });
		await waitFor(() => expect(result.current.canClockIn).toBe(false));
		state.fetch.mockRejectedValue(new Error("Display temporarily unavailable"));
		await act(async () => {
			await result.current.refreshAll();
		});
		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(result.current.canClockIn).toBe(false);
	});
});
