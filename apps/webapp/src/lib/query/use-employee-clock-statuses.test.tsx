/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getEmployeeClockStatuses: vi.fn(),
}));

vi.mock(
	"@/app/[locale]/(app)/settings/employees/employee-clock-status.actions",
	() => ({
		getEmployeeClockStatuses: mocks.getEmployeeClockStatuses,
	}),
);

import { queryKeys } from "./keys";
import { useEmployeeClockStatuses } from "./use-employee-clock-statuses";

function wrapper(client: QueryClient) {
	return function TestWrapper({ children }: { children: React.ReactNode }) {
		return (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
	};
}

describe("useEmployeeClockStatuses", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("normalizes ids and returns unknown until data is loaded", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		mocks.getEmployeeClockStatuses.mockResolvedValue({
			success: true,
			data: {
				"emp-1": {
					status: "clocked-in",
					lastActivityAt: "2026-07-28T10:30:00.000Z",
					lastActivityUtcOffsetMinutes: 120,
				},
				"emp-2": {
					status: "clocked-out",
					lastActivityAt: null,
					lastActivityUtcOffsetMinutes: null,
				},
			},
		});

		const { result } = renderHook(
			() =>
				useEmployeeClockStatuses(["emp-2", "emp-1", "emp-1", ""], {
					polling: false,
				}),
			{ wrapper: wrapper(client) },
		);

		expect(result.current.getStatus("emp-1")).toBe("unknown");
		expect(result.current.getActivity("emp-1")).toBeNull();

		await waitFor(() =>
			expect(result.current.getStatus(" emp-1 ")).toBe("clocked-in"),
		);
		expect(result.current.getStatus("emp-2")).toBe("clocked-out");
		expect(result.current.statuses).toEqual({
			"emp-1": "clocked-in",
			"emp-2": "clocked-out",
		});
		expect(result.current.snapshots).toEqual({
			"emp-1": {
				status: "clocked-in",
				lastActivityAt: "2026-07-28T10:30:00.000Z",
				lastActivityUtcOffsetMinutes: 120,
			},
			"emp-2": {
				status: "clocked-out",
				lastActivityAt: null,
				lastActivityUtcOffsetMinutes: null,
			},
		});
		expect(result.current.getActivity(" emp-1 ")).toEqual({
			lastActivityAt: "2026-07-28T10:30:00.000Z",
			lastActivityUtcOffsetMinutes: 120,
		});
		expect(result.current.getActivity("emp-2")).toBeNull();
		expect(result.current.getActivity("omitted")).toBeNull();
		expect(result.current.getStatus("omitted")).toBe("unknown");
		expect(mocks.getEmployeeClockStatuses).toHaveBeenCalledWith([
			"emp-1",
			"emp-2",
		]);
	});

	it("uses a stable query key for normalized ids", () => {
		expect(
			queryKeys.employeeClockStatuses.list("org-1", ["emp-2", "emp-1"]),
		).toEqual(["employee-clock-statuses", "org-1", ["emp-1", "emp-2"]]);
	});

	it("keeps statuses unknown when the server action fails", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		mocks.getEmployeeClockStatuses.mockResolvedValue({
			success: false,
			error: "denied",
		});

		const { result } = renderHook(
			() => useEmployeeClockStatuses(["emp-1"], { polling: false }),
			{
				wrapper: wrapper(client),
			},
		);

		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(result.current.getStatus("emp-1")).toBe("unknown");
		expect(result.current.getActivity("emp-1")).toBeNull();
		expect(result.current.snapshots).toEqual({});
		expect(result.current.statuses).toEqual({});
		expect(result.current.error).toEqual(new Error("denied"));
	});

	it("preserves prior presence when a background refresh fails", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		mocks.getEmployeeClockStatuses
			.mockResolvedValueOnce({
				success: true,
				data: {
					"emp-1": {
						status: "clocked-in",
						lastActivityAt: "2026-07-28T10:30:00.000Z",
						lastActivityUtcOffsetMinutes: 120,
					},
				},
			})
			.mockResolvedValueOnce({ success: false, error: "temporary" });

		const { result } = renderHook(
			() => useEmployeeClockStatuses(["emp-1"], { polling: false }),
			{ wrapper: wrapper(client) },
		);

		await waitFor(() =>
			expect(result.current.getStatus("emp-1")).toBe("clocked-in"),
		);
		await act(async () => {
			await result.current.refetch();
		});

		await waitFor(() => expect(result.current.isRefetchError).toBe(true));
		expect(result.current.error).toEqual(new Error("temporary"));
		expect(result.current.getStatus("emp-1")).toBe("clocked-in");
		expect(result.current.getActivity("emp-1")).toEqual({
			lastActivityAt: "2026-07-28T10:30:00.000Z",
			lastActivityUtcOffsetMinutes: 120,
		});
	});
});
