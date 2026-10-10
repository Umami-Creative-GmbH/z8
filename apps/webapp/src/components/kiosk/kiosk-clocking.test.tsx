/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskClockResult,
	type KioskDeviceInfo,
	type KioskEmployeeSnapshot,
} from "@/lib/time-tracking/kiosk/protocol";
import { KioskApp } from "./kiosk-app";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));

const navigation = vi.hoisted(() => ({ locale: "en", replace: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => navigation.locale }));
vi.mock("@/navigation", () => ({
	usePathname: () => "/kiosk",
	useRouter: () => ({ replace: navigation.replace }),
}));

/**
 * #862: the kiosk home screen, PIN entry and clocking, driven through the
 * kiosk page with the kiosk endpoints stubbed at `fetch`.
 */
const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Front door",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Store",
	timezone: "Europe/Berlin",
	boardEnabled: false,
	language: "en",
};

const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const ben = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ben Özdemir" };

const dayTotal = { date: "2026-10-10", timezone: "Europe/Berlin", todayMinutes: 0 };

function snapshot(state: KioskEmployeeSnapshot["state"], todayMinutes = 0): KioskEmployeeSnapshot {
	return { employee: anna, state, dayTotal: { ...dayTotal, todayMinutes } };
}

type Call = { url: string; init: RequestInit | undefined; body: Record<string, unknown> | null };
type Route = (call: Call) => Response | Promise<Response>;

function stubFetch(routes: Record<string, Route>) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const call = { url, init, body: init?.body ? JSON.parse(String(init.body)) : null };
			calls.push(call);
			const route = routes[url];
			return route ? route(call) : Response.json({}, { status: 404 });
		}),
	);
	return calls;
}

function kioskRoutes(extra: Record<string, Route> = {}): Record<string, Route> {
	return {
		"/api/kiosk/session": () => Response.json({ kiosk }),
		"/api/kiosk/employees": () => Response.json({ employees: [anna, ben] }),
		...extra,
	};
}

function header(init: RequestInit | undefined, name: string): string | null {
	return new Headers(init?.headers).get(name);
}

async function openHome() {
	render(<KioskApp />);
	return screen.findByRole("button", { name: /Anna Berger/ });
}

async function enterPin(digits: string) {
	for (const digit of digits) {
		fireEvent.click(screen.getByRole("button", { name: digit }));
	}
	fireEvent.click(screen.getByRole("button", { name: "OK" }));
}

