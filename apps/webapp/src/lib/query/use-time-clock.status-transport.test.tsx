/* @vitest-environment jsdom */
import React from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	getTimeClockStatus: boundary.status,
	addBreakToActiveSession: vi.fn(),
	updateTimeEntryNotes: vi.fn(),
	startBreakInProgress: vi.fn(),
	resumeBreakInProgress: vi.fn(),
}));
vi.mock("@/hooks/use-offline-clock", () => ({
	useOfflineClock: () => ({
		isOnline: true,
		isOffline: false,
		pendingCount: 0,
		waitingCount: 0,
		isSyncing: false,
		queueClockEvent: vi.fn(),
		commandCapabilities: null,
		workerCommandVersions: [],
		submitClockCommand: vi.fn(),
	}),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: "user-synthetic" },
			session: { activeOrganizationId: "org-synthetic" },
		},
	}),
}));
vi.mock("@/lib/time-tracking/position-capture/use-clock-position", () => ({
	useClockPosition: () => ({
		capture: async () => ({ position: null, consentQuestion: null }),
		askAfterEvent: vi.fn(),
	}),
}));
vi.mock("@/lib/time-tracking/timezone-capture", () => ({
	getBrowserTimezone: () => "Europe/Berlin",
}));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));
import { GET as readStatusRoute } from "@/app/api/time-clock/status/route";
import * as statusClient from "@/lib/time-tracking/web-clock-status-client";
import { useTimeClock } from "./use-time-clock";
const OUT = {
	hasEmployee: true,
	employeeId: "employee-synthetic",
	isClockedIn: false,
	activeWorkPeriod: null,
};
const IN = {
	...OUT,
	isClockedIn: true,
	activeWorkPeriod: {
		id: "period-synthetic",
		startTime: new Date("2026-10-28T08:00:00.000Z"),
		currentTask: null,
		breakStartedAt: null,
		breakStartedZone: null,
	},
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
const appRequire = createRequire(
		path.resolve(__dirname, "../../../package.json"),
	),
	queueFile = appRequire.resolve(
		"next/dist/client/components/app-router-instance.js",
	),
	queueSource = readFileSync(queueFile, "utf8"),
	callSource = readFileSync(
		appRequire.resolve("next/dist/client/sequential-call-server.js"),
		"utf8",
	);
function installedQueue(reducer: (state: unknown, action: any) => unknown) {
	const module = { exports: {} };
	const realRequire = createRequire(queueFile);
	const dependency = (name: string) => {
		if (name === "react") return React;
		if (name === "./router-reducer/router-reducer") return { reducer };
		if (
			name === "./router-reducer/router-reducer-types" ||
			name === "../../shared/lib/is-thenable"
		)
			return realRequire(name);
		return {};
	};
	new Function("require", "module", "exports", queueSource)(
		dependency,
		module,
		module.exports,
	);
	const queue = (module.exports as any).createMutableActionQueue({
			synthetic: true,
		}),
		callModule = { exports: {} };
	const callDependency = (name: string) => {
		if (name === "react") return React;
		if (name === "./components/router-reducer/router-reducer-types")
			return realRequire("./router-reducer/router-reducer-types");
		if (name === "./components/use-action-queue")
			return {
				dispatchAppRouterAction: (action: unknown) =>
					queue.dispatch(action, () => {}),
			};
		throw Error("unexpected dependency");
	};
	new Function("require", "module", "exports", callSource)(
		callDependency,
		callModule,
		callModule.exports,
	);
	return { queue, callServer: (callModule.exports as any).callServer };
}
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});
for (const transport of ["legacy-action", "web-get"] as const)
	for (const held of [true, false])
		it(`${transport} ${held ? "with pending Dashboard head" : "without pending head"} preserves installed FIFO and both clocks`, async () => {
			const head = deferred<unknown>();
			let dashboardReleased = false,
				statusActionStarts = 0,
				statusGETs = 0,
				writes = 0;
			const { queue, callServer } = installedQueue((state, action) => {
				if (action.actionId === "dashboard")
					return head.promise.then((value) => {
						action.resolve(value);
						return state;
					});
				statusActionStarts++;
				action.resolve(IN);
				return state;
			});
			const dashboard = held ? callServer("dashboard", []) : null;
			if (transport === "legacy-action") {
				boundary.status.mockImplementation(() =>
					callServer("clock-status", []),
				);
				vi.spyOn(statusClient, "getWebClockStatus").mockImplementation(() =>
					boundary.status(),
				);
			} else boundary.status.mockResolvedValue(IN);
			vi.stubGlobal(
				"fetch",
				vi.fn(async (url: string, init?: RequestInit) => {
					if (url === "/api/time-clock" && init?.method === "POST") {
						writes++;
						return Response.json({
							success: true,
							data: { id: "entry-synthetic" },
						});
					}
					if (url === "/api/time-clock/status") {
						statusGETs++;
						expect(init?.cache).toBe("no-store");
						expect(init?.credentials).toBe("same-origin");
						expect(init).not.toHaveProperty("signal");
						return readStatusRoute();
					}
					throw Error("unexpected request");
				}),
			);
			const client = new QueryClient({
				defaultOptions: {
					queries: { retry: false },
					mutations: { retry: false },
				},
			});
			client.setQueryData(["time-clock", "status"], OUT);
			const wrapper = ({ children }: { children: React.ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			);
			const first = renderHook(() => useTimeClock(), { wrapper }),
				second = renderHook(() => useTimeClock(), { wrapper });
			try {
				await act(async () => {
					expect(
						await first.result.current.clockIn({
							browserTimezone: "Europe/Berlin",
						}),
					).toMatchObject({ success: true });
				});
				expect(writes).toBe(1);
				if (transport === "legacy-action" && held) {
					await waitFor(() =>
						expect(first.result.current.isFetching).toBe(true),
					);
					expect(first.result.current.isClockedIn).toBe(false);
					expect(second.result.current.isClockedIn).toBe(false);
					expect(statusActionStarts).toBe(0);
					expect(statusGETs).toBe(0);
					expect(queue.pending.next.payload.actionId).toBe("clock-status");
					dashboardReleased = true;
					await act(async () => {
						head.resolve({ success: true, data: [] });
						await dashboard;
					});
				}
				await waitFor(() => {
					expect(first.result.current.isClockedIn).toBe(true);
					expect(second.result.current.isClockedIn).toBe(true);
				});
				expect(writes).toBe(1);
				expect(boundary.status).toHaveBeenCalledTimes(1);
				if (transport === "web-get") {
					expect(statusGETs).toBe(1);
					expect(statusActionStarts).toBe(0);
					if (held) {
						expect(dashboardReleased).toBe(false);
						expect(queue.pending.payload.actionId).toBe("dashboard");
						expect(queue.pending.next).toBe(null);
					}
				} else expect(statusActionStarts).toBe(1);
			} finally {
				if (held && !dashboardReleased) {
					dashboardReleased = true;
					await act(async () => {
						head.resolve({ success: true, data: [] });
						await dashboard;
					});
				}
				client.clear();
			}
		});
it("a naturally canceled prior GET finishes without a network AbortSignal or stale overwrite", async () => {
	const prior = deferred<Response>();
	let gets = 0;
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		if (url === "/api/time-clock" && init?.method === "POST")
			return Response.json({ success: true, data: { id: "entry-synthetic" } });
		expect(url).toBe("/api/time-clock/status");
		expect(init).not.toHaveProperty("signal");
		return ++gets === 1 ? prior.promise : Response.json(IN);
	});
	vi.stubGlobal("fetch", fetch);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	client.setQueryData(["time-clock", "status"], OUT);
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const first = renderHook(() => useTimeClock(), { wrapper }),
		second = renderHook(() => useTimeClock(), { wrapper });
	let pending: Promise<unknown>;
	act(() => {
		pending = second.result.current.refetchStatus();
	});
	await waitFor(() => expect(gets).toBe(1));
	await act(async () => {
		await first.result.current.clockIn({ browserTimezone: "Europe/Berlin" });
	});
	await waitFor(() => expect(first.result.current.isClockedIn).toBe(true));
	await act(async () => {
		prior.resolve(Response.json(OUT));
		await pending!;
	});
	expect(second.result.current.isClockedIn).toBe(true);
	expect(gets).toBe(2);
	expect(
		fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
	).toHaveLength(1);
	client.clear();
});
