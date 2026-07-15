/* @vitest-environment jsdom */

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWUpdatePrompt } from "./sw-update-prompt";

const originalServiceWorker = navigator.serviceWorker;

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("sonner", () => ({
	toast: Object.assign(
		vi.fn(() => "toast-id"),
		{ dismiss: vi.fn() },
	),
}));

describe("SWUpdatePrompt", () => {
	afterEach(() => {
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: originalServiceWorker,
		});
	});

	it("removes registration and worker listeners on unmount", async () => {
		const workerAddEventListener = vi.fn();
		const workerRemoveEventListener = vi.fn();
		const worker = {
			state: "installing",
			addEventListener: workerAddEventListener,
			removeEventListener: workerRemoveEventListener,
		};
		const registrationAddEventListener = vi.fn();
		const registrationRemoveEventListener = vi.fn();
		const registration = {
			installing: worker,
			waiting: null,
			addEventListener: registrationAddEventListener,
			removeEventListener: registrationRemoveEventListener,
		};
		const serviceWorkerAddEventListener = vi.fn();
		const serviceWorkerRemoveEventListener = vi.fn();
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: {
				ready: Promise.resolve(registration),
				controller: {},
				addEventListener: serviceWorkerAddEventListener,
				removeEventListener: serviceWorkerRemoveEventListener,
			},
		});

		const { unmount } = render(<SWUpdatePrompt />);
		await waitFor(() =>
			expect(registrationAddEventListener).toHaveBeenCalledWith(
				"updatefound",
				expect.any(Function),
			),
		);
		const updateFoundHandler = registrationAddEventListener.mock.calls.find(
			([eventName]) => eventName === "updatefound",
		)?.[1] as (() => void) | undefined;
		expect(updateFoundHandler).toBeDefined();
		act(() => updateFoundHandler?.());
		const stateChangeHandler = workerAddEventListener.mock.calls.find(
			([eventName]) => eventName === "statechange",
		)?.[1];

		unmount();

		expect(registrationRemoveEventListener).toHaveBeenCalledWith("updatefound", updateFoundHandler);
		expect(workerRemoveEventListener).toHaveBeenCalledWith("statechange", stateChangeHandler);
		for (const eventName of ["controllerchange", "message"]) {
			const addedHandler = serviceWorkerAddEventListener.mock.calls.find(
				([name]) => name === eventName,
			)?.[1];
			expect(serviceWorkerRemoveEventListener).toHaveBeenCalledWith(eventName, addedHandler);
		}
	});
});
