// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentEmployeeMock, listEmployeesMock } = vi.hoisted(() => ({
	getCurrentEmployeeMock: vi.fn(),
	listEmployeesMock: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getCurrentEmployee: getCurrentEmployeeMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	listEmployees: listEmployeesMock,
}));

import { useEmployees } from "./use-employees";

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return createElement(QueryClientProvider, { client }, children);
}

describe("useEmployees directory filters (#1438)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getCurrentEmployeeMock.mockResolvedValue(null);
		listEmployeesMock.mockResolvedValue({
			success: true,
			data: { employees: [], total: 0, hasMore: false },
		});
	});

	it("opens on the current roster", async () => {
		const { result } = renderHook(
			() => useEmployees({ organizationId: "org-1", accessTier: "orgAdmin" }),
			{ wrapper },
		);

		expect(result.current.status).toBe("current");
		await waitFor(() =>
			expect(listEmployeesMock).toHaveBeenCalledWith(
				expect.objectContaining({ status: "current" }),
			),
		);
	});

	it("asks for former employees and for everyone on those filters", async () => {
		const { result } = renderHook(
			() => useEmployees({ organizationId: "org-1", accessTier: "orgAdmin" }),
			{ wrapper },
		);

		act(() => result.current.setStatus("former"));
		await waitFor(() =>
			expect(listEmployeesMock).toHaveBeenCalledWith(expect.objectContaining({ status: "former" })),
		);

		act(() => result.current.setStatus("all"));
		await waitFor(() =>
			expect(listEmployeesMock).toHaveBeenLastCalledWith(
				expect.objectContaining({ status: undefined }),
			),
		);
	});
});
