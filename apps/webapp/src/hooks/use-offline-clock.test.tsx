/* @vitest-environment jsdom */
import { MessageChannel } from "node:worker_threads";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";

const signedInSession = {
	user: { id: "user-1" },
	session: { activeOrganizationId: "org-1" },
};
const mocks = vi.hoisted(() => ({
	session: null as typeof signedInSession | null,
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({ data: mocks.session }),
}));
vi.mock("./use-online-status", () => ({ useOnlineStatus: () => true }));
import { useOfflineClock } from "./use-offline-clock";

describe("offline clock caller outcomes", () => {
	let serviceWorker: EventTarget;
	let controller: { postMessage: ReturnType<typeof vi.fn> };
	let mode: string;
	let saveError: string | undefined;
	let client: QueryClient;
	const messages: unknown[] = [];

	beforeEach(() => {
		mode = "preservation-only-v1";
		saveError = undefined;
		messages.length = 0;
		mocks.session = structuredClone(signedInSession);
		vi.stubGlobal("MessageChannel", MessageChannel);
		controller = {
			postMessage: vi.fn((message, ports) => {
				messages.push(message);
				const response =
					message.type === "GET_VERSION"
						? { clockQueueMode: mode }
						: message.type === "GET_QUEUE_COUNT"
							? { count: 2, reviewCount: 2, savedCount: 3 }
							: message.type === "QUEUE_CLOCK_EVENT"
								? saveError
									? { success: false, error: saveError }
									: {
											success: true,
											reviewRequired: true,
											eventId: "local-only",
										}
								: { success: true, accepted: true };
				ports[0].postMessage(response);
				ports[0].close();
			}),
		};
		serviceWorker = Object.assign(new EventTarget(), {
			controller,
			register: vi.fn().mockResolvedValue({ active: controller }),
			ready: Promise.resolve({ active: controller }),
		});
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: serviceWorker,
		});
		client = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
	});
	afterEach(() => {
		client.clear();
		vi.unstubAllGlobals();
	});

	function wrapper({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
	}
	function broadcast(data: unknown) {
		const event = new MessageEvent("message", { data });
		Object.defineProperty(event, "source", { value: controller });
		serviceWorker.dispatchEvent(event);
	}

	it("restores durable review status on mount and exposes failed local saves", async () => {
		const { result } = renderHook(() => useOfflineClock(), { wrapper });
		await waitFor(() => expect(result.current.reviewCount).toBe(2));
		expect(result.current.savedCount).toBe(3);
		saveError = "Quota exceeded";
		let outcome:
			| Awaited<ReturnType<typeof result.current.queueClockEvent>>
			| undefined;
		await act(async () => {
			outcome = await result.current.queueClockEvent({
				type: "clock_in",
				timestamp: 123,
				organizationId: "org-1",
			});
		});
		expect(outcome).toEqual({ success: false, error: "Quota exceeded" });
		expect(result.current.pendingCount).toBe(2);
		await waitFor(() =>
			expect(result.current.lastError).toBe("Quota exceeded"),
		);
	});

	it("does not report worker registration failure without an account recovery context", async () => {
		mocks.session = null;
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const register = vi
			.fn()
			.mockRejectedValue(new TypeError("Failed to register a ServiceWorker"));
		Object.assign(serviceWorker, { register });
		const { result } = renderHook(() => useOfflineClock(), { wrapper });
		await waitFor(() => expect(register).toHaveBeenCalled());
		await act(async () => {});
		expect(result.current.lastError).toBeNull();
	});

	it("reports worker registration failure to a signed-in account", async () => {
		Object.assign(serviceWorker, {
			register: vi
				.fn()
				.mockRejectedValue(new TypeError("Failed to register a ServiceWorker")),
		});
		const { result } = renderHook(() => useOfflineClock(), { wrapper });
		await waitFor(() =>
			expect(result.current.lastError).toBe(
				"Failed to register a ServiceWorker",
			),
		);
	});

	it("does not send new offline captures to a destructive older worker", async () => {
		mode = "old-worker";
		const { result } = renderHook(() => useOfflineClock(), { wrapper });
		await waitFor(() =>
			expect(result.current.lastError).toContain("Update Z8"),
		);
		expect(
			await result.current.queueClockEvent({
				type: "clock_in",
				timestamp: 123,
				organizationId: "org-1",
			}),
		).toMatchObject({ success: false });
		expect(messages).not.toContainEqual(
			expect.objectContaining({ type: "QUEUE_CLOCK_EVENT" }),
		);
	});

	it("distinguishes a scoped committed outcome from a subsequent status refresh failure", async () => {
		let failStatus = false;
		const { result } = renderHook(
			() => {
				useQuery({
					queryKey: queryKeys.timeClock.status(),
					queryFn: async () => {
						if (failStatus) throw new Error("Status unavailable");
						return { isClockedIn: true };
					},
				});
				return useOfflineClock();
			},
			{ wrapper },
		);
		await waitFor(() => expect(result.current.swReady).toBe(true));
		await waitFor(() =>
			expect(client.getQueryData(queryKeys.timeClock.status())).toEqual({
				isClockedIn: true,
			}),
		);
		failStatus = true;
		act(() =>
			broadcast({
				type: "SYNC_SUCCESS",
				userId: "user-1",
				organizationId: "org-1",
				serverId: "committed-entry",
			}),
		);
		await waitFor(() =>
			expect(result.current.lastError).toContain("Clock event committed."),
		);
		expect(result.current.lastSyncAt).not.toBeNull();
		expect(messages).not.toContainEqual(
			expect.objectContaining({ type: "QUEUE_CLOCK_EVENT" }),
		);
	});
});
