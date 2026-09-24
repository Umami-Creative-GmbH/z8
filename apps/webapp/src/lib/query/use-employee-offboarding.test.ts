// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "./keys";

const actions = vi.hoisted(() => ({
	getEmployeeOffboardingViewAction: vi.fn(),
	previewEmployeeDepartureAction: vi.fn(),
	scheduleEmployeeDepartureAction: vi.fn(),
	cancelEmployeeDepartureAction: vi.fn(),
	offboardEmployeeNowAction: vi.fn(),
	rehireEmployeeAction: vi.fn(),
	resolveDepartureReviewAction: vi.fn(),
	retryDepartureTaskAction: vi.fn(),
	assignDepartureReplacementAction: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/employees/employee-offboarding.actions", () => actions);

import {
	createRequestIdentity,
	useDeparturePreview,
	useEmployeeOffboarding,
} from "./use-employee-offboarding";

const employeeId = "11111111-1111-4111-8111-111111111111";

function setup() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidate = vi.spyOn(queryClient, "invalidateQueries");
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client: queryClient }, children);
	return { queryClient, invalidate, wrapper };
}

describe("createRequestIdentity", () => {
	it("reuses the request id for an unchanged retry and renews it for changed intent", () => {
		let counter = 0;
		const identity = createRequestIdentity(() => `request-${++counter}`);

		const first = identity.forPayload({ employeeId, lastWorkingDay: "2026-09-30" });
		expect(identity.forPayload({ lastWorkingDay: "2026-09-30", employeeId })).toBe(first);
		const changed = identity.forPayload({ employeeId, lastWorkingDay: "2026-10-01" });
		expect(changed).not.toBe(first);
		identity.complete();
		expect(identity.forPayload({ employeeId, lastWorkingDay: "2026-10-01" })).not.toBe(changed);
	});
});

describe("useEmployeeOffboarding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.getEmployeeOffboardingViewAction.mockResolvedValue({
			success: true,
			data: { employeeId, state: "scheduled" },
		});
	});

	it("loads the focused lifecycle view under the organization-scoped key", async () => {
		const { wrapper, queryClient } = setup();

		const { result } = renderHook(
			() => useEmployeeOffboarding({ organizationId: "org-1", employeeId }),
			{ wrapper },
		);

		await waitFor(() => expect(result.current.view).toMatchObject({ state: "scheduled" }));
		expect(actions.getEmployeeOffboardingViewAction).toHaveBeenCalledWith({ employeeId });
		expect(queryClient.getQueryData(queryKeys.employees.offboarding("org-1", employeeId))).toEqual({
			employeeId,
			state: "scheduled",
		});
	});

	it("refreshes every dependent view after a successful transition, never optimistically", async () => {
		const { wrapper, invalidate, queryClient } = setup();
		actions.offboardEmployeeNowAction.mockResolvedValue({
			success: true,
			data: { status: "effective" },
		});
		const { result } = renderHook(
			() => useEmployeeOffboarding({ organizationId: "org-1", employeeId }),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.view).not.toBeNull());

		await act(() =>
			result.current.offboardNow({
				employeeId,
				requestId: employeeId,
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			}),
		);

		const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
		expect(keys).toEqual(
			expect.arrayContaining([
				queryKeys.employees.offboarding("org-1", employeeId),
				queryKeys.employees.detail(employeeId),
				queryKeys.employees.organization("org-1"),
				["calendar", "employees"],
				["billing"],
			]),
		);
		expect(queryClient.getQueryData(queryKeys.employees.offboarding("org-1", employeeId))).toEqual(
			expect.objectContaining({ state: "scheduled" }),
		);
	});

	it("only refreshes the lifecycle view after a rejected command and returns the guidance", async () => {
		const { wrapper, invalidate } = setup();
		actions.scheduleEmployeeDepartureAction.mockResolvedValue({
			success: false,
			error: "This departure has already taken effect. Rehire the employee to restore access.",
		});
		const { result } = renderHook(
			() => useEmployeeOffboarding({ organizationId: "org-1", employeeId }),
			{ wrapper },
		);

		let outcome: unknown;
		await act(async () => {
			outcome = await result.current.scheduleDeparture({});
		});

		expect(outcome).toMatchObject({ success: false });
		expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
			queryKeys.employees.offboarding("org-1", employeeId),
		]);
	});
});

describe("useDeparturePreview", () => {
	it("waits until enabled and keys the preview by the last working day", async () => {
		actions.previewEmployeeDepartureAction.mockResolvedValue({
			success: true,
			data: { cutoff: "2026-09-30T22:00:00Z", timezone: "Europe/Berlin" },
		});
		const { wrapper } = setup();
		const { result, rerender } = renderHook(
			({ enabled }) =>
				useDeparturePreview({
					organizationId: "org-1",
					employeeId,
					lastWorkingDay: "2026-09-30",
					enabled,
				}),
			{ wrapper, initialProps: { enabled: false } },
		);
		expect(actions.previewEmployeeDepartureAction).not.toHaveBeenCalled();

		rerender({ enabled: true });

		await waitFor(() => expect(result.current.data).toMatchObject({ timezone: "Europe/Berlin" }));
		expect(actions.previewEmployeeDepartureAction).toHaveBeenCalledWith({
			employeeId,
			lastWorkingDay: "2026-09-30",
		});
	});
});
