/* @vitest-environment jsdom */

import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { KioskFrozenSubmission } from "@/lib/time-tracking/kiosk/frozen-command";
import { memoryKioskCacheStorage } from "@/lib/time-tracking/kiosk/offline-cache.test.fixture";
import { createKioskOfflineClock } from "@/lib/time-tracking/kiosk/offline-clock";
import { memoryKioskQueueStorage } from "@/lib/time-tracking/kiosk/offline-queue.test.fixture";
import {
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskDeviceInfo,
	type KioskEmployeesResponse,
	type KioskSessionResponse,
} from "@/lib/time-tracking/kiosk/protocol";

vi.mock("server-only", () => ({}));

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

// The kiosk's IndexedDB stores, in memory: jsdom has no IndexedDB.
const stores = vi.hoisted(() => ({
	cache: null as ReturnType<typeof memoryKioskCacheStorage> | null,
	queue: null as ReturnType<typeof memoryKioskQueueStorage> | null,
}));
vi.mock("@/lib/time-tracking/kiosk/offline-cache", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/time-tracking/kiosk/offline-cache")>();
	return {
		...actual,
		kioskOfflineCache: actual.createKioskOfflineCache(() => {
			if (!stores.cache) throw new Error("no storage");
			return stores.cache;
		}),
	};
});
vi.mock("@/lib/time-tracking/kiosk/offline-queue", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/time-tracking/kiosk/offline-queue")>();
	return {
		...actual,
		kioskOfflineQueue: actual.createKioskOfflineQueue({
			storage: () => {
				if (!stores.queue) throw new Error("no storage");
				return stores.queue;
			},
		}),
	};
});

// The page's clock: a monotonic clock and a device clock the test sets; a "restart" is a new one.
const clocks = vi.hoisted(() => ({
	monotonic: 0,
	device: "2026-10-16T08:30:00Z",
	current: null as ReturnType<typeof createKioskOfflineClock> | null,
}));
vi.mock("@/lib/time-tracking/kiosk/offline-clock", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/time-tracking/kiosk/offline-clock")>();
	return {
		...actual,
		kioskOfflineClock: {
			noteContact: (serverTime: string) => clocks.current?.noteContact(serverTime),
			now: () => {
				if (!clocks.current) throw new Error("no clock");
				return clocks.current.now();
			},
		},
	};
});

function restartClock() {
	clocks.current = createKioskOfflineClock({
		monotonicMilliseconds: () => clocks.monotonic,
		device: { nowInstant: () => parseInstant(clocks.device) },
	});
}

const { KioskApp } = await import("./kiosk-app");
const { kioskSealingKey, openSealedKioskPin } = await import(
	"@/lib/time-tracking/kiosk/pin-seal.server"
);

/**
 * #1292: offline kiosk clocking at the kiosk. An offline-mode kiosk without a
 * connection queues each employee's action as a frozen kiosk command with their
 * PIN sealed for Z8, says it is not yet confirmed, and sends the queue when the
 * connection is back.
 */
const SECRET = "t1292-sealing-secret-with-at-least-32-characters";
const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Front door",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Store",
	timezone: "Europe/Berlin",
	boardEnabled: false,
	language: "en",
	offlineMode: true,
};
const session: KioskSessionResponse = {
	kiosk,
	offline: {
		contact: { serverTime: "2026-10-16T07:45:00Z", proof: "cHJvb2Y" },
		sealingKey: kioskSealingKey(SECRET),
	},
};

const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const ben = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ben Özdemir" };
const annaWork = "99999999-9999-4999-8999-999999999999";
const van = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const listed: KioskEmployeesResponse = {
	employees: [anna, ben],
	offline: {
		learnedAt: "2026-10-16T07:45:00Z",
		states: {
			[anna.id]: { status: "clocked_in", workPeriodId: annaWork, since: "2026-10-16T06:30:00Z" },
			[ben.id]: { status: "clocked_out" },
		},
		vehicleUse: {
			[ben.id]: {
				mode: "asked",
				vehicles: [{ id: van, name: "Van", licencePlate: "B-ZE 8", archived: false }],
				suggestedVehicleIds: [],
				lastEndKmByVehicleId: {},
				vehiclesOnOtherLiveWork: [],
				live: null,
			},
		},
	},
};

type Call = { method: string; url: string; token: string | null; body: string | null };
type Route = (call: Call) => Response | Promise<Response>;

function stubFetch(routes: Record<string, Route>) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const call: Call = {
				method: init?.method ?? "GET",
				url,
				token: new Headers(init?.headers).get("x-kiosk-token"),
				body: typeof init?.body === "string" ? init.body : null,
			};
			calls.push(call);
			const route = routes[`${call.method} ${url}`] ?? routes[url];
			return route ? route(call) : Response.json({}, { status: 404 });
		}),
	);
	return calls;
}

