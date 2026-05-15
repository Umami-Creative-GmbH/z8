/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentEmployeeMock, getEmployeesByIdsMock, listEmployeesForSelectMock, presenceMock } =
	vi.hoisted(() => ({
		getCurrentEmployeeMock: vi.fn(),
		getEmployeesByIdsMock: vi.fn(),
		listEmployeesForSelectMock: vi.fn(),
		presenceMock: vi.fn(),
	}));

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getCurrentEmployee: getCurrentEmployeeMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	getEmployeesByIds: getEmployeesByIdsMock,
	listEmployeesForSelect: listEmployeesForSelectMock,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: presenceMock,
}));

import { useEmployeeSelect, useSelectedEmployees } from "./use-employee-select";

const employee = {
	id: "emp_1",
	userId: "user_1",
	firstName: "Ada",
	lastName: "Lovelace",
	pronouns: null,
	position: "Engineer",
	role: "employee" as const,
	isActive: true,
	teamId: null,
	user: {
		id: "user_1",
		firstName: "Ada",
		lastName: "Lovelace",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
	},
	team: null,
};

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});

	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

describe("useEmployeeSelect", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getCurrentEmployeeMock.mockResolvedValue({ id: "current-employee", organizationId: "org_1" });
		presenceMock.mockReturnValue({ getStatus: (employeeId: string) => `${employeeId}:status` });
	});

	it("enriches result employees with clock status", async () => {
		listEmployeesForSelectMock.mockResolvedValue({
			success: true,
			data: { employees: [employee], total: 1, hasMore: false },
		});

		const { result } = renderHook(() => useEmployeeSelect(), { wrapper: createWrapper() });

		await waitFor(() => expect(result.current.employees).toHaveLength(1));
		expect(result.current.employees[0].clockStatus).toBe("emp_1:status");
		expect(presenceMock).toHaveBeenCalledWith(["emp_1"], { polling: false });
	});

	it("enriches selected employees with clock status", async () => {
		getEmployeesByIdsMock.mockResolvedValue({ success: true, data: [employee] });

		const { result } = renderHook(() => useSelectedEmployees(["emp_1"]), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.employees).toHaveLength(1));
		expect(result.current.employees[0].clockStatus).toBe("emp_1:status");
		expect(presenceMock).toHaveBeenCalledWith(["emp_1"], { polling: false });
	});
});
