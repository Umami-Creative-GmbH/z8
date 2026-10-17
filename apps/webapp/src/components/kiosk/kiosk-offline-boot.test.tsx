/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKioskCacheStorage } from "@/lib/time-tracking/kiosk/offline-cache.test.fixture";
import {
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskDeviceInfo,
	type KioskEmployeesResponse,
} from "@/lib/time-tracking/kiosk/protocol";
import { KioskApp } from "./kiosk-app";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	usePathname: () => "/kiosk",
	useRouter: () => ({ replace: vi.fn() }),
}));

// The kiosk's IndexedDB cache, in memory: jsdom has no IndexedDB.
const cacheStorage = vi.hoisted(() => ({
	current: null as ReturnType<typeof memoryKioskCacheStorage> | null,
}));
vi.mock("@/lib/time-tracking/kiosk/offline-cache", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/time-tracking/kiosk/offline-cache")>();
	return {
		...actual,
		kioskOfflineCache: actual.createKioskOfflineCache(() => {
			if (!cacheStorage.current) throw new Error("no storage");
			return cacheStorage.current;
		}),
	};
});

/**
 * #1291: an offline-mode kiosk boots through an outage with its cached
 * employees, shows their cached state "as of" when it learned it, and deletes
 * the cache at the next contact once it no longer needs it.
 */
const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Front door",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Store",
	timezone: "Europe/Berlin",
	boardEnabled: true,
	language: "en",
	offlineMode: true,
};

const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const ben = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ben Özdemir" };

const listed: KioskEmployeesResponse = {
	employees: [anna, ben],
	offline: {
		learnedAt: "2026-10-16T07:45:00Z",
		states: {
			[anna.id]: { status: "clocked_in", workPeriodId: "wp-1", since: "2026-10-16T06:30:00Z" },
			[ben.id]: { status: "clocked_out" },
		},
	},
};

type Route = () => Response;

function stubFetch(routes: Record<string, Route>) {
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			calls.push(url);
			const route = routes[url];
			return route ? route() : Response.json({}, { status: 404 });
		}),
	);
	return calls;
}

function stubNoNetwork() {
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			calls.push(url);
			throw new TypeError("Failed to fetch");
		}),
	);
	return calls;
}

/** A browser's service worker container that records what the kiosk registers. */
function stubServiceWorkers() {
	const registered: { script: string; scope: string }[] = [];
	const unregistered: string[] = [];
	const registrations = new Map<string, { scope: string; script: string }>();
	const container = {
		register: vi.fn(async (script: string, options: { scope: string }) => {
			registered.push({ script, scope: options.scope });
			registrations.set(options.scope, { scope: options.scope, script });
			return { active: null, waiting: null, installing: { postMessage: vi.fn() } };
		}),
		getRegistrations: vi.fn(async () =>
			[...registrations.values()].map((entry) => ({
				scope: `http://localhost:3000${entry.scope}`,
				active: { scriptURL: `http://localhost:3000${entry.script}` },
				waiting: null,
				installing: null,
				unregister: async () => {
					unregistered.push(entry.scope);
					registrations.delete(entry.scope);
					return true;
				},
			})),
		),
	};
	Object.defineProperty(window.navigator, "serviceWorker", {
		configurable: true,
		value: container,
	});
	return { registered, unregistered, registrations };
}

function goOffline() {
	vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
}

async function enterPin(digits: string) {
	for (const digit of digits) fireEvent.click(screen.getByRole("button", { name: digit }));
	fireEvent.click(screen.getByRole("button", { name: "OK" }));
}

async function openOnline(routes: Record<string, Route> = {}) {
	const calls = stubFetch({
		"/api/kiosk/session": () => Response.json({ kiosk }),
		"/api/kiosk/employees": () => Response.json(listed),
		...routes,
	});
	render(<KioskApp />);
	await screen.findByRole("button", { name: /Anna Berger/ });
	await waitFor(() => expect(cacheStorage.current?.keys()).toEqual(["kiosk", "employees"]));
	return calls;
}

