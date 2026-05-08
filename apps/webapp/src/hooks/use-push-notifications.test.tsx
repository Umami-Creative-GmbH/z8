/* @vitest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePushNotifications } from "./use-push-notifications";

const originalFetch = globalThis.fetch;
const originalNotification = globalThis.Notification;
const originalPushManager = globalThis.PushManager;
const originalServiceWorker = navigator.serviceWorker;

describe("usePushNotifications", () => {
	const registerMock = vi.fn();
	const requestPermissionMock = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();

		Object.defineProperty(globalThis, "fetch", {
			configurable: true,
			value: vi.fn(),
		});

		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "default",
				requestPermission: requestPermissionMock,
			},
		});

		Object.defineProperty(globalThis, "PushManager", {
			configurable: true,
			value: function PushManager() {},
		});

		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: {
				register: registerMock,
			},
		});

		registerMock.mockResolvedValue({
			pushManager: {
				getSubscription: vi.fn().mockResolvedValue(null),
				subscribe: vi.fn(),
			},
		});
	});

	afterEach(() => {
		Object.defineProperty(globalThis, "fetch", {
			configurable: true,
			value: originalFetch,
		});
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: originalNotification,
		});
		Object.defineProperty(globalThis, "PushManager", {
			configurable: true,
			value: originalPushManager,
		});
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: originalServiceWorker,
		});
	});

	it("does not offer browser push when the server VAPID key is unavailable", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: "Push notifications not configured" }), {
				status: 503,
			}),
		);

		const { result } = renderHook(() => usePushNotifications());

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.isSupported).toBe(false);
		expect(result.current.permission).toBe("unsupported");
		expect(registerMock).not.toHaveBeenCalled();
		expect(requestPermissionMock).not.toHaveBeenCalled();
	});

	it("does not stay loading when the VAPID key check fails", async () => {
		const onError = vi.fn();
		vi.mocked(fetch).mockRejectedValue(new Error("network unavailable"));

		const { result } = renderHook(() => usePushNotifications({ onError }));

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.isSupported).toBe(false);
		expect(result.current.permission).toBe("unsupported");
		expect(registerMock).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(expect.any(Error));
	});

	it("does not rerun push initialization when callback props change", async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ publicKey: "test-key" })));

		const { rerender, result } = renderHook(({ onError }) => usePushNotifications({ onError }), {
			initialProps: { onError: vi.fn() },
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		rerender({ onError: vi.fn() });

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(registerMock).toHaveBeenCalledTimes(1);
	});
});
