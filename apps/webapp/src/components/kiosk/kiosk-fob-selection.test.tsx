/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KIOSK_TOKEN_STORAGE_KEY, type KioskDeviceInfo } from "@/lib/time-tracking/kiosk/protocol";
import {
	advance,
	anna,
	ben,
	clockedOut,
	kiosk,
	openHome,
	pressPin,
	type Route,
	readKeys,
	SERIAL,
	kioskRoutes as sessionRoutes,
	stubFetch,
	TYPED_SERIAL,
	urls,
} from "./kiosk-fob.test-utils";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	usePathname: () => "/kiosk",
	useRouter: () => ({ replace: navigation.replace }),
}));

/**
 * #1506: a registered kiosk fob read on the home screen selects its employee
 * in place of picking a name, and opens their kiosk PIN entry. From there the
 * turn is name-and-PIN kiosk clocking, unchanged: the PIN proves, never the
 * fob. Through the kiosk page with the kiosk endpoints stubbed at `fetch`; the
 * attached reader types the chip's serial number as a fast burst ending in Enter.
 */
const UNCERTAIN_KEY = "z8.kiosk.uncertainAction";

/** The kiosk's routes, a fob that selects Anna unless `extra` says otherwise. */
function kioskRoutes(
	extra: Record<string, Route> = {},
	device: KioskDeviceInfo = kiosk,
): Record<string, Route> {
	return sessionRoutes(
		{ "/api/kiosk/fob": () => Response.json({ outcome: "employee", employee: anna }), ...extra },
		device,
	);
}
/** From a recognised fob on the home screen to Anna's PIN entry. */
async function tapFob() {
	readKeys(TYPED_SERIAL);
	expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
	expect(screen.getByText("Enter your kiosk PIN")).toBeTruthy();
}

describe("kiosk fob selects the employee for PIN entry (#1506)", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		window.history.replaceState(null, "", "/en/kiosk");
		navigation.replace.mockReset();
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("opens the fob's employee's PIN entry, and their PIN opens exactly the name-and-PIN turn", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();

		await tapFob();

		expect(urls(calls, "/api/kiosk/fob").map((call) => call.body)).toEqual([{ serial: SERIAL }]);
		// Selecting checked no PIN and opened nothing yet.
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
		expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Register this fob" })).toBeNull();

		pressPin("4711");

		expect(await screen.findByRole("button", { name: "Clock in" })).toBeTruthy();
		// The same call a name pick makes: the employee and their PIN, never the fob.
		expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
			{ employeeId: anna.id, pin: "4711" },
		]);
		expect(JSON.stringify(window.localStorage)).not.toContain(SERIAL);
		expect(document.body.textContent).not.toContain(SERIAL);
	});

	it("proves with the PIN on every action of the turn, never the fob", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": () =>
					Response.json({
						...clockedOut,
						state: { status: "clocked_in", workPeriodId: "wp-1", since: "2026-11-02T07:00:00Z" },
						outcome: "executed",
						action: "clock_in",
						at: { instant: "2026-11-02T07:00:00Z", zone: "Europe/Berlin" },
					}),
			}),
		);
		await openHome();
		await tapFob();
		pressPin("4711");
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		expect(await screen.findByRole("status", { name: "Done" })).toBeTruthy();
		const [sent] = urls(calls, "/api/kiosk/clock");
		expect(sent?.body).toMatchObject({ employeeId: anna.id, pin: "4711", action: "clock_in" });
		expect(sent?.body).not.toHaveProperty("serial");
		expect(sent?.body).not.toHaveProperty("badge");
	});

	it("asks for the PIN again after a wrong one, and says when the PIN is locked", async () => {
		let attempts = 0;
		stubFetch(
			kioskRoutes({
				"/api/kiosk/employee-status": () =>
					++attempts === 1
						? Response.json({ code: "wrong_pin" }, { status: 403 })
						: Response.json(
								{ code: "pin_locked", lockedUntil: "2026-11-02T08:15:00Z" },
								{ status: 423 },
							),
			}),
		);
		await openHome();
		await tapFob();

		pressPin("0000");
		expect(await screen.findByText("That PIN is not correct. Try again.")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Anna Berger" })).toBeTruthy();

		pressPin("0000");
		expect(await screen.findByText(/Your PIN is locked until/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
	});

	it("ignores a fob read during the PIN entry: no digit reaches the PIN pad and nothing is looked up", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		await tapFob();

		readKeys("1A2B3C4D");
		await advance(300);

		expect(urls(calls, "/api/kiosk/fob")).toHaveLength(1);
		expect(screen.getByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(screen.getByLabelText("0 digits entered")).toBeTruthy();
		pressPin("4711");
		expect(await screen.findByRole("button", { name: "Clock in" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
			{ employeeId: anna.id, pin: "4711" },
		]);
	});

	it("ignores a fob read during an employee's turn, even another employee's fob", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/fob": ({ body }) =>
					Response.json({
						outcome: "employee",
						employee: body?.serial === SERIAL ? anna : ben,
					}),
			}),
		);
		await openHome();
		await tapFob();
		pressPin("4711");
		await screen.findByRole("button", { name: "Clock in" });

		readKeys("1A2B3C4D");
		await advance(300);

		expect(urls(calls, "/api/kiosk/fob")).toHaveLength(1);
		expect(screen.getByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Clock in" })).toBeTruthy();
	});

	it("holds an employee whose action is unresolved, as a name pick does: no PIN pad", async () => {
		window.localStorage.setItem(
			UNCERTAIN_KEY,
			JSON.stringify([
				{
					version: 1,
					kioskId: kiosk.id,
					operationId: "33333333-3333-4333-8333-333333333333",
					employee: anna,
					action: "clock_in",
					request: "clock_in",
				},
			]),
		);
		stubFetch(
			kioskRoutes({
				"/api/kiosk/clock/outcome": () => Response.json({ code: "failed" }, { status: 503 }),
			}),
		);
		await openHome();

		readKeys(TYPED_SERIAL);

		expect(
			await screen.findByRole("heading", { name: "Checking whether your action was recorded" }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
	});

	it("at an offline-mode kiosk without a connection, says fobs need one, points to name and PIN, and queues nothing", async () => {
		const calls = stubFetch(kioskRoutes({}, { ...kiosk, offlineMode: true }));
		await openHome();
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
		act(() => {
			window.dispatchEvent(new Event("offline"));
		});

		readKeys(TYPED_SERIAL);

		expect(
			await screen.findByText(
				"Fobs need a connection. Nothing was recorded. Tap your name to use your PIN.",
			),
		).toBeTruthy();
		expect(urls(calls, "/api/kiosk/fob")).toEqual([]);
		expect(screen.queryByRole("heading", { name: "Anna Berger" })).toBeNull();
		expect(screen.getByRole("searchbox", { name: "Find your name" })).toBeTruthy();
	});

	it("at a kiosk without offline mode, says fobs need a connection without offering the PIN", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
		act(() => {
			window.dispatchEvent(new Event("offline"));
		});

		readKeys(TYPED_SERIAL);

		expect(await screen.findByText("Fobs need a connection. Nothing was recorded.")).toBeTruthy();
		expect(screen.queryByText(/Tap your name to use your PIN/)).toBeNull();
		expect(urls(calls, "/api/kiosk/fob")).toEqual([]);
	});
});
