/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskClockAttemptOutcome,
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

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	usePathname: () => "/kiosk",
	useRouter: () => ({ replace: navigation.replace }),
}));

/**
 * #1363: an online kiosk action whose reply was lost, through the kiosk page
 * with the kiosk endpoints stubbed at `fetch`. The kiosk says it is checking,
 * offers nothing to do again, and asks Z8 what became of the one action.
 */
const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Front door",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Store",
	timezone: "Europe/Berlin",
	boardEnabled: false,
	language: "en",
	offlineMode: false,
};

const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const CHECKING = "Checking whether your action was recorded";
const UNCERTAIN_KEY = "z8.kiosk.uncertainAction";

const clockedOut: KioskEmployeeSnapshot = {
	employee: anna,
	state: { status: "clocked_out" },
	dayTotal: { date: "2026-10-10", timezone: "Europe/Berlin", minutes: 0 },
};

type Call = { url: string; body: Record<string, unknown> | null };
type Route = (call: Call) => Response | Promise<Response>;

function stubFetch(routes: Record<string, Route>) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const call = { url, body: init?.body ? JSON.parse(String(init.body)) : null };
			calls.push(call);
			const route = routes[url];
			return route ? route(call) : Response.json({}, { status: 404 });
		}),
	);
	return calls;
}

function kioskRoutes(extra: Record<string, Route>): Record<string, Route> {
	return {
		"/api/kiosk/session": () => Response.json({ kiosk }),
		"/api/kiosk/employees": () => Response.json({ employees: [anna] }),
		"/api/kiosk/employee-status": () => Response.json(clockedOut),
		...extra,
	};
}

function lostReply(): Response {
	throw new TypeError("Failed to fetch");
}

/** Outcome answers in turn; the last one repeats. */
function answers(...responses: (() => Response)[]): Route {
	return () => (responses.length > 1 ? responses.shift() : responses[0])?.() as Response;
}

const committed = (instant: string): KioskClockAttemptOutcome => ({
	outcome: "committed",
	action: "clock_in",
	at: { instant, zone: "Europe/Berlin" },
});

async function enterPin(digits: string) {
	for (const digit of digits) fireEvent.click(screen.getByRole("button", { name: digit }));
	fireEvent.click(screen.getByRole("button", { name: "OK" }));
}

