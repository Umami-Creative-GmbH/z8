// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentEmployeeMock, listEmployeesMock } = vi.hoisted(() => ({
	getCurrentEmployeeMock: vi.fn(),
	listEmployeesMock: vi.fn(),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({
		userId: "user-1",
		activeOrganizationId: "org-1",
		organizationId: "org-1",
		employeeId: null,
		isLoading: false,
		error: null,
	}),
}));
const fetchMock = vi.fn();

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getCurrentEmployee: getCurrentEmployeeMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	listEmployees: listEmployeesMock,
}));

import { useEmployees } from "./use-employees";

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return createElement(QueryClientProvider, { client }, children);
}

describe("useEmployees directory filters (#1438)", () => {
	afterEach(() => vi.unstubAllGlobals());
	beforeEach(() => {
		vi.clearAllMocks();
		getCurrentEmployeeMock.mockResolvedValue(null);
		listEmployeesMock.mockResolvedValue({
			success: true,
			data: { employees: [], total: 0, hasMore: false },
		});
		fetchMock.mockImplementation(async () =>
			Response.json({
				scope: { userId: "user-1", organizationId: "org-1" },
				data: { employees: [], total: 0, hasMore: false },
				updatedAt: Date.now(),
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
	});

	it("opens on the current roster", async () => {
		const { result } = renderHook(
			() => useEmployees({ organizationId: "org-1", accessTier: "orgAdmin" }),
			{ wrapper },
		);

		expect(result.current.status).toBe("current");
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(
			new URL(fetchMock.mock.lastCall![0], "http://localhost").searchParams.get(
				"status",
			),
		).toBe("current");
	});

	it("asks for former employees and for everyone on those filters", async () => {
		const { result } = renderHook(
			() => useEmployees({ organizationId: "org-1", accessTier: "orgAdmin" }),
			{ wrapper },
		);

		act(() => result.current.setStatus("former"));
		await waitFor(() =>
			expect(
				new URL(
					fetchMock.mock.lastCall![0],
					"http://localhost",
				).searchParams.get("status"),
			).toBe("former"),
		);

		act(() => result.current.setStatus("all"));
		await waitFor(() =>
			expect(
				new URL(
					fetchMock.mock.lastCall![0],
					"http://localhost",
				).searchParams.get("status"),
			).toBeNull(),
		);
	});
});
