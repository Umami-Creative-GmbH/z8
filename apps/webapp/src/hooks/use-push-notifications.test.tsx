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

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
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
			new Response(
				JSON.stringify({ error: "Push notifications not configured" }),
				{ status: 503 },
			),
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
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ publicKey: "test-key" })),
		);

		const { rerender, result } = renderHook(
			({ onError }) => usePushNotifications({ onError }),
			{
				initialProps: { onError: vi.fn() },
				wrapper: createWrapper(),
			},
		);

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		rerender({ onError: vi.fn() });

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(registerMock).toHaveBeenCalledTimes(1);
	});

	it("blocks a concurrent subscribe and allows a later subscribe", async () => {
		const firstSubscribe = createDeferred<PushSubscription>();
		const subscription = {
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		} as unknown as PushSubscription;
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock
			.mockReturnValueOnce(firstSubscribe.promise)
			.mockResolvedValue(subscription);
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let firstResultPromise!: Promise<boolean>;
		act(() => {
			firstResultPromise = result.current.subscribe();
		});
		await waitFor(() => expect(subscribeMock).toHaveBeenCalledOnce());

		let concurrentResult = true;
		await act(async () => {
			concurrentResult = await result.current.subscribe();
		});
		const callsWhilePending = subscribeMock.mock.calls.length;

		firstSubscribe.resolve(subscription);
		let firstResult = false;
		await act(async () => {
			firstResult = await firstResultPromise;
		});

		let laterResult = false;
		await act(async () => {
			laterResult = await result.current.subscribe();
		});

		expect(concurrentResult).toBe(false);
		expect(callsWhilePending).toBe(1);
		expect(firstResult).toBe(true);
		expect(laterResult).toBe(true);
		expect(subscribeMock).toHaveBeenCalledTimes(2);
	});

	it("blocks unsubscribe during subscribe and allows it after subscribe settles", async () => {
		const firstSubscribe = createDeferred<PushSubscription>();
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		const subscription = {
			endpoint: "https://push.test/subscription",
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: browserUnsubscribe,
		} as unknown as PushSubscription;
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock.mockReturnValueOnce(firstSubscribe.promise);
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribeResultPromise!: Promise<boolean>;
		act(() => {
			subscribeResultPromise = result.current.subscribe();
		});
		await waitFor(() => expect(subscribeMock).toHaveBeenCalledOnce());

		let overlappingUnsubscribe = true;
		await act(async () => {
			overlappingUnsubscribe = await result.current.unsubscribe();
		});
		const subscriptionChecksWhilePending =
			getSubscriptionMock.mock.calls.length;

		firstSubscribe.resolve(subscription);
		await act(async () => {
			await subscribeResultPromise;
		});
		getSubscriptionMock.mockResolvedValue(subscription);

		let laterUnsubscribe = false;
		await act(async () => {
			laterUnsubscribe = await result.current.unsubscribe();
		});

		expect(overlappingUnsubscribe).toBe(false);
		expect(subscriptionChecksWhilePending).toBe(1);
		expect(laterUnsubscribe).toBe(true);
		expect(getSubscriptionMock).toHaveBeenCalledTimes(2);
	});

	it("serializes push actions across hook instances", async () => {
		const firstSubscribe = createDeferred<PushSubscription>();
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		const subscription = {
			endpoint: "https://push.test/subscription",
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: browserUnsubscribe,
		} as unknown as PushSubscription;
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock
			.mockReturnValueOnce(firstSubscribe.promise)
			.mockResolvedValue(subscription);
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		const { result } = renderHook(
			() => ({ first: usePushNotifications(), second: usePushNotifications() }),
			{ wrapper: createWrapper() },
		);
		await waitFor(() => expect(result.current.first.isSupported).toBe(true));

		let firstResultPromise!: Promise<boolean>;
		act(() => {
			firstResultPromise = result.current.first.subscribe();
		});
		await waitFor(() => expect(subscribeMock).toHaveBeenCalledOnce());

		let blockedSubscribe = true;
		let blockedUnsubscribe = true;
		let secondLoadingWhilePending = true;
		try {
			await act(async () => {
				blockedSubscribe = await result.current.second.subscribe();
				blockedUnsubscribe = await result.current.second.unsubscribe();
			});
			secondLoadingWhilePending = result.current.second.isLoading;
		} finally {
			firstSubscribe.resolve(subscription);
		}
		const subscribeCallsWhilePending = subscribeMock.mock.calls.length;
		const subscriptionChecksWhilePending =
			getSubscriptionMock.mock.calls.length;
		const fetchCallsWhilePending = vi.mocked(fetch).mock.calls.length;

		await act(async () => {
			expect(await firstResultPromise).toBe(true);
		});
		getSubscriptionMock.mockResolvedValue(subscription);

		let laterUnsubscribe = false;
		await act(async () => {
			laterUnsubscribe = await result.current.second.unsubscribe();
		});

		expect(blockedSubscribe).toBe(false);
		expect(blockedUnsubscribe).toBe(false);
		expect(secondLoadingWhilePending).toBe(false);
		expect(subscribeCallsWhilePending).toBe(1);
		expect(subscriptionChecksWhilePending).toBe(1);
		expect(fetchCallsWhilePending).toBe(1);
		expect(laterUnsubscribe).toBe(true);
		expect(browserUnsubscribe).toHaveBeenCalledOnce();
	});

	it("releases loading and serialization after a deferred subscribe rejects", async () => {
		const firstSubscribe = createDeferred<PushSubscription>();
		const subscription = {
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		} as unknown as PushSubscription;
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock
			.mockReturnValueOnce(firstSubscribe.promise)
			.mockResolvedValue(subscription);
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let firstResultPromise!: Promise<boolean>;
		act(() => {
			firstResultPromise = result.current.subscribe();
		});
		await waitFor(() => expect(result.current.isLoading).toBe(true));

		firstSubscribe.reject(new Error("subscribe unavailable"));
		let firstResult = true;
		await act(async () => {
			firstResult = await firstResultPromise;
		});

		expect(firstResult).toBe(false);
		await waitFor(() => expect(result.current.isLoading).toBe(false));

		let laterResult = false;
		await act(async () => {
			laterResult = await result.current.subscribe();
		});

		expect(laterResult).toBe(true);
		expect(subscribeMock).toHaveBeenCalledTimes(2);
	});

	it("uses the latest onSubscribe after a pending server save", async () => {
		const saveResponse = createDeferred<Response>();
		const oldOnSubscribe = vi.fn();
		const latestOnSubscribe = vi.fn();
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock.mockResolvedValue({
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		});
		vi.mocked(fetch).mockImplementation((input) => {
			if (String(input).endsWith("/vapid-key")) {
				return Promise.resolve(
					new Response(JSON.stringify({ publicKey: "test-key" })),
				);
			}
			return saveResponse.promise;
		});

		const { rerender, result } = renderHook(
			({ onSubscribe }) => usePushNotifications({ onSubscribe }),
			{
				initialProps: { onSubscribe: oldOnSubscribe },
				wrapper: createWrapper(),
			},
		);
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribePromise!: Promise<boolean>;
		act(() => {
			subscribePromise = result.current.subscribe();
		});
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		rerender({ onSubscribe: latestOnSubscribe });

		saveResponse.resolve(new Response(null));
		await act(async () => {
			await subscribePromise;
		});

		expect(oldOnSubscribe).not.toHaveBeenCalled();
		expect(latestOnSubscribe).toHaveBeenCalledOnce();
	});

	it("uses the latest onError after a pending server save fails", async () => {
		const saveResponse = createDeferred<Response>();
		const oldOnError = vi.fn();
		const latestOnError = vi.fn();
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock.mockResolvedValue({
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		});
		vi.mocked(fetch).mockImplementation((input) => {
			if (String(input).endsWith("/vapid-key")) {
				return Promise.resolve(
					new Response(JSON.stringify({ publicKey: "test-key" })),
				);
			}
			return saveResponse.promise;
		});

		const { rerender, result } = renderHook(
			({ onError }) => usePushNotifications({ onError }),
			{
				initialProps: { onError: oldOnError },
				wrapper: createWrapper(),
			},
		);
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribePromise!: Promise<boolean>;
		act(() => {
			subscribePromise = result.current.subscribe();
		});
		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
		rerender({ onError: latestOnError });

		saveResponse.resolve(new Response(null, { status: 500 }));
		await act(async () => {
			await subscribePromise;
		});

		expect(oldOnError).not.toHaveBeenCalled();
		expect(latestOnError).toHaveBeenCalledOnce();
	});

	it("allows onSubscribe to start unsubscribe after the subscribe lock is released", async () => {
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		const subscription = {
			endpoint: "https://push.test/subscription",
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: browserUnsubscribe,
		} as unknown as PushSubscription;
		let subscriptionChecks = 0;
		getSubscriptionMock.mockImplementation(async () => {
			subscriptionChecks += 1;
			return subscriptionChecks === 1 ? null : subscription;
		});
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock.mockResolvedValue(subscription);
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		let startUnsubscribe!: () => Promise<boolean>;
		let unsubscribePromise!: Promise<boolean>;
		const onSubscribe = vi.fn(() => {
			unsubscribePromise = startUnsubscribe();
		});
		const { result } = renderHook(() => usePushNotifications({ onSubscribe }), {
			wrapper: createWrapper(),
		});
		startUnsubscribe = () => result.current.unsubscribe();
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		await act(async () => {
			expect(await result.current.subscribe()).toBe(true);
		});

		let inverseResult = false;
		await act(async () => {
			inverseResult = await unsubscribePromise;
		});

		expect(inverseResult).toBe(true);
		expect(getSubscriptionMock).toHaveBeenCalledTimes(2);
		expect(browserUnsubscribe).toHaveBeenCalledOnce();
	});

	it("allows onError to retry subscribe after the failed subscribe lock is released", async () => {
		const firstSubscription = {
			toJSON: () => ({ endpoint: "https://push.test/first" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		};
		const retrySubscription = {
			toJSON: () => ({ endpoint: "https://push.test/retry" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		};
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		let subscribeAttempts = 0;
		subscribeMock.mockImplementation(async () => {
			subscribeAttempts += 1;
			return subscribeAttempts === 1 ? firstSubscription : retrySubscription;
		});
		let saveAttempts = 0;
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			saveAttempts += 1;
			return new Response(null, { status: saveAttempts === 1 ? 500 : 200 });
		});

		let retrySubscribe!: () => Promise<boolean>;
		let retryPromise!: Promise<boolean>;
		const onError = vi.fn(() => {
			retryPromise = retrySubscribe();
		});
		const { result } = renderHook(() => usePushNotifications({ onError }), {
			wrapper: createWrapper(),
		});
		retrySubscribe = () => result.current.subscribe();
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		await act(async () => {
			expect(await result.current.subscribe()).toBe(false);
		});

		let retryResult = false;
		await act(async () => {
			retryResult = await retryPromise;
		});

		expect(retryResult).toBe(true);
		expect(subscribeMock).toHaveBeenCalledTimes(2);
		expect(onError).toHaveBeenCalledOnce();
	});

	it("allows onError to retry subscribe after notification permission rejects", async () => {
		const permissionError = new Error("permission unavailable");
		let permissionAttempts = 0;
		requestPermissionMock.mockImplementation(async () => {
			permissionAttempts += 1;
			if (permissionAttempts === 1) throw permissionError;
			return "granted";
		});
		subscribeMock.mockResolvedValue({
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		let retrySubscribe!: () => Promise<boolean>;
		let retryPromise!: Promise<boolean>;
		const onError = vi.fn(() => {
			retryPromise = retrySubscribe();
		});
		const { result } = renderHook(() => usePushNotifications({ onError }), {
			wrapper: createWrapper(),
		});
		retrySubscribe = () => result.current.subscribe();
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		await act(async () => {
			expect(await result.current.subscribe()).toBe(false);
		});

		let retryResult = false;
		await act(async () => {
			retryResult = await retryPromise;
		});

		expect(retryResult).toBe(true);
		expect(requestPermissionMock).toHaveBeenCalledTimes(2);
		expect(subscribeMock).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(permissionError);
	});

	it("reports standalone notification permission errors", async () => {
		const permissionError = new Error("permission unavailable");
		const onError = vi.fn();
		requestPermissionMock.mockRejectedValue(permissionError);
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ publicKey: "test-key" })),
		);

		const { result } = renderHook(() => usePushNotifications({ onError }), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let permission: NotificationPermission = "default";
		await act(async () => {
			permission = await result.current.requestPermission();
		});

		expect(permission).toBe("denied");
		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(permissionError);
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

	it("rolls back the browser subscription when server persistence throws", async () => {
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
			throw new Error("network unavailable");
		});

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribed = true;
		await act(async () => {
			subscribed = await result.current.subscribe("Work laptop");
		});

		expect(subscribed).toBe(false);
		expect(browserUnsubscribe).toHaveBeenCalledOnce();
	});

	it("clears stale subscribed state when browser rollback succeeds", async () => {
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		getSubscriptionMock.mockResolvedValue({
			endpoint: "https://push.test/existing",
		});
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

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSubscribed).toBe(true));

		await act(async () => {
			await result.current.subscribe();
		});

		expect(result.current.isSubscribed).toBe(false);
	});

	it("clears subscribed state when browser rollback returns false", async () => {
		const browserUnsubscribe = vi.fn().mockResolvedValue(false);
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

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribed = true;
		await act(async () => {
			subscribed = await result.current.subscribe();
		});

		expect(subscribed).toBe(false);
		expect(result.current.isSubscribed).toBe(false);
	});

	it("keeps subscribed state when rejected rollback still has a subscription", async () => {
		const browserUnsubscribe = vi
			.fn()
			.mockRejectedValue(new Error("rollback unavailable"));
		let subscriptionChecks = 0;
		getSubscriptionMock.mockImplementation(async () => {
			subscriptionChecks += 1;
			return subscriptionChecks === 1
				? null
				: { endpoint: "https://push.test/subscription" };
		});
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
			throw new Error("network unavailable");
		});

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribed = true;
		await act(async () => {
			subscribed = await result.current.subscribe();
		});

		expect(subscribed).toBe(false);
		expect(result.current.isSubscribed).toBe(true);
		expect(getSubscriptionMock).toHaveBeenCalledTimes(2);
	});

	it("clears subscribed state when rejected rollback has no subscription", async () => {
		const browserUnsubscribe = vi
			.fn()
			.mockRejectedValue(new Error("rollback unavailable"));
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
			throw new Error("network unavailable");
		});

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribed = true;
		await act(async () => {
			subscribed = await result.current.subscribe();
		});

		expect(subscribed).toBe(false);
		expect(result.current.isSubscribed).toBe(false);
		expect(getSubscriptionMock).toHaveBeenCalledTimes(2);
	});

	it("keeps subscribed state when rollback reconciliation rejects", async () => {
		const browserUnsubscribe = vi
			.fn()
			.mockRejectedValue(new Error("rollback unavailable"));
		let subscriptionChecks = 0;
		getSubscriptionMock.mockImplementation(async () => {
			subscriptionChecks += 1;
			if (subscriptionChecks === 1) return null;
			throw new Error("subscription status unavailable");
		});
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
			throw new Error("network unavailable");
		});

		const { result } = renderHook(() => usePushNotifications(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribed = true;
		await act(async () => {
			subscribed = await result.current.subscribe();
		});

		expect(subscribed).toBe(false);
		expect(result.current.isSubscribed).toBe(true);
		expect(getSubscriptionMock).toHaveBeenCalledTimes(2);
	});

	it("keeps a successful subscription when onSubscribe throws", async () => {
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		const onSubscribe = vi.fn(() => {
			throw new Error("consumer callback failed");
		});
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
			return new Response(null);
		});

		const { result } = renderHook(() => usePushNotifications({ onSubscribe }), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isSupported).toBe(true));

		let subscribed = false;
		await act(async () => {
			subscribed = await result.current.subscribe();
		});

		expect(subscribed).toBe(true);
		expect(onSubscribe).toHaveBeenCalledOnce();
		expect(browserUnsubscribe).not.toHaveBeenCalled();
	});

	it("keeps a successful subscription when async onSubscribe rejects", async () => {
		const callbackError = new Error("consumer callback failed");
		const onSubscribe = vi.fn(async () => {
			throw callbackError;
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock.mockResolvedValue({
			toJSON: () => ({ endpoint: "https://push.test/subscription" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		try {
			const { result } = renderHook(
				() => usePushNotifications({ onSubscribe }),
				{
					wrapper: createWrapper(),
				},
			);
			await waitFor(() => expect(result.current.isSupported).toBe(true));

			let subscribed = false;
			await act(async () => {
				subscribed = await result.current.subscribe();
			});

			expect(subscribed).toBe(true);
			expect(onSubscribe).toHaveBeenCalledOnce();
			await waitFor(() =>
				expect(consoleError).toHaveBeenCalledWith(
					"Push notification callback failed:",
					callbackError,
				),
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it("does not retry rollback when onError throws", async () => {
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		const onError = vi.fn(() => {
			throw new Error("consumer callback failed");
		});
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
			subscribed = await result.current.subscribe();
		});

		expect(subscribed).toBe(false);
		expect(browserUnsubscribe).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledOnce();
	});

	it("does not reject or retry rollback when async onError rejects", async () => {
		const callbackError = new Error("consumer callback failed");
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		const onError = vi.fn(async () => {
			throw callbackError;
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
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

		try {
			const { result } = renderHook(() => usePushNotifications({ onError }), {
				wrapper: createWrapper(),
			});
			await waitFor(() => expect(result.current.isSupported).toBe(true));

			let subscribed = true;
			await act(async () => {
				subscribed = await result.current.subscribe();
			});

			expect(subscribed).toBe(false);
			expect(browserUnsubscribe).toHaveBeenCalledOnce();
			expect(onError).toHaveBeenCalledOnce();
			await waitFor(() =>
				expect(consoleError).toHaveBeenCalledWith(
					"Push notification callback failed:",
					callbackError,
				),
			);
		} finally {
			consoleError.mockRestore();
		}
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

	it("completes direct unsubscribe when the browser reports it already deactivated", async () => {
		const onError = vi.fn();
		const onUnsubscribe = vi.fn();
		const browserUnsubscribe = vi.fn().mockResolvedValue(false);
		getSubscriptionMock.mockResolvedValue({
			endpoint: "https://push.test/subscription",
			unsubscribe: browserUnsubscribe,
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		const { result } = renderHook(
			() => usePushNotifications({ onError, onUnsubscribe }),
			{
				wrapper: createWrapper(),
			},
		);
		await waitFor(() => expect(result.current.isSubscribed).toBe(true));

		let unsubscribed = false;
		await act(async () => {
			unsubscribed = await result.current.unsubscribe();
		});

		expect(unsubscribed).toBe(true);
		expect(result.current.isSubscribed).toBe(false);
		expect(onUnsubscribe).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();
	});

	it("reports direct browser unsubscribe rejection and resets loading", async () => {
		const unsubscribeError = new Error("browser unsubscribe failed");
		const onError = vi.fn();
		const onUnsubscribe = vi.fn();
		const browserUnsubscribe = vi.fn().mockRejectedValue(unsubscribeError);
		getSubscriptionMock.mockResolvedValue({
			endpoint: "https://push.test/subscription",
			unsubscribe: browserUnsubscribe,
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		const { result } = renderHook(
			() => usePushNotifications({ onError, onUnsubscribe }),
			{
				wrapper: createWrapper(),
			},
		);
		await waitFor(() => expect(result.current.isSubscribed).toBe(true));

		let unsubscribed = true;
		await act(async () => {
			unsubscribed = await result.current.unsubscribe();
		});

		expect(unsubscribed).toBe(false);
		expect(result.current.isSubscribed).toBe(true);
		expect(result.current.isLoading).toBe(false);
		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(unsubscribeError);
		expect(onUnsubscribe).not.toHaveBeenCalled();
	});

	it("keeps a successful browser unsubscribe when onUnsubscribe throws", async () => {
		const onUnsubscribe = vi.fn(() => {
			throw new Error("consumer callback failed");
		});
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		getSubscriptionMock.mockResolvedValue({
			endpoint: "https://push.test/subscription",
			unsubscribe: browserUnsubscribe,
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		const { result } = renderHook(
			() => usePushNotifications({ onUnsubscribe }),
			{
				wrapper: createWrapper(),
			},
		);
		await waitFor(() => expect(result.current.isSubscribed).toBe(true));

		let unsubscribed = false;
		await act(async () => {
			unsubscribed = await result.current.unsubscribe();
		});

		expect(unsubscribed).toBe(true);
		expect(onUnsubscribe).toHaveBeenCalledOnce();
	});

	it("keeps a successful browser unsubscribe when async onUnsubscribe rejects", async () => {
		const callbackError = new Error("consumer callback failed");
		const onUnsubscribe = vi.fn(async () => {
			throw callbackError;
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		getSubscriptionMock.mockResolvedValue({
			endpoint: "https://push.test/subscription",
			unsubscribe: browserUnsubscribe,
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		try {
			const { result } = renderHook(
				() => usePushNotifications({ onUnsubscribe }),
				{
					wrapper: createWrapper(),
				},
			);
			await waitFor(() => expect(result.current.isSubscribed).toBe(true));

			let unsubscribed = false;
			await act(async () => {
				unsubscribed = await result.current.unsubscribe();
			});

			expect(unsubscribed).toBe(true);
			expect(onUnsubscribe).toHaveBeenCalledOnce();
			await waitFor(() =>
				expect(consoleError).toHaveBeenCalledWith(
					"Push notification callback failed:",
					callbackError,
				),
			);
		} finally {
			consoleError.mockRestore();
		}
	});

	it("allows onUnsubscribe to start subscribe after the unsubscribe lock is released", async () => {
		const browserUnsubscribe = vi.fn().mockResolvedValue(true);
		getSubscriptionMock.mockResolvedValue({
			endpoint: "https://push.test/subscription",
			unsubscribe: browserUnsubscribe,
		});
		Object.defineProperty(globalThis, "Notification", {
			configurable: true,
			value: {
				permission: "granted",
				requestPermission: requestPermissionMock,
			},
		});
		subscribeMock.mockResolvedValue({
			toJSON: () => ({ endpoint: "https://push.test/new-subscription" }),
			unsubscribe: vi.fn().mockResolvedValue(true),
		});
		vi.mocked(fetch).mockImplementation(async (input) => {
			if (String(input).endsWith("/vapid-key")) {
				return new Response(JSON.stringify({ publicKey: "test-key" }));
			}
			return new Response(null);
		});

		let startSubscribe!: () => Promise<boolean>;
		let subscribePromise!: Promise<boolean>;
		const onUnsubscribe = vi.fn(() => {
			subscribePromise = startSubscribe();
		});
		const { result } = renderHook(
			() => usePushNotifications({ onUnsubscribe }),
			{
				wrapper: createWrapper(),
			},
		);
		startSubscribe = () => result.current.subscribe();
		await waitFor(() => expect(result.current.isSubscribed).toBe(true));

		await act(async () => {
			expect(await result.current.unsubscribe()).toBe(true);
		});

		let inverseResult = false;
		await act(async () => {
			inverseResult = await subscribePromise;
		});

		expect(inverseResult).toBe(true);
		expect(subscribeMock).toHaveBeenCalledOnce();
	});
});