function stubNoNetwork() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new TypeError("Failed to fetch");
		}),
	);
}

function setOnline(online: boolean) {
	vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(online);
	act(() => {
		window.dispatchEvent(new Event(online ? "online" : "offline"));
	});
}

async function enterPin(digits: string) {
	for (const digit of digits) fireEvent.click(screen.getByRole("button", { name: digit }));
	fireEvent.click(screen.getByRole("button", { name: "OK" }));
}

async function openOnline() {
	stubFetch({
		"/api/kiosk/session": () => Response.json(session),
		"/api/kiosk/employees": () => Response.json(listed),
	});
	render(<KioskApp />);
	await screen.findByRole("button", { name: /Anna Berger/ });
	await waitFor(() =>
		expect(stores.cache?.keys().sort()).toEqual(["contact", "employees", "kiosk"]),
	);
}

/** Opens the kiosk online once, then restarts it without a connection. */
async function restartOffline() {
	await openOnline();
	cleanup();
	restartClock();
	stubNoNetwork();
	vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
	render(<KioskApp />);
	await screen.findByRole("button", { name: /Anna Berger/ });
}

async function queued() {
	return (await stores.queue?.list()) ?? [];
}

function submissionOf(body: string) {
	return JSON.parse(body) as KioskFrozenSubmission;
}

