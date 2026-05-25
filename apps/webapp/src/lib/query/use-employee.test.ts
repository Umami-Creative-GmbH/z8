// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { queryKeys } from "./keys";
import type { useEmployee } from "./use-employee";

const {
	cancelEmploymentHistoryMock,
	confirmEmploymentHistoryMock,
	createEmploymentHistoryMock,
	getCurrentEmployeeMock,
	getEmployeeMock,
	getRateHistoryMock,
	listEmployeesForSelectMock,
	listEmploymentHistoryMock,
	requestWorkBalanceRecalculationMock,
	updateEmployeeMock,
	updateRateMock,
	getScheduleMock,
} = vi.hoisted(() => ({
	cancelEmploymentHistoryMock: vi.fn(),
	confirmEmploymentHistoryMock: vi.fn(),
	createEmploymentHistoryMock: vi.fn(),
	getCurrentEmployeeMock: vi.fn(),
	getEmployeeMock: vi.fn(),
	getRateHistoryMock: vi.fn(),
	listEmployeesForSelectMock: vi.fn(),
	listEmploymentHistoryMock: vi.fn(),
	requestWorkBalanceRecalculationMock: vi.fn(),
	updateEmployeeMock: vi.fn(),
	updateRateMock: vi.fn(),
	getScheduleMock: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getCurrentEmployee: getCurrentEmployeeMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	getEmployee: getEmployeeMock,
	listEmployeesForSelect: listEmployeesForSelectMock,
	requestEmployeeWorkBalanceRecalculation: requestWorkBalanceRecalculationMock,
	updateEmployee: updateEmployeeMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/employment-history-client-actions", () => ({
	cancelEmployeeEmploymentHistoryAction: cancelEmploymentHistoryMock,
	confirmEmployeeEmploymentHistoryAction: confirmEmploymentHistoryMock,
	createEmployeeEmploymentHistoryAction: createEmploymentHistoryMock,
	listEmployeeEmploymentHistoryAction: listEmploymentHistoryMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/rate-actions", () => ({
	createRateHistoryEntry: updateRateMock,
	getEmployeeRateHistory: getRateHistoryMock,
}));

vi.mock("@/app/[locale]/(app)/settings/work-policies/actions", () => ({
	getEmployeeEffectiveScheduleDetails: getScheduleMock,
}));

import { useEmployee as useEmployeeHook } from "./use-employee";

const employeeId = "employee-1";

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return createElement(QueryClientProvider, { client: queryClient }, children);
	};
}

function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

function renderUseEmployee(queryClient: QueryClient) {
	return renderHook(() => useEmployeeHook({ employeeId, enabled: false, accessTier: "orgAdmin" }), {
		wrapper: createWrapper(queryClient),
	});
}

function expectEmploymentHistoryInvalidated(invalidateQueriesSpy: ReturnType<typeof vi.spyOn>) {
	expect(invalidateQueriesSpy).toHaveBeenCalledWith({
		queryKey: queryKeys.employees.employmentHistory(employeeId),
	});
	expect(invalidateQueriesSpy).toHaveBeenCalledWith({
		queryKey: queryKeys.employees.detail(employeeId),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	getCurrentEmployeeMock.mockResolvedValue(null);
	getEmployeeMock.mockResolvedValue({ success: true, data: null });
	getScheduleMock.mockResolvedValue({ success: true, data: null });
	listEmployeesForSelectMock.mockResolvedValue({ success: true, data: { employees: [] } });
	getRateHistoryMock.mockResolvedValue({ success: true, data: [] });
	listEmploymentHistoryMock.mockResolvedValue({ success: true, data: [] });
	requestWorkBalanceRecalculationMock.mockResolvedValue({ success: true, data: null });
	updateEmployeeMock.mockResolvedValue({ success: true, data: null });
	updateRateMock.mockResolvedValue({ success: true, data: null });
});

describe("useEmployee contracts", () => {
	it("exposes a stable employment history query key", () => {
		expect(queryKeys.employees.employmentHistory("employee-1")).toEqual([
			"employees",
			"detail",
			"employee-1",
			"employment-history",
		]);
	});

	it("returns employment history query and mutation helpers", () => {
		type UseEmployeeResult = ReturnType<typeof useEmployee>;

		expectTypeOf<UseEmployeeResult>().toHaveProperty("employmentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isLoadingEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("createEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isCreatingEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("confirmEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isConfirmingEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("cancelEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isCancelingEmploymentHistory");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("requestWorkBalanceRecalculation");
		expectTypeOf<UseEmployeeResult>().toHaveProperty("isRequestingWorkBalanceRecalculation");
	});

	it("invalidates employment history and employee detail after successful create", async () => {
		createEmploymentHistoryMock.mockResolvedValue({ success: true, data: { id: "history-1" } });
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderUseEmployee(queryClient);

		await act(async () => {
			await result.current.createEmploymentHistory({
				validFrom: new Date("2026-01-01T00:00:00.000Z"),
				status: "active",
				contractType: "fixed",
				weeklyContractMinutes: 2400,
				workModel: "onsite",
				reviewState: "draft",
			});
		});

		expect(createEmploymentHistoryMock).toHaveBeenCalledWith(employeeId, expect.any(Object));
		expectEmploymentHistoryInvalidated(invalidateQueriesSpy);
	});

	it("invalidates employment history and employee detail after successful confirm", async () => {
		confirmEmploymentHistoryMock.mockResolvedValue({ success: true, data: { id: "history-1" } });
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderUseEmployee(queryClient);

		await act(async () => {
			await result.current.confirmEmploymentHistory("history-1");
		});

		expect(confirmEmploymentHistoryMock).toHaveBeenCalledWith(employeeId, "history-1");
		expectEmploymentHistoryInvalidated(invalidateQueriesSpy);
	});

	it("invalidates employment history and employee detail after successful cancel", async () => {
		cancelEmploymentHistoryMock.mockResolvedValue({ success: true });
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderUseEmployee(queryClient);

		await act(async () => {
			await result.current.cancelEmploymentHistory("history-1");
		});

		expect(cancelEmploymentHistoryMock).toHaveBeenCalledWith(employeeId, "history-1");
		expectEmploymentHistoryInvalidated(invalidateQueriesSpy);
	});

	it("invalidates employee detail after successful work balance recalculation request", async () => {
		requestWorkBalanceRecalculationMock.mockResolvedValue({ success: true });
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderUseEmployee(queryClient);

		await act(async () => {
			await result.current.requestWorkBalanceRecalculation();
		});

		expect(requestWorkBalanceRecalculationMock).toHaveBeenCalledWith(employeeId);
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: queryKeys.employees.detail(employeeId),
		});
	});

	it("does not invalidate employment history when create returns a failed result", async () => {
		createEmploymentHistoryMock.mockResolvedValue({ success: false, error: "Not allowed" });
		const queryClient = createTestQueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderUseEmployee(queryClient);

		await act(async () => {
			await result.current.createEmploymentHistory({
				validFrom: new Date("2026-01-01T00:00:00.000Z"),
				status: "active",
				contractType: "fixed",
				weeklyContractMinutes: 2400,
				workModel: "onsite",
				reviewState: "draft",
			});
		});

		expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
			queryKey: queryKeys.employees.employmentHistory(employeeId),
		});
		expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
			queryKey: queryKeys.employees.detail(employeeId),
		});
	});
});
