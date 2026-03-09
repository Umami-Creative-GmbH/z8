// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishShiftsMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
	publishShiftsMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	publishShifts: publishShiftsMock,
}));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccessMock,
		error: toastErrorMock,
	},
}));

import { getPendingPublishAcknowledgment } from "@/components/scheduling/scheduler/shift-publish-flow-utils";
import { useShiftPublishFlow } from "@/components/scheduling/scheduler/use-shift-publish-flow";

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return createElement(QueryClientProvider, { client: queryClient }, children);
	};
}

const dateRange = {
	start: new Date("2026-03-08T00:00:00.000Z"),
	end: new Date("2026-03-14T23:59:59.999Z"),
};

beforeEach(() => {
	publishShiftsMock.mockReset();
	toastSuccessMock.mockReset();
	toastErrorMock.mockReset();
});

describe("getPendingPublishAcknowledgment", () => {
	it("returns the pending acknowledgment payload when publish requires acknowledgment", () => {
		expect(
			getPendingPublishAcknowledgment({
				published: false,
				requiresAcknowledgment: true,
				count: 0,
				complianceSummary: {
					totalFindings: 2,
					byType: {
						restTime: 1,
						maxHours: 1,
						overtime: 0,
					},
				},
				evaluationFingerprint: "fingerprint-123",
			}),
		).toEqual({
			published: false,
			requiresAcknowledgment: true,
			count: 0,
			complianceSummary: {
				totalFindings: 2,
				byType: {
					restTime: 1,
					maxHours: 1,
					overtime: 0,
				},
			},
			evaluationFingerprint: "fingerprint-123",
		});
	});

	it("returns null for direct publish success", () => {
		expect(
			getPendingPublishAcknowledgment({
				published: true,
				requiresAcknowledgment: false,
				count: 3,
			}),
		).toBeNull();
	});

	it("returns null when required payload is missing", () => {
		expect(
			getPendingPublishAcknowledgment({
				published: false,
				requiresAcknowledgment: true,
				count: 0,
				complianceSummary: {
					totalFindings: 0,
					byType: {
						restTime: 0,
						maxHours: 0,
						overtime: 0,
					},
				},
				evaluationFingerprint: "",
			}),
		).toBeNull();
	});
});

describe("useShiftPublishFlow", () => {
	it("opens the dialog with pending acknowledgment when publish requires acknowledgment", async () => {
		publishShiftsMock.mockResolvedValueOnce({
			success: true,
			data: {
				published: false,
				requiresAcknowledgment: true,
				count: 0,
				complianceSummary: {
					totalFindings: 1,
					byType: { restTime: 1, maxHours: 0, overtime: 0 },
				},
				evaluationFingerprint: "fp-123",
			},
		});

		const queryClient = new QueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(
			() => useShiftPublishFlow({ organizationId: "org-1", dateRange }),
			{ wrapper: createWrapper(queryClient) },
		);

		act(() => {
			result.current.publish();
		});

		await waitFor(() => {
			expect(result.current.isComplianceDialogOpen).toBe(true);
		});

		expect(result.current.pendingAcknowledgment?.evaluationFingerprint).toBe("fp-123");
		expect(invalidateQueriesSpy).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();

		act(() => {
			result.current.setIsComplianceDialogOpen(false);
		});

		expect(result.current.isComplianceDialogOpen).toBe(false);
	});

	it("reuses the pending fingerprint when confirmPublish is called", async () => {
		publishShiftsMock
			.mockResolvedValueOnce({
				success: true,
				data: {
					published: false,
					requiresAcknowledgment: true,
					count: 0,
					complianceSummary: {
						totalFindings: 2,
						byType: { restTime: 1, maxHours: 1, overtime: 0 },
					},
					evaluationFingerprint: "fp-confirm",
				},
			})
			.mockResolvedValueOnce({
				success: true,
				data: {
					published: true,
					requiresAcknowledgment: false,
					count: 4,
				},
			});

		const queryClient = new QueryClient();
		const { result } = renderHook(
			() => useShiftPublishFlow({ organizationId: "org-1", dateRange }),
			{ wrapper: createWrapper(queryClient) },
		);

		act(() => {
			result.current.publish();
		});

		await waitFor(() => {
			expect(result.current.pendingAcknowledgment?.evaluationFingerprint).toBe("fp-confirm");
		});

		act(() => {
			result.current.confirmPublish();
		});

		await waitFor(() => {
			expect(publishShiftsMock).toHaveBeenNthCalledWith(2, dateRange, {
				evaluationFingerprint: "fp-confirm",
			});
		});
	});

	it("invalidates queries and shows success toast after direct publish success", async () => {
		publishShiftsMock.mockResolvedValueOnce({
			success: true,
			data: {
				published: true,
				requiresAcknowledgment: false,
				count: 3,
			},
		});

		const queryClient = new QueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(
			() => useShiftPublishFlow({ organizationId: "org-1", dateRange }),
			{ wrapper: createWrapper(queryClient) },
		);

		act(() => {
			result.current.publish();
		});

		await waitFor(() => {
			expect(toastSuccessMock).toHaveBeenCalledWith("Published 3 shift(s)");
		});

		expect(result.current.pendingAcknowledgment).toBeNull();
		expect(result.current.isComplianceDialogOpen).toBe(false);
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["shifts"] });
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: ["compliance", "schedule-warnings", "org-1", dateRange],
		});
	});

	it("shows an error toast when publish fails", async () => {
		publishShiftsMock.mockResolvedValueOnce({
			success: false,
			error: "Publish failed badly",
		});

		const queryClient = new QueryClient();
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(
			() => useShiftPublishFlow({ organizationId: "org-1", dateRange }),
			{ wrapper: createWrapper(queryClient) },
		);

		act(() => {
			result.current.publish();
		});

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Failed to publish shifts", {
				description: "Publish failed badly",
			});
		});

		expect(invalidateQueriesSpy).not.toHaveBeenCalled();
	});
});