describe("offline kiosk clocking (#1292)", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		window.history.replaceState(null, "", "/en/kiosk");
		stores.cache = memoryKioskCacheStorage();
		stores.queue = memoryKioskQueueStorage();
		clocks.monotonic = 0;
		clocks.device = "2026-10-16T08:30:00Z";
		restartClock();
		vi.stubGlobal("crypto", webcrypto);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("queues a clock-out with the PIN sealed for Z8, anchored to the server's time, and says it is not yet confirmed", async () => {
		await openOnline();
		stubNoNetwork();
		setOnline(false);
		expect(screen.getByText(/Clockings are saved on this kiosk/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /Anna Berger/ }));
		await enterPin("2468");

		expect(await screen.findByText(/^Clocked in since 8:30\sAM$/)).toBeTruthy();
		expect(screen.getByText(/^As of 9:45\sAM$/)).toBeTruthy();
		expect(screen.getByText(/saved on this kiosk and not yet confirmed/)).toBeTruthy();
		expect(screen.queryByText(/Today:/)).toBeNull();

		// 15 minutes after the contact, whatever the device clock says.
		clocks.monotonic = 15 * 60_000;
		clocks.device = "2031-01-01T00:00:00Z";
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		expect(await screen.findByText("Clocked out")).toBeTruthy();
		expect(screen.getByText(/^10:00\sAM$/)).toBeTruthy();
		expect(screen.getByText(/Saved on this kiosk, not yet confirmed/)).toBeTruthy();

		const [record] = await queued();
		const submission = submissionOf(record?.body ?? "{}");
		expect(submission.command).toMatchObject({
			version: 1,
			kioskId: kiosk.id,
			employeeId: anna.id,
			action: "clock_out",
			occurredAt: "2026-10-16T08:00:00Z",
			timeSource: "server_anchor",
			timezone: "Europe/Berlin",
			target: { workPeriodId: annaWork },
		});
		expect(submission.contact).toEqual(session.offline?.contact);
		// Nothing on the kiosk can check the PIN; only Z8 can open it.
		expect(record?.body).not.toContain("2468");
		expect(JSON.stringify(await stores.cache?.get("employees"))).not.toContain("2468");
		expect(
			openSealedKioskPin(
				submission.pin,
				{ kioskId: kiosk.id, employeeId: anna.id, operationId: submission.command.operationId },
				SECRET,
			),
		).toBe("2468");
	});

	it("after an offline restart, uses the device clock and shows its own queued clocking", async () => {
		await restartOffline();

		fireEvent.click(screen.getByRole("button", { name: /Ben Özdemir/ }));
		await enterPin("1357");
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
		// Ben's vehicle use is asked: the cached context offers the vehicle step offline.
		expect(await screen.findByText("Vehicle use")).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: "Own vehicle" }));
		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
		expect(await screen.findByText("Clocked in")).toBeTruthy();

		const [record] = await queued();
		expect(submissionOf(record?.body ?? "{}").command).toMatchObject({
			action: "clock_in",
			occurredAt: "2026-10-16T08:30:00Z",
			timeSource: "device_clock",
			vehicleUse: { vehicle: { kind: "own" } },
		});

		fireEvent.click(screen.getByRole("button", { name: "Done" }));
		fireEvent.click(await screen.findByRole("button", { name: /Ben Özdemir/ }));
		await enterPin("1357");
		expect(await screen.findByText(/^Clocked in since 10:30\sAM$/)).toBeTruthy();
		expect(screen.getByText(/includes clockings saved on this kiosk/)).toBeTruthy();
	});

	it("sends the queue in order with the same bytes when the connection is back, and shows refusals", async () => {
		await restartOffline();
		fireEvent.click(screen.getByRole("button", { name: /Anna Berger/ }));
		await enterPin("0000");
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
		fireEvent.click(await screen.findByRole("button", { name: "Done" }));
		clocks.device = "2026-10-16T08:31:00Z";
		fireEvent.click(await screen.findByRole("button", { name: /Ben Özdemir/ }));
		await enterPin("1357");
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
		fireEvent.click(await screen.findByRole("button", { name: "Done" }));
		const stored = (await queued()).map((record) => record.body);
		expect(stored).toHaveLength(2);

		const calls = stubFetch({
			"/api/kiosk/session": () => Response.json(session),
			"/api/kiosk/employees": () => Response.json(listed),
			"POST /api/kiosk/commands": (call) => {
				const { command } = submissionOf(call.body ?? "{}");
				return command.employeeId === anna.id
					? Response.json(
							{ outcome: "refused", operationId: command.operationId, code: "wrong_pin" },
							{ status: 403 },
						)
					: Response.json(
							{ outcome: "executed", operationId: command.operationId, action: command.action },
							{ status: 201 },
						);
			},
		});
		setOnline(true);

		expect(
			await screen.findByText(
				/Anna Berger: Clock out at 10:30\sAM, saved while offline, was not accepted\. The PIN was not accepted\./,
			),
		).toBeTruthy();
		const sent = calls.filter((call) => call.url === "/api/kiosk/commands");
		expect(sent.map((call) => call.body)).toEqual(stored);
		expect(sent.every((call) => call.token === "z8k_device-token")).toBe(true);
		expect(await queued()).toEqual([]);
		expect(screen.queryByText(/Clockings are saved on this kiosk/)).toBeNull();
	});

	it("holds the per-kiosk PIN attempt limit offline", async () => {
		await restartOffline();
		await stores.cache?.put(
			"pinAttempts",
			Array.from({ length: 30 }, () => Date.now() - 1_000),
		);

		fireEvent.click(screen.getByRole("button", { name: /Anna Berger/ }));
		await enterPin("2468");

		expect(await screen.findByText(/Too many PIN attempts at this kiosk/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Clock out" })).toBeNull();
	});

	it("sends its queue once with a token Z8 no longer knows before it forgets the token", async () => {
		await restartOffline();
		fireEvent.click(screen.getByRole("button", { name: /Anna Berger/ }));
		await enterPin("2468");
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
		fireEvent.click(await screen.findByRole("button", { name: "Done" }));
		cleanup();

		const calls = stubFetch({
			"/api/kiosk/session": () => Response.json({ code: "kiosk_unknown" }, { status: 401 }),
			"POST /api/kiosk/commands": (call) =>
				Response.json(
					{
						outcome: "refused",
						operationId: submissionOf(call.body ?? "{}").command.operationId,
						code: "kiosk_rotated",
					},
					{ status: 403 },
				),
		});
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
		render(<KioskApp />);

		expect(await screen.findByLabelText(/Pairing code/)).toBeTruthy();
		const sent = calls.filter((call) => call.url === "/api/kiosk/commands");
		expect(sent.map((call) => call.token)).toEqual(["z8k_device-token"]);
		expect(window.localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY)).toBeNull();
		expect(await queued()).toEqual([]);
	});

	it("still refuses clocking offline once offline mode is off", async () => {
		stubFetch({
			"/api/kiosk/session": () => Response.json({ kiosk: { ...kiosk, offlineMode: false } }),
			"/api/kiosk/employees": () => Response.json({ employees: [anna, ben] }),
		});
		render(<KioskApp />);
		await screen.findByRole("button", { name: /Anna Berger/ });
		stubNoNetwork();
		setOnline(false);

		fireEvent.click(screen.getByRole("button", { name: /Anna Berger/ }));
		const ok = screen.getByRole("button", { name: "OK" }) as HTMLButtonElement;

		expect(ok.disabled).toBe(true);
		expect(screen.getByText(/Clocking is not possible until the connection is back/)).toBeTruthy();
		expect(await queued()).toEqual([]);
		expect(stores.cache?.keys()).toEqual([]);
	});
});
