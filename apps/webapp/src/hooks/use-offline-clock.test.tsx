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

const OPERATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const commandContext = {
	userId: "user-1",
	organizationId: "org-1",
	employeeId: "5f0c6a52-58a4-4d5c-9b0e-5f7b8c1d2e3f",
	server: "http://localhost:3000",
};
const captureRequest = {
	operationId: OPERATION_ID,
	kind: "clock_in" as const,
	admission: "delayed" as const,
	occurredAt: "2026-09-25T08:00:00.000Z",
	timezone: "Europe/Berlin",
	context: commandContext,
	workLocationType: "office" as const,
};

describe("offline clock caller outcomes", () => {
	let serviceWorker: EventTarget;
	let controller: { postMessage: ReturnType<typeof vi.fn> };
	let mode: string;
	let saveError: string | undefined;
	let captureReply: unknown;
	let dispatchReply: unknown;
	let client: QueryClient;
	const messages: unknown[] = [];

	beforeEach(() => {
		mode = "preservation-only-v1";
		saveError = undefined;
		captureReply = { success: true, recoveryId: "local-1", operationId: OPERATION_ID, state: "pending" };
		dispatchReply = { success: false, error: "worker busy" };
		messages.length = 0;
		mocks.session = structuredClone(signedInSession);
		vi.stubGlobal("MessageChannel", MessageChannel);
		controller = {
			postMessage: vi.fn((message, ports) => {
				messages.push(message);
				const response =
					message.type === "GET_VERSION"
						? mode === "frozen"
							? { clockQueueMode: "preservation-only-v1", clockCommandMode: "frozen-v2" }
							: { clockQueueMode: mode }
						: message.type === "CAPTURE_CLOCK_COMMAND"
							? captureReply
							: message.type === "DISPATCH_CLOCK_COMMANDS"
								? dispatchReply
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

	describe("frozen clock commands (#279)", () => {
		function stubCapabilities() {
			const fetch = vi.fn(async () =>
				Response.json({ commandVersions: [2], submit: "available", context: commandContext }),
			);
			vi.stubGlobal("fetch", fetch);
			return fetch;
		}

		it("does not read capabilities or offer freezing through a worker without frozen commands", async () => {
			const fetch = stubCapabilities();
			const { result } = renderHook(() => useOfflineClock(), { wrapper });
			await waitFor(() => expect(result.current.swReady).toBe(true));
			expect(result.current.commandsReady).toBe(false);
			expect(result.current.commandCapabilities).toBeNull();
			expect(fetch).not.toHaveBeenCalled();
		});

		it("reports a failed local save as a failure and sends nothing", async () => {
			mode = "frozen";
			stubCapabilities();
			const { result } = renderHook(() => useOfflineClock(), { wrapper });
			await waitFor(() => expect(result.current.commandCapabilities).toMatchObject({ submit: "available" }));
			captureReply = { success: false, code: "storage_failed", message: "QuotaExceededError" };
			let outcome: unknown;
			await act(async () => {
				outcome = await result.current.submitClockCommand(captureRequest);
			});
			expect(outcome).toEqual({
				success: false,
				code: "storage_failed",
				error: "Could not save the clock action on this device. Nothing was sent.",
			});
			expect(messages).not.toContainEqual(expect.objectContaining({ type: "DISPATCH_CLOCK_COMMANDS" }));
		});

		it("dispatches the saved command and reads its stored outcome, never failing after the save", async () => {
			mode = "frozen";
			stubCapabilities();
			const { result } = renderHook(() => useOfflineClock(), { wrapper });
			await waitFor(() => expect(result.current.commandCapabilities).not.toBeNull());
			// Reconnect/reload lets the worker send what it holds.
			expect(messages).toContainEqual({ type: "TRIGGER_SYNC" });

			dispatchReply = {
				success: true,
				status: "done",
				record: {
					operationId: OPERATION_ID,
					kind: "clock_in",
					state: "committed",
					receipt: { kind: "start_live_work", result: { clockInEntryId: "entry-1" } },
				},
			};
			let committed: unknown;
			await act(async () => {
				committed = await result.current.submitClockCommand(captureRequest);
			});
			expect(committed).toEqual({ success: true, data: { id: "entry-1" } });
			expect(messages).toContainEqual({ type: "CAPTURE_CLOCK_COMMAND", payload: captureRequest });
			expect(messages).toContainEqual({
				type: "DISPATCH_CLOCK_COMMANDS",
				operationId: OPERATION_ID,
				context: { userId: "user-1", organizationId: "org-1" },
			});
			expect(messages).not.toContainEqual(
				expect.objectContaining({ type: "ACKNOWLEDGE_CLOCK_COMMAND" }),
			);

			dispatchReply = {
				success: true,
				status: "done",
				record: {
					operationId: OPERATION_ID,
					kind: "clock_in",
					state: "rejected",
					lastOutcome: { kind: "rejected", code: "already_clocked_in" },
				},
			};
			let refused: unknown;
			await act(async () => {
				refused = await result.current.submitClockCommand(captureRequest);
			});
			expect(refused).toMatchObject({ success: false, code: "already_clocked_in" });
			// Shown to the person, so the worker may resolve it.
			expect(messages).toContainEqual({
				type: "ACKNOWLEDGE_CLOCK_COMMAND",
				operationId: OPERATION_ID,
			});

			dispatchReply = { success: false, error: "Worker stopped" };
			let unknown: unknown;
			await act(async () => {
				unknown = await result.current.submitClockCommand(captureRequest);
			});
			expect(unknown).toEqual({ success: true, queued: true, delivery: "pending" });
		});
	});
});
