/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePushNotifications } from "./use-push-notifications";

const originalFetch = globalThis.fetch;
const originalNotification = globalThis.Notification;
const originalPushManager = globalThis.PushManager;
const originalServiceWorker = navigator.serviceWorker;

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

describe("usePushNotifications", () => {
	const registerMock = vi.fn();
	const requestPermissionMock = vi.fn();
	const getSubscriptionMock = vi.fn();
	const subscribeMock = vi.fn();

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

		getSubscriptionMock.mockResolvedValue(null);
		registerMock.mockResolvedValue({
			pushManager: {
				getSubscription: getSubscriptionMock,
				subscribe: subscribeMock,
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
			new Response(JSON.stringify({ error: "Push notifications not configured" }), { status: 503 }),
		);

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.isSupported).toBe(false);
		expect(result.current.permission).toBe("unsupported");
		expect(registerMock).not.toHaveBeenCalled();
		expect(requestPermissionMock).not.toHaveBeenCalled();
	});

	it("does not stay loading when the VAPID key check fails", async () => {
		const onError = vi.fn();
		vi.mocked(fetch).mockRejectedValue(new Error("network unavailable"));

		const { result } = renderHook(() => usePushNotifications({ onError }), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.isSupported).toBe(false);
		expect(result.current.permission).toBe("unsupported");
		expect(registerMock).not.toHaveBeenCalled();
		expect(result.current.error).toEqual(
			expect.objectContaining({ message: "network unavailable" }),
		);
		expect(onError).not.toHaveBeenCalled();
	});

	it("does not rerun push initialization when callback props change", async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ publicKey: "test-key" })));

		const { rerender, result } = renderHook(({ onError }) => usePushNotifications({ onError }), {
			initialProps: { onError: vi.fn() },
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		rerender({ onError: vi.fn() });

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(registerMock).toHaveBeenCalledTimes(1);
	});

	it("rolls back the browser subscription when the server rejects it", async () => {
		const onError = vi.fn();
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock.mockResolvedValue({
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: browserUnsubscribe,
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null, { status: 500 });
		});

		const { result } = renderHook(() => usePushNotifications({ onError }), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribed = true;
		await act(async () => {
			subscribed = await result.current.subscribe("Work laptop");
		});

		expect(subscribed).toBe(false);
		expect(browserUnsubscribe).toHaveBeenCalledOnce();
		expect(result.current.isSubscribed).toBe(false);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Failed to save subscription on server",
			}),
		);
	});

	it("keeps the browser subscription when server removal fails", async () => {
		const onError = vi.fn();
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		getSubscriptionMock.mockResolvedValue({
			endpoint: "https://push.test/subscription",
			unsubscribe: browserUnsubscribe,
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null, { status: 500 });
		});

		const { result } = renderHook(() => usePushNotifications({ onError }), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSubscribed).toBe(true));

		let unsubscribed = true;
		await act(async () => {
			unsubscribed = await result.current.unsubscribe();
		});

		expect(unsubscribed).toBe(false);
		expect(browserUnsubscribe).not.toHaveBeenCalled();
		expect(result.current.isSubscribed).toBe(true);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Failed to remove subscription from server",
			}),
		);
	});
});