describe("offline-mode kiosk boot (#1291)", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		window.history.replaceState(null, "", "/en/kiosk");
		cacheStorage.current = memoryKioskCacheStorage();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		Reflect.deleteProperty(window.navigator, "serviceWorker");
	});

	it("registers its own worker for its kiosk route, never the app's root worker", async () => {
		const workers = stubServiceWorkers();

		await openOnline();

		await waitFor(() => expect(workers.registered).toHaveLength(1));
		expect(workers.registered[0]?.scope).toBe("/en/kiosk");
		expect(workers.registered[0]?.script).toMatch(/^\/kiosk-sw\.js\?v=/);
	});

	it("boots offline after a reload with the kiosk and its cached employees, without the board", async () => {
		await openOnline();
		cleanup();

		const calls = stubNoNetwork();
		goOffline();
		render(<KioskApp />);

		expect(await screen.findByRole("button", { name: /Anna Berger/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Ben Özdemir/ })).toBeTruthy();
		expect(screen.getByText("Front door")).toBeTruthy();
		expect(screen.getByText("Store")).toBeTruthy();
		expect(screen.getByText(/The kiosk is offline\. Clocking is not possible/)).toBeTruthy();
		expect(screen.queryByText("Who is in")).toBeNull();
		expect(calls).not.toContain("/api/kiosk/employee-status");
	});

	it("boots from the cache when the server cannot be reached though the network is up", async () => {
		await openOnline();
		cleanup();

		stubNoNetwork();
		render(<KioskApp />);

		expect(await screen.findByRole("button", { name: /Anna Berger/ })).toBeTruthy();
		expect(screen.getByText(/The kiosk is offline\. Clocking is not possible/)).toBeTruthy();
	});

	it("shows a chosen employee's cached state as of when it was learned, never a day total, and clocks nothing", async () => {
		await openOnline();
		cleanup();
		const calls = stubNoNetwork();
		goOffline();
		render(<KioskApp />);

		fireEvent.click(await screen.findByRole("button", { name: /Anna Berger/ }));
		await enterPin("2468");

		expect(await screen.findByText(/^Clocked in since 8:30\sAM$/)).toBeTruthy();
		expect(screen.getByText(/^As of 9:45\sAM$/)).toBeTruthy();
		expect(screen.queryByText(/Today:/)).toBeNull();
		const clockOut = screen.getByRole("button", { name: "Clock out" }) as HTMLButtonElement;
		expect(clockOut.disabled).toBe(true);
		expect(calls.filter((url) => url !== "/api/kiosk/session")).toEqual([]);
		expect(
			JSON.stringify(cacheStorage.current && (await cacheStorage.current.get("employees"))),
		).not.toContain("2468");
	});

	it("caches nothing with offline mode off, and an offline restart says the kiosk is offline", async () => {
		const workers = stubServiceWorkers();
		stubFetch({
			"/api/kiosk/session": () => Response.json({ kiosk: { ...kiosk, offlineMode: false } }),
			"/api/kiosk/employees": () => Response.json({ employees: [anna, ben] }),
		});
		render(<KioskApp />);
		await screen.findByRole("button", { name: /Anna Berger/ });
		cleanup();

		expect(cacheStorage.current?.keys()).toEqual([]);
		expect(workers.registered).toEqual([]);
		stubNoNetwork();
		render(<KioskApp />);
		expect(await screen.findByText(/cannot reach the server/i)).toBeTruthy();
	});

	it("deletes its cache and its worker at the next contact once offline mode is switched off", async () => {
		const workers = stubServiceWorkers();
		let offlineMode = true;
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await openOnline({
			"/api/kiosk/session": () => Response.json({ kiosk: { ...kiosk, offlineMode } }),
		});
		await waitFor(() => expect(workers.registrations.size).toBe(1));

		offlineMode = false;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(61_000);
		});

		await waitFor(() => expect(cacheStorage.current?.keys()).toEqual([]));
		expect(workers.unregistered).toEqual(["/en/kiosk"]);
	});

	it("drops an un-assigned employee from the cache at the next contact", async () => {
		let employees: KioskEmployeesResponse = listed;
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await openOnline({ "/api/kiosk/employees": () => Response.json(employees) });

		employees = {
			employees: [ben],
			offline: {
				learnedAt: "2026-10-16T08:00:00Z",
				states: { [ben.id]: { status: "clocked_out" } },
			},
		};
		await act(async () => {
			await vi.advanceTimersByTimeAsync(61_000);
		});

		await waitFor(async () =>
			expect(await cacheStorage.current?.get("employees")).toEqual({
				kioskId: kiosk.id,
				employees: [
					{ ...ben, state: { status: "clocked_out" }, learnedAt: "2026-10-16T08:00:00Z" },
				],
			}),
		);
		expect(screen.queryByRole("button", { name: /Anna Berger/ })).toBeNull();
	});

	it("deletes its cache when the kiosk turns out revoked at the next contact", async () => {
		let revoked = false;
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await openOnline({
			"/api/kiosk/session": () =>
				revoked
					? Response.json({ code: "kiosk_revoked" }, { status: 401 })
					: Response.json({ kiosk }),
		});

		revoked = true;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(61_000);
		});

		expect(await screen.findByText(/contact your admin/i)).toBeTruthy();
		await waitFor(() => expect(cacheStorage.current?.keys()).toEqual([]));
	});
});