async function clockIn() {
	render(<KioskApp />);
	fireEvent.click(await screen.findByRole("button", { name: /Anna Berger/ }));
	await screen.findByRole("heading", { name: "Anna Berger" });
	await enterPin("2468");
	fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

function urls(calls: Call[], url: string) {
	return calls.filter((call) => call.url === url);
}

/** Nothing on screen lets the employee act again or switch to the PIN. */
function expectNothingToRepeat() {
	for (const name of ["Clock in", "Clock out", "Start break", "OK", "1"]) {
		expect(screen.queryByRole("button", { name })).toBeNull();
	}
	expect(screen.queryByText(/Nothing was recorded/)).toBeNull();
}

describe("kiosk uncertain action (#1363)", () => {
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
	});

	it("checks a lost reply instead of saying nothing was recorded, then shows the original action and time once", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": lostReply,
				"/api/kiosk/clock/outcome": () => Response.json(committed("2026-10-10T06:30:00Z")),
			}),
		);
		await clockIn();

		expect(await screen.findByRole("heading", { name: CHECKING })).toBeTruthy();
		expect(screen.getByText(/Anna Berger/)).toBeTruthy();
		expectNothingToRepeat();

		await advance(3_500);

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Clocked in")).toBeTruthy();
		expect(within(confirmation).getByText(/^8:30\sAM$/)).toBeTruthy();
		const [sent] = urls(calls, "/api/kiosk/clock");
		const [asked] = urls(calls, "/api/kiosk/clock/outcome");
		expect(asked?.body).toEqual({
			operationId: sent?.body?.operationId,
			employeeId: anna.id,
			action: "clock_in",
		});
		// The lookup carries no PIN, and the action was sent once.
		expect(asked?.body).not.toHaveProperty("pin");
		expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
		expect(window.localStorage.getItem(UNCERTAIN_KEY)).toBeNull();

		await advance(10_500);
		expect(await screen.findByRole("searchbox", { name: "Find your name" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/clock/outcome")).toHaveLength(1);
	});

	it.each([
		["a server error without a Z8 answer", () => new Response("Bad gateway", { status: 502 })],
		["an unconfirmed commit", () => Response.json({ code: "unconfirmed" }, { status: 503 })],
	])("treats %s as uncertain", async (_case, reply) => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": reply,
				"/api/kiosk/clock/outcome": () => Response.json(committed("2026-10-10T06:30:00Z")),
			}),
		);
		await clockIn();

		expect(await screen.findByRole("heading", { name: CHECKING })).toBeTruthy();
		expectNothingToRepeat();
	});

	it("asks for a fresh, explicit action once Z8 confirms nothing was recorded", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": answers(lostReply, () =>
					Response.json({
						...clockedOut,
						state: { status: "clocked_in", workPeriodId: "wp-1", since: "2026-10-10T06:31:00Z" },
						outcome: "executed",
						action: "clock_in",
						at: { instant: "2026-10-10T06:31:00Z", zone: "Europe/Berlin" },
					}),
				),
				"/api/kiosk/clock/outcome": () =>
					Response.json({ outcome: "not_recorded" } satisfies KioskClockAttemptOutcome),
			}),
		);
		await clockIn();
		await screen.findByRole("heading", { name: CHECKING });

		await advance(3_500);

		expect(
			await screen.findByText("Your action was not recorded. Enter your PIN to choose it again."),
		).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		// Polling and waiting never send the old action again.
		await advance(20_000);
		expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
		expect(urls(calls, "/api/kiosk/clock/outcome")).toHaveLength(1);

		await enterPin("2468");
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
		expect(await screen.findByRole("status", { name: "Done" })).toBeTruthy();
		const [first, fresh] = urls(calls, "/api/kiosk/clock");
		expect(fresh?.body?.operationId).toMatch(/^[0-9a-f-]{36}$/);
		expect(fresh?.body?.operationId).not.toBe(first?.body?.operationId);
	});

	it("keeps checking while Z8 cannot answer, never returns home on its own, and resolves after reconnecting", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": lostReply,
				"/api/kiosk/clock/outcome": answers(
					lostReply,
					() => Response.json({ code: "failed" }, { status: 503 }),
					() => Response.json(committed("2026-10-10T06:30:00Z")),
				),
			}),
		);
		await clockIn();
		await screen.findByRole("heading", { name: CHECKING });
		await advance(3_500);

		expect(await screen.findByText(/cannot be reached right now/)).toBeTruthy();
		expect(screen.getByRole("heading", { name: CHECKING })).toBeTruthy();
		expectNothingToRepeat();

		await advance(5_500);
		expect(urls(calls, "/api/kiosk/clock/outcome")).toHaveLength(2);
		expect(screen.getByRole("heading", { name: CHECKING })).toBeTruthy();

		await advance(5_500);
		expect(await screen.findByRole("status", { name: "Done" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
	});

	it("holds the turn past the idle timeout while the action is unresolved", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": lostReply,
				"/api/kiosk/clock/outcome": () => Response.json({ code: "failed" }, { status: 503 }),
			}),
		);
		await clockIn();
		await screen.findByRole("heading", { name: CHECKING });

		for (let second = 0; second < 35; second += 5) await advance(5_000);

		expect(screen.getByRole("heading", { name: CHECKING })).toBeTruthy();
		expect(screen.queryByRole("searchbox", { name: "Find your name" })).toBeNull();
		expectNothingToRepeat();
		expect(urls(calls, "/api/kiosk/clock/outcome").length).toBeGreaterThan(3);
		expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
	});

	it("keeps the action's identity through a page reload, without the PIN, and resolves it there", async () => {
		const calls = stubFetch(
			kioskRoutes({
				// The page goes away while the action is on its way.
				"/api/kiosk/clock": () => new Promise<Response>(() => undefined),
				"/api/kiosk/clock/outcome": () => Response.json(committed("2026-10-10T06:30:00Z")),
			}),
		);
		await clockIn();
		await vi.waitFor(() => expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1));
		const stored = window.localStorage.getItem(UNCERTAIN_KEY) ?? "";
		// Only what names the action: never the PIN or a command that could be sent again.
		expect(Object.keys(JSON.parse(stored)).sort()).toEqual(
			["action", "employee", "kioskId", "operationId", "request", "submittedAt", "version"].sort(),
		);
		expect(stored).not.toContain("2468");

		cleanup();
		render(<KioskApp />);

		expect(await screen.findByRole("heading", { name: CHECKING })).toBeTruthy();
		expectNothingToRepeat();
		await advance(3_500);

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Anna Berger")).toBeTruthy();
		expect(within(confirmation).getByText(/^8:30\sAM$/)).toBeTruthy();
		const [sent] = urls(calls, "/api/kiosk/clock");
		expect(urls(calls, "/api/kiosk/clock/outcome")[0]?.body?.operationId).toBe(
			sent?.body?.operationId,
		);
		expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
		expect(window.localStorage.getItem(UNCERTAIN_KEY)).toBeNull();
	});

	it("says when the action cannot be checked here and lets the employee go back", async () => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": lostReply,
				"/api/kiosk/clock/outcome": () =>
					Response.json({ outcome: "conflict" } satisfies KioskClockAttemptOutcome),
			}),
		);
		await clockIn();
		await screen.findByRole("heading", { name: CHECKING });
		await advance(3_500);

		expect((await screen.findByRole("alert")).textContent).toMatch(/could not be checked/);
		expect(screen.queryByText(/Nothing was recorded/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Back" }));
		expect(await screen.findByRole("searchbox", { name: "Find your name" })).toBeTruthy();
		expect(window.localStorage.getItem(UNCERTAIN_KEY)).toBeNull();
	});

	it("forgets the action once Z8 answered it, so a reload shows the home screen", async () => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": () =>
					Response.json({ code: "already_clocked_in", ...clockedOut }, { status: 409 }),
			}),
		);
		await clockIn();

		expect(await screen.findByText("You are already clocked in.")).toBeTruthy();
		expect(window.localStorage.getItem(UNCERTAIN_KEY)).toBeNull();
	});
});
