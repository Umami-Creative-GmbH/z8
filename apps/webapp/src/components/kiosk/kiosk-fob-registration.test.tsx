/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskDeviceInfo,
	type KioskFobRegistrationResult,
} from "@/lib/time-tracking/kiosk/protocol";
import {
	advance,
	anna,
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
 * #1505: kiosk fobs read by an attached keyboard-style NFC reader, through the
 * kiosk page with the kiosk endpoints stubbed at `fetch`. The reader types the
 * chip's serial number as a fast burst ending in Enter. An unknown fob offers
 * "Register this fob": the employee picks their name and enters their kiosk
 * PIN. Badges keep reaching badge clocking when both switches are on.
 */
const BADGE = "K8B0123456789ABCDEFGHJKMNPQRSTVWX0123456789ABCDEFGHJKMNP";

const registered: KioskFobRegistrationResult = {
	outcome: "registered",
	employee: anna,
	lastFour: "E5F6",
	replaced: false,
};

/** The kiosk's routes, an unknown fob and a successful registration unless `extra` says otherwise. */
function kioskRoutes(
	extra: Record<string, Route> = {},
	device: KioskDeviceInfo = kiosk,
): Record<string, Route> {
	return sessionRoutes(
		{
			"/api/kiosk/fob": () => Response.json({ outcome: "not_recognised" }),
			"/api/kiosk/fob/registration": () => Response.json(registered),
			...extra,
		},
		device,
	);
}
/** From an unknown fob on the home screen to the PIN pad for Anna. */
async function startRegistration() {
	readKeys(TYPED_SERIAL);
	fireEvent.click(await screen.findByRole("button", { name: "Register this fob" }));
	fireEvent.click(await screen.findByRole("button", { name: /Anna Berger/ }));
	expect(await screen.findByText("Enter your kiosk PIN to register this fob")).toBeTruthy();
}

describe("kiosk fob registration with an attached NFC reader (#1505)", () => {
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

	it("offers to register an unknown fob, links it after the employee's name and PIN, and returns home", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		expect(screen.getByText("Or tap your fob on the reader.")).toBeTruthy();

		readKeys(TYPED_SERIAL);

		expect(await screen.findByText("This fob is not recognised here.")).toBeTruthy();
		expect(urls(calls, "/api/kiosk/fob").map((call) => call.body)).toEqual([{ serial: SERIAL }]);
		fireEvent.click(screen.getByRole("button", { name: "Register this fob" }));
		fireEvent.click(await screen.findByRole("button", { name: /Anna Berger/ }));
		expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(screen.getByText("Enter your kiosk PIN to register this fob")).toBeTruthy();

		pressPin("4711");

		const confirmation = await screen.findByRole("status", { name: "Fob registered" });
		expect(within(confirmation).getByText(/Anna Berger/)).toBeTruthy();
		expect(within(confirmation).getByText(/ending in E5F6/)).toBeTruthy();
		expect(urls(calls, "/api/kiosk/fob/registration").map((call) => call.body)).toEqual([
			{ serial: SERIAL, employeeId: anna.id, pin: "4711" },
		]);
		// Nothing about the fob stays on the device; the screen never shows the whole serial.
		expect(JSON.stringify(window.localStorage)).not.toContain(SERIAL);
		expect(document.body.textContent).not.toContain(SERIAL);

		await advance(10_500);
		expect(await screen.findByRole("searchbox", { name: "Find your name" })).toBeTruthy();
	});

	it("says when the new fob replaced the employee's earlier one", async () => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/fob/registration": () => Response.json({ ...registered, replaced: true }),
			}),
		);
		await openHome();
		await startRegistration();
		pressPin("4711");

		const confirmation = await screen.findByRole("status", { name: "Fob registered" });
		expect(within(confirmation).getByText(/replaces your earlier fob/)).toBeTruthy();
	});

	it("asks for the PIN again after a wrong one, and links nothing", async () => {
		let attempts = 0;
		stubFetch(
			kioskRoutes({
				"/api/kiosk/fob/registration": () =>
					++attempts === 1
						? Response.json({ code: "wrong_pin" }, { status: 403 })
						: Response.json(registered),
			}),
		);
		await openHome();
		await startRegistration();
		pressPin("0000");

		expect(await screen.findByText("That PIN is not correct. Try again.")).toBeTruthy();
		expect(screen.getByText("Enter your kiosk PIN to register this fob")).toBeTruthy();
		pressPin("4711");
		expect(await screen.findByRole("status", { name: "Fob registered" })).toBeTruthy();
	});

	it("returns home without naming anyone when the fob belongs to another employee", async () => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/fob/registration": () =>
					Response.json({ code: "fob_linked_to_other_employee" }, { status: 409 }),
			}),
		);
		await openHome();
		await startRegistration();
		pressPin("4711");

		expect(
			await screen.findByText(
				"This fob is already registered to someone else. Nothing was changed. Ask your manager.",
			),
		).toBeTruthy();
		expect(screen.getByRole("searchbox", { name: "Find your name" })).toBeTruthy();
	});

	it("opens a recognised fob's PIN entry (#1506) and offers no registration", async () => {
		stubFetch(
			kioskRoutes({
				"/api/kiosk/fob": () => Response.json({ outcome: "employee", employee: anna }),
			}),
		);
		await openHome();
		readKeys(TYPED_SERIAL);

		expect(await screen.findByText("Enter your kiosk PIN")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Register this fob" })).toBeNull();
		expect(screen.queryByText("Enter your kiosk PIN to register this fob")).toBeNull();
	});

	it("needs a connection: offline, a fob sends nothing", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
		act(() => {
			window.dispatchEvent(new Event("offline"));
		});

		readKeys(TYPED_SERIAL);

		// Without offline mode the kiosk cannot clock by PIN either (#1506), so it offers none.
		expect(await screen.findByText("Fobs need a connection. Nothing was recorded.")).toBeTruthy();
		expect(urls(calls, "/api/kiosk/fob")).toEqual([]);
	});

	it("ignores a fob at a kiosk whose reader switch is off", async () => {
		const calls = stubFetch(kioskRoutes({}, { ...kiosk, nfcFobReaderEnabled: false }));
		await openHome();
		expect(screen.queryByText("Or tap your fob on the reader.")).toBeNull();

		readKeys(TYPED_SERIAL);
		await advance(300);

		expect(urls(calls, "/api/kiosk/fob")).toEqual([]);
		expect(screen.queryByRole("button", { name: "Register this fob" })).toBeNull();
	});

	it("ignores input that is neither a badge nor a fob serial number", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();

		// A 4-byte chip printed in decimal, as a misconfigured reader types it.
		readKeys("0078234179");
		await advance(300);

		expect(urls(calls, "/api/kiosk/fob")).toEqual([]);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("keeps fob reads away from the registration's own screens", async () => {
		const calls = stubFetch(kioskRoutes());
		await openHome();
		await startRegistration();

		readKeys("1A2B3C4D");
		await advance(300);

		expect(urls(calls, "/api/kiosk/fob")).toHaveLength(1);
		expect(screen.getByText("Enter your kiosk PIN to register this fob")).toBeTruthy();
	});

	it("still sends a badge to badge clocking when both the scanner and the fob reader are on", async () => {
		const calls = stubFetch(kioskRoutes({}, { ...kiosk, badgeScannerEnabled: true }));
		await openHome();

		readKeys(BADGE);

		expect(await screen.findByRole("heading", { name: "Anna Berger" })).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status").map((call) => call.body)).toEqual([
			{ badge: BADGE },
		]);
		expect(urls(calls, "/api/kiosk/fob")).toEqual([]);
	});

	it("sends a fob serial to the fob flow when both the scanner and the fob reader are on", async () => {
		const calls = stubFetch(kioskRoutes({}, { ...kiosk, badgeScannerEnabled: true }));
		await openHome();

		readKeys(TYPED_SERIAL);

		expect(await screen.findByText("This fob is not recognised here.")).toBeTruthy();
		expect(urls(calls, "/api/kiosk/employee-status")).toEqual([]);
	});
});
