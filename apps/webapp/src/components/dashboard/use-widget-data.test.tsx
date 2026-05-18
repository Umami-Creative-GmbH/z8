/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWidgetData } from "./use-widget-data";

const { toastErrorMock } = vi.hoisted(() => ({
	toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { error: toastErrorMock },
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ organizationId: "org-1" }),
}));

describe("useWidgetData", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not show a load failure toast after the widget unmounts", async () => {
		let rejectLoad: (error: Error) => void = () => {};
		const fetcher = vi.fn(
			() =>
				new Promise<{ success: boolean }>((_resolve, reject) => {
					rejectLoad = reject;
				}),
		);

		const { unmount } = renderHook(() =>
			useWidgetData(fetcher, { errorMessage: "Failed to load quick stats" }),
		);

		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		unmount();

		await act(async () => {
			rejectLoad(new Error("Route changed before the widget finished loading"));
		});

		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("does not show a load failure toast when navigation aborts the widget load", async () => {
		const fetcher = vi.fn().mockRejectedValue(new DOMException("Route changed", "AbortError"));

		renderHook(() => useWidgetData(fetcher, { errorMessage: "Failed to load quick stats" }));

		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("shows a load failure toast while the widget is still mounted", async () => {
		const fetcher = vi.fn().mockRejectedValue(new Error("Network failed"));

		renderHook(() => useWidgetData(fetcher, { errorMessage: "Failed to load quick stats" }));

		await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Failed to load quick stats"));
	});
});
