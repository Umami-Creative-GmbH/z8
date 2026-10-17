/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskClockAttemptOutcome,
	type KioskClockResult,
	type KioskDeviceInfo,
	type KioskEmployeeSnapshot,
	type KioskVehicleUse,
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
 * #1366: kiosk badges read by an attached keyboard-style QR scanner, through the
 * kiosk page with the kiosk endpoints stubbed at `fetch`. The scanner is a fast
 * burst of key presses ending in Enter, as such scanners type; people type
 * slower. A scan on the home screen opens the badge's employee without a PIN;
 * nothing else on the kiosk reacts to a scan.
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
	badgeScannerEnabled: true,
};

const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const ben = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ben Özdemir" };
/** What an issued badge's QR code holds (`K8B` and 53 characters of the badge alphabet). */
const BADGE = "K8B0123456789ABCDEFGHJKMNPQRSTVWX0123456789ABCDEFGHJKMNP";
const OTHER_BADGE = "K8BXWVTSRQPNMKJHGFEDCBA9876543210XWVTSRQPNMKJHGFEDCBA987";
const UNCERTAIN_KEY = "z8.kiosk.uncertainAction";

const dayTotal = { date: "2026-10-10", timezone: "Europe/Berlin", minutes: 0 };
const clockedOut: KioskEmployeeSnapshot = {
	employee: anna,
	state: { status: "clocked_out" },
	dayTotal,
};
const clockedIn: KioskClockResult = {
	employee: anna,
	state: { status: "clocked_in", workPeriodId: "wp-1", since: "2026-10-10T06:30:00Z" },
	dayTotal,
	outcome: "executed",
	action: "clock_in",
	at: { instant: "2026-10-10T06:30:00Z", zone: "Europe/Berlin" },
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

function kioskRoutes(
	extra: Record<string, Route> = {},
	device: KioskDeviceInfo = kiosk,
): Record<string, Route> {
	return {
		"/api/kiosk/session": () => Response.json({ kiosk: device }),
		"/api/kiosk/employees": () => Response.json({ employees: [anna, ben] }),
		"/api/kiosk/employee-status": () => Response.json(clockedOut),
		"/api/kiosk/clock": () => Response.json(clockedIn),
		...extra,
	};
}

function urls(calls: Call[], url: string) {
	return calls.filter((call) => call.url === url);
}

/**
 * A keyboard-style scanner reading `text`: one key press per character, with
 * Shift for capitals, all at once, then Enter. Keys reach the focused control
 * (or the page) unless the kiosk took them.
 */
function scanKeys(text: string, end: string | null = "Enter") {
	const target = document.activeElement ?? document.body;
	for (const key of text) {
		const capital = key !== key.toLowerCase();
		if (capital) fireEvent.keyDown(target, { key: "Shift", shiftKey: true });
		const typed = fireEvent.keyDown(target, { key, shiftKey: capital });
		if (typed && target instanceof HTMLInputElement && target.type === "search") {
			fireEvent.change(target, { target: { value: target.value + key } });
		}
	}
	if (end) fireEvent.keyDown(target, { key: end });
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

/** A person typing into the search box, a key at a time. */
async function typeSlowly(input: HTMLInputElement, text: string) {
	for (const key of text) {
		fireEvent.keyDown(input, { key });
		fireEvent.change(input, { target: { value: input.value + key } });
		await advance(250);
	}
}

async function openHome() {
	render(<KioskApp />);
	await screen.findByRole("button", { name: /Anna Berger/ });
}

describe("kiosk badge clocking with an attached scanner (#1366)", () => {
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

	it("opens the badge's employee without a PIN, clocks in on an explicit action and returns home", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		expect(screen.getByText("Or scan your kiosk badge at the scanner.")).toBeTruthy();

		scanKeys(BADGE);

		expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(screen.queryByText("Enter your kiosk PIN")).toBeNull();
		expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
			{ badge: BADGE },
		]);
		// The scan alone recorded nothing.
		expect(urls(calls, "/api/kiosk/clock")).toEqual([]);

		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Clocked in")).toBeTruthy();
		const [sent] = urls(calls, "/api/kiosk/clock");
		expect(sent?.body).toEqual({
			employeeId: anna.id,
			badge: BADGE,
			action: "clock_in",
			operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
		});
		expect(JSON.stringify(window.localStorage)).not.toContain(BADGE);

		await advance(10_500);
		expect(await screen.findByRole("searchbox", { name: "Find your name" })).toBeTruthy();
	});

	it("reads a scanner whose keys reach the focused search box, and takes them back out of it", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Find your name" });
		search.focus();
		await typeSlowly(search, "Be");

		// A product's barcode is no badge: the search keeps what the person typed.
		scanKeys("4006381333931");

		expect(
			await screen.findByText(
				"This code is not a kiosk badge. Nothing was recorded. Scan your kiosk badge, or tap your name to use your PIN.",
			),
		).toBeTruthy();
		expect(search.value).toBe("Be");
		expect(screen.getByRole("button", { name: /Ben Özdemir/ })).toBeTruthy();

		scanKeys(BADGE);

		expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
			{ badge: BADGE },
		]);
	});

	it("leaves ordinary typing in the search box alone", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Find your name" });
		search.focus();

		await typeSlowly(search, "ozd");
		fireEvent.keyDown(search, { key: "Enter" });

		expect(search.value).toBe("ozd");
		expect(screen.getByRole("button", { name: /Ben Özdemir/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Anna Berger/ })).toBeNull();
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
	});

	it("never opens a scanned code that is no kiosk badge", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();

		scanKeys("https://example.test/en/kiosk?code=ABCDE-FGHJK");

		expect(
			await screen.findByText(
				"This code is not a kiosk badge. Nothing was recorded. Scan your kiosk badge, or tap your name to use your PIN.",
			),
		).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
		expect(`${window.location.pathname}${window.location.search}`).toBe("/en/kiosk");
		expect(navigation.replace).not.toHaveBeenCalled();
	});

	it("listens to no scanner while the kiosk's scanner input is off", async () => {
		const calls = stubFetch(kioskRoutes({}, { ...kiosk, badgeScannerEnabled: false }));
		await openHome();
		expect(screen.queryByText("Or scan your kiosk badge at the scanner.")).toBeNull();

		scanKeys(BADGE);
		await advance(500);

		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
		expect(screen.getByRole("button", { name: /Anna Berger/ })).toBeTruthy();
	});

	it("ignores further scans during the turn: no other employee, no action", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		scanKeys(BADGE);
		await screen.findByRole("heading", { name: "Anna Berger" });

		// Another badge while Anna's turn is open, with her action's button focused.
		screen.getByRole("button", { name: "Clock in" }).focus();
		scanKeys(OTHER_BADGE);
		await advance(500);

		expect(screen.getByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toHaveLength(1);
		expect(urls(calls, "/api/kiosk/clock")).toEqual([]);

		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
		await screen.findByRole("status", { name: "Done" });
		scanKeys(OTHER_BADGE);
		await advance(500);
		expect(screen.getByRole("status", { name: "Done" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toHaveLength(1);
		expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
	});

	it("keeps the name-and-PIN way, and a scan never types into the PIN pad", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		fireEvent.click(screen.getByRole("button", { name: /Anna Berger/ }));
		await screen.findByText("Enter your kiosk PIN");
		fireEvent.keyDown(window, { key: "2" });
		await advance(200);
		fireEvent.keyDown(window, { key: "4" });
		await advance(200);

		scanKeys(BADGE);
		await advance(500);

		expect(screen.getByRole("status", { name: "2 digits entered" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);

		for (const key of ["6", "8"]) {
			await advance(200);
			fireEvent.keyDown(window, { key });
		}
		await advance(200);
		fireEvent.keyDown(window, { key: "Enter" });
		await screen.findByRole("button", { name: "Clock in" });
		expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
			{ employeeId: anna.id, pin: "2468" },
		]);
	});

	it("keeps any scanned code out of the PIN pad: a product barcode and its Enter enter and submit nothing", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		fireEvent.click(screen.getByRole("button", { name: /Anna Berger/ }));
		await screen.findByText("Enter your kiosk PIN");

		scanKeys("4006381333931");
		await advance(500);

		expect(screen.getByRole("status", { name: "0 digits entered" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);

		// The pad is untouched: the person's own PIN is all it holds.
		for (const key of ["2", "4", "6", "8"]) {
			fireEvent.keyDown(window, { key });
			await advance(200);
		}
		fireEvent.keyDown(window, { key: "Enter" });
		await screen.findByRole("button", { name: "Clock in" });
		expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
			{ employeeId: anna.id, pin: "2468" },
		]);
	});

	it("keeps any scanned code from pressing a focused action button", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		scanKeys(BADGE);
		await screen.findByRole("heading", { name: "Anna Berger" });
		await advance(500);

		const action = screen.getByRole("button", { name: "Clock in" });
		const reached: string[] = [];
		action.addEventListener("keydown", (event) => {
			// Shift, which the scanner presses for capitals, types nothing.
			if (event.key !== "Shift") reached.push(event.key);
		});
		action.focus();
		scanKeys("4006381333931");
		scanKeys("https://example.test/a b", "Tab");
		await advance(500);

		expect(screen.getByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/clock")).toEqual([]);
		// Not one key of either scan, Enter and Tab included, reached the button.
		expect(reached).toEqual([]);
		expect(document.activeElement).toBe(action);
	});

	it("keeps a scan on the home screen from the focused control: the language stays as it is", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		const language = screen.getByRole("combobox", { name: "Select language" });
		const reached: string[] = [];
		language.addEventListener("keydown", (event) => {
			// Shift, which the scanner presses for capitals, types nothing.
			if (event.key !== "Shift") reached.push(event.key);
		});
		language.focus();

		scanKeys("DE-4006381333931");
		await advance(500);

		expect(
			await screen.findByText(
				"This code is not a kiosk badge. Nothing was recorded. Scan your kiosk badge, or tap your name to use your PIN.",
			),
		).toBeTruthy();
		expect(navigation.replace).not.toHaveBeenCalled();
		// No typeahead: the scan's keys never reached the language switch.
		expect(reached).toEqual([]);
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
	});

	it("says a refused badge names nobody and lets the next scan try again", async () => {
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/employee-status": ({ body }) =>
					body?.badge === OTHER_BADGE
						? Response.json({ code: "badge_not_accepted" }, { status: 403 })
						: Response.json(clockedOut),
			}),
		);
		await openHome();

		scanKeys(OTHER_BADGE);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/This badge is not accepted at this kiosk/);
		expect(alert.textContent).not.toMatch(/Anna|Ben/);

		scanKeys(BADGE);
		expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toHaveLength(2);
	});

	it("ends the turn when Z8 no longer accepts the badge at the action", async () => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/clock": () => Response.json({ code: "badge_not_accepted" }, { status: 403 }),
			}),
		);
		await openHome();
		scanKeys(BADGE);
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		expect(await screen.findByText(/This badge is not accepted at this kiosk/)).toBeTruthy();
		expect(screen.getByRole("searchbox", { name: "Find your name" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Anna Berger" })).toBeNull();
	});

	it("explains offline that badge clocking needs a connection, and sends or queues nothing", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
		act(() => {
			window.dispatchEvent(new Event("offline"));
		});

		scanKeys(BADGE);

		expect(
			await screen.findByText("Badge clocking needs a connection. Nothing was recorded."),
		).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
		expect(urls(calls, "/api/kiosk/clock")).toEqual([]);
		expect(urls(calls, "/api/kiosk/commands")).toEqual([]);
	});

	it("asks the vehicle question on a badge turn and sends the badge with the answer", async () => {
		const van = "f1123000-0000-4000-8000-0000000000a1";
		const vehicleUse: KioskVehicleUse = {
			mode: "asked",
			vehicles: [{ id: van, name: "Van", licencePlate: "M-VW 1", archived: false }],
			suggestedVehicleIds: [van],
			lastEndKmByVehicleId: { [van]: 12_085 },
			vehiclesOnOtherLiveWork: [],
			live: null,
		};
		const calls = stubFetch(
			kioskRoutes({
				"/api/kiosk/employee-status": () => Response.json({ ...clockedOut, vehicleUse }),
			}),
		);
		await openHome();
		scanKeys(BADGE);
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		await screen.findByRole("radiogroup", { name: "Vehicle" });
		expect(urls(calls, "/api/kiosk/clock")).toEqual([]);
		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));

		await screen.findByRole("status", { name: "Done" });
		const [sent] = urls(calls, "/api/kiosk/clock");
		expect(sent?.body).toMatchObject({
			badge: BADGE,
			action: "clock_in",
			vehicleUse: { vehicle: { kind: "organization", vehicleId: van }, startKm: 12_085 },
		});
	});

	describe("a lost reply", () => {
		const CHECKING = "Checking whether your action was recorded";

		it("checks the badge action without the badge, offers nothing to repeat, and shows the original result", async () => {
			const calls = stubFetch(
				kioskRoutes({
					"/api/kiosk/clock": () => {
						throw new TypeError("Failed to fetch");
					},
					"/api/kiosk/clock/outcome": () =>
						Response.json({
							outcome: "committed",
							action: "clock_in",
							at: { instant: "2026-10-10T06:30:00Z", zone: "Europe/Berlin" },
						} satisfies KioskClockAttemptOutcome),
				}),
			);
			await openHome();
			scanKeys(BADGE);
			fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

			expect(await screen.findByRole("heading", { name: CHECKING })).toBeTruthy();
			const stored = window.localStorage.getItem(UNCERTAIN_KEY) ?? "";
			expect(JSON.parse(stored)).toEqual([
				expect.objectContaining({ via: "badge", employee: anna }),
			]);
			expect(stored).not.toContain(BADGE);
			for (const name of ["Clock in", "OK", "1"]) {
				expect(screen.queryByRole("button", { name })).toBeNull();
			}
			// A scan now changes nothing either.
			scanKeys(BADGE);

			await advance(3_500);

			expect(await screen.findByRole("status", { name: "Done" })).toBeTruthy();
			const [asked] = urls(calls, "/api/kiosk/clock/outcome");
			expect(asked?.body).toEqual({
				operationId: urls(calls, "/api/kiosk/clock")[0]?.body?.operationId,
				employeeId: anna.id,
				action: "clock_in",
			});
			expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
			expect(urls(calls, "/api/kiosk/employee-status")).toHaveLength(1);
		});

		it("sends the employee back to scan again once Z8 confirms nothing was recorded", async () => {
			const calls = stubFetch(
				kioskRoutes({
					"/api/kiosk/clock": () => {
						throw new TypeError("Failed to fetch");
					},
					"/api/kiosk/clock/outcome": () =>
						Response.json({ outcome: "not_recorded" } satisfies KioskClockAttemptOutcome),
				}),
			);
			await openHome();
			scanKeys(BADGE);
			fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
			expect(await screen.findByRole("heading", { name: CHECKING })).toBeTruthy();
			await advance(3_500);

			expect(
				await screen.findByText(
					"Your action was not recorded. Scan your badge again to choose it again.",
				),
			).toBeTruthy();
			expect(screen.getByRole("searchbox", { name: "Find your name" })).toBeTruthy();
			expect(screen.queryByText("Enter your kiosk PIN")).toBeNull();
			await advance(20_000);
			// Nothing is ever sent again on its own.
			expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
			expect(urls(calls, "/api/kiosk/employee-status")).toHaveLength(1);
			expect(window.localStorage.getItem(UNCERTAIN_KEY)).toBeNull();
		});

		it("after a reload, tells the employee who scans again that the action was not recorded, and lets them choose afresh", async () => {
			const calls = stubFetch(
				kioskRoutes({
					"/api/kiosk/clock": () => new Promise<Response>(() => undefined),
					"/api/kiosk/clock/outcome": () =>
						Response.json({ outcome: "not_recorded" } satisfies KioskClockAttemptOutcome),
				}),
			);
			await openHome();
			scanKeys(BADGE);
			fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
			await vi.waitFor(() => expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1));

			// The page goes away while the action is on its way, and comes back for everyone.
			cleanup();
			render(<KioskApp />);
			await screen.findByRole("button", { name: /Anna Berger/ });
			await advance(3_500);
			await vi.waitFor(() => expect(urls(calls, "/api/kiosk/clock/outcome")).toHaveLength(1));
			expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);

			scanKeys(BADGE);

			expect(
				await screen.findByText(
					"This action was not recorded. Choose it again if you still want it.",
				),
			).toBeTruthy();
			expect(screen.getByRole("button", { name: "Clock in" })).toBeTruthy();
			expect(window.localStorage.getItem(UNCERTAIN_KEY)).toBeNull();
			expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
		});

		it("holds only the badge's employee while their action is unresolved", async () => {
			const calls = stubFetch(
				kioskRoutes({
					"/api/kiosk/clock": () => {
						throw new TypeError("Failed to fetch");
					},
					"/api/kiosk/clock/outcome": () => Response.json({ code: "failed" }, { status: 503 }),
				}),
			);
			await openHome();
			scanKeys(BADGE);
			fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
			await screen.findByRole("heading", { name: CHECKING });
			fireEvent.click(screen.getByRole("button", { name: "Back" }));
			await screen.findByRole("searchbox", { name: "Find your name" });
			await advance(500);

			// Anna scans again: still checking, no actions; by name, no PIN pad either.
			scanKeys(BADGE);
			expect(await screen.findByRole("heading", { name: CHECKING })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Back" }));
			fireEvent.click(await screen.findByRole("button", { name: /Anna Berger/ }));
			expect(await screen.findByRole("heading", { name: CHECKING })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
			expect(urls(calls, "/api/kiosk/clock")).toHaveLength(1);
		});
	});
});