describe("kiosk clocking screen (#862)", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		window.history.replaceState(null, "", "/en/kiosk");
		navigation.locale = "en";
		navigation.replace.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("lists the kiosk's employees on its home screen and finds them by name", async () => {
		const calls = stubFetch(kioskRoutes());

		await openHome();

		expect(screen.getByText("Front door")).toBeTruthy();
		expect(screen.getByText("Store")).toBeTruthy();
		const listCall = calls.find((call) => call.url === "/api/kiosk/employees");
		expect(header(listCall?.init, "x-kiosk-token")).toBe("z8k_device-token");

		fireEvent.change(screen.getByRole("searchbox", { name: "Find your name" }), {
			target: { value: "özd" },
		});
		expect(screen.queryByRole("button", { name: /Anna Berger/ })).toBeNull();
		expect(screen.getByRole("button", { name: /Ben Özdemir/ })).toBeTruthy();
	});

	it("clocks in after a verified PIN, confirms name, action and time, and returns home after about 10 seconds", async () => {
		const clockedIn: KioskClockResult = {
			...snapshot({ status: "clocked_in", workPeriodId: "wp-1", since: "2026-10-10T06:30:00Z" }),
			outcome: "executed",
			action: "clock_in",
		};
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/employee-status": () => Response.json(snapshot({ status: "clocked_out" }, 0)),
				"/api/kiosk/clock": () => Response.json(clockedIn),
			}),
		);
		fireEvent.click(await openHome());

		expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		await enterPin("2468");

		expect(await screen.findByText("Not clocked in")).toBeTruthy();
		expect(screen.getByText(/Today: 0 min/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Clock out" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Start break" })).toBeNull();
		expect(calls.find((call) => call.url === "/api/kiosk/employee-status")?.body).toEqual({
			employeeId: anna.id,
			pin: "2468",
		});

		vi.useFakeTimers({ shouldAdvanceTime: true });
		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Anna Berger")).toBeTruthy();
		expect(within(confirmation).getByText("Clocked in")).toBeTruthy();
		expect(within(confirmation).getByText(/^8:30\sAM$/)).toBeTruthy();
		const clockCall = calls.find((call) => call.url === "/api/kiosk/clock");
		expect(clockCall?.body).toMatchObject({ employeeId: anna.id, pin: "2468", action: "clock_in" });
		expect(clockCall?.body?.operationId).toMatch(/^[0-9a-f-]{36}$/);
		expect(header(clockCall?.init, "x-kiosk-token")).toBe("z8k_device-token");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_500);
		});
		expect(await screen.findByRole("searchbox", { name: "Find your name" })).toBeTruthy();
		expect(screen.queryByText("Clocked in")).toBeNull();
		expect(screen.queryByRole("heading", { name: "Anna Berger" })).toBeNull();
	});

	const clockedIn = {
		status: "clocked_in",
		workPeriodId: "wp-1",
		since: "2026-10-10T06:30:00Z",
	} as const;
	const onBreak = {
		status: "on_break",
		workPeriodId: "wp-1",
		since: "2026-10-10T06:30:00Z",
		breakSince: "2026-10-10T10:00:00Z",
		breakZone: "Europe/Berlin",
	} as const;

	async function turnWith(
		before: KioskEmployeeSnapshot,
		after: KioskEmployeeSnapshot,
		action: KioskClockResult["action"],
	) {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/employee-status": () => Response.json(before),
				"/api/kiosk/clock": () =>
					Response.json({ ...after, outcome: "executed", action } satisfies KioskClockResult),
			}),
		);
		fireEvent.click(await openHome());
		await screen.findByRole("heading", { name: "Anna Berger" });
		await enterPin("2468");
		return calls;
	}

	function clockActions(calls: Call[]) {
		return calls.filter((call) => call.url === "/api/kiosk/clock").map((call) => call.body?.action);
	}

	it("offers break and clock-out to a clocked-in employee and starts a break", async () => {
		const calls = await turnWith(
			snapshot(clockedIn, 200),
			snapshot({ ...onBreak, breakSince: "2026-10-10T09:45:00Z" }, 195),
			"start_break",
		);

		expect(await screen.findByText(/^Clocked in since 8:30\sAM$/)).toBeTruthy();
		expect(screen.getByText("Today: 3 hr 20 min")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
		expect(screen.getByRole("button", { name: "Clock out" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Start break" }));

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Break started")).toBeTruthy();
		expect(within(confirmation).getByText(/^11:45\sAM$/)).toBeTruthy();
		expect(clockActions(calls)).toEqual(["start_break"]);
	});

	it("resumes work from a break in progress", async () => {
		const calls = await turnWith(
			snapshot(onBreak, 210),
			snapshot({ ...clockedIn, workPeriodId: "wp-2", since: "2026-10-10T10:20:00Z" }, 210),
			"resume_break",
		);

		expect(await screen.findByText(/^On break since 12:00\sPM$/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Resume work" }));

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Back to work")).toBeTruthy();
		expect(within(confirmation).getByText(/^12:20\sPM$/)).toBeTruthy();
		expect(clockActions(calls)).toEqual(["resume_break"]);
	});

	it("ends the day while on a break at the break's start", async () => {
		const calls = await turnWith(
			snapshot(onBreak, 210),
			snapshot({ status: "clocked_out" }, 210),
			"clock_out",
		);

		await screen.findByText(/^On break since/);
		expect(screen.queryByRole("button", { name: "Clock out" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "End day" }));

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Day ended")).toBeTruthy();
		expect(within(confirmation).getByText(/^12:00\sPM$/)).toBeTruthy();
		expect(within(confirmation).getByText(/ended at the start of your break/)).toBeTruthy();
		expect(clockActions(calls)).toEqual(["clock_out"]);
	});

	it("clocks out and returns home at once on a tap", async () => {
		const calls = await turnWith(
			snapshot(clockedIn, 200),
			snapshot({ status: "clocked_out" }, 200),
			"clock_out",
		);

		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Clocked out")).toBeTruthy();
		expect(clockActions(calls)).toEqual(["clock_out"]);

		fireEvent.click(within(confirmation).getByText("Anna Berger"));
		expect(await screen.findByRole("searchbox", { name: "Find your name" })).toBeTruthy();
		expect(screen.queryByText("Clocked out")).toBeNull();
	});

	it("explains a wrong PIN and a lockout, with the time the lock ends, and clocks nothing", async () => {
		const answers = [
			Response.json({ code: "wrong_pin" }, { status: 403 }),
			Response.json({ code: "pin_locked", lockedUntil: "2026-10-10T07:15:00Z" }, { status: 423 }),
		];
		const calls = stubFetch(
			kioskRoutes({ "/api/kiosk/employee-status": () => answers.shift() as Response }),
		);
		fireEvent.click(await openHome());
		await screen.findByRole("heading", { name: "Anna Berger" });

		await enterPin("1111");
		expect((await screen.findByRole("alert")).textContent).toBe(
			"That PIN is not correct. Try again.",
		);
		expect(screen.getByRole("status", { name: "0 digits entered" })).toBeTruthy();

		await enterPin("2222");
		expect(await screen.findByText(/locked until 9:15\sAM/)).toBeTruthy();
		expect(screen.queryByText(/attempts/i)).toBeNull();
		expect(clockActions(calls)).toEqual([]);
		expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
	});

	it("says it is offline and refuses clocking without sending anything", async () => {
		const calls = stubFetch(kioskRoutes());
		fireEvent.click(await openHome());
		await screen.findByRole("heading", { name: "Anna Berger" });

		const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
		await act(async () => {
			window.dispatchEvent(new Event("offline"));
		});
		expect(screen.getByText(/The kiosk is offline\. Clocking is not possible/)).toBeTruthy();
		for (const digit of "2468") fireEvent.click(screen.getByRole("button", { name: digit }));
		expect((screen.getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
		onLine.mockRestore();

		expect(calls.map((call) => call.url)).not.toContain("/api/kiosk/employee-status");
		expect(clockActions(calls)).toEqual([]);
	});

	it("refuses clocking when the connection drops during the turn, and never queues it", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/employee-status": () => Response.json(snapshot({ status: "clocked_out" })),
				"/api/kiosk/clock": () => {
					throw new TypeError("Failed to fetch");
				},
			}),
		);
		fireEvent.click(await openHome());
		await screen.findByRole("heading", { name: "Anna Berger" });
		await enterPin("2468");
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		expect(await screen.findByText(/offline\. Nothing was recorded/)).toBeTruthy();
		expect(screen.queryByRole("status", { name: "Done" })).toBeNull();
		expect(clockActions(calls)).toEqual(["clock_in"]);
	});

	it("shows the revoked screen when the kiosk is revoked during a turn", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/employee-status": () =>
					Response.json({ code: "kiosk_revoked" }, { status: 401 }),
			}),
		);
		fireEvent.click(await openHome());
		await screen.findByRole("heading", { name: "Anna Berger" });
		await enterPin("2468");

		expect(await screen.findByText(/contact your admin/i)).toBeTruthy();
		expect(screen.queryByText("Anna Berger")).toBeNull();
		expect(clockActions(calls)).toEqual([]);
	});

	it("explains a Clocking refusal and shows the state the server reports", async () => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/employee-status": () => Response.json(snapshot({ status: "clocked_out" })),
				"/api/kiosk/clock": () =>
					Response.json(
						{ code: "already_clocked_in", ...snapshot(clockedIn, 30) },
						{ status: 409 },
					),
			}),
		);
		fireEvent.click(await openHome());
		await screen.findByRole("heading", { name: "Anna Berger" });
		await enterPin("2468");
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		expect(await screen.findByText("You are already clocked in.")).toBeTruthy();
		expect(screen.getByText(/^Clocked in since 8:30\sAM$/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Clock out" })).toBeTruthy();
	});

	it("opens in the organization's language and goes back to it after a turn in another one", async () => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/session": () => Response.json({ kiosk: { ...kiosk, language: "de" } }),
			}),
		);
		await openHome();
		expect(navigation.replace).toHaveBeenCalledWith("/kiosk", { locale: "de" });

		cleanup();
		navigation.replace.mockReset();
		window.sessionStorage.setItem("z8.kiosk.languageChoice", "en");
		stubFetch(
			kioskRoutes({
				"/api/kiosk/session": () => Response.json({ kiosk: { ...kiosk, language: "de" } }),
			}),
		);
		fireEvent.click(await openHome());
		expect(navigation.replace).not.toHaveBeenCalled();
		fireEvent.click(await screen.findByRole("button", { name: /Not you/ }));
		expect(navigation.replace).toHaveBeenCalledWith("/kiosk", { locale: "de" });
		expect(window.sessionStorage.getItem("z8.kiosk.languageChoice")).toBeNull();
	});
});
