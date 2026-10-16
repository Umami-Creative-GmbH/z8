/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	KIOSK_TOKEN_STORAGE_KEY,
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

const navigation = vi.hoisted(() => ({ locale: "en", replace: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => navigation.locale }));
vi.mock("@/navigation", () => ({
	usePathname: () => "/kiosk",
	useRouter: () => ({ replace: navigation.replace }),
}));

/**
 * #1123: vehicle use at the kiosk, driven through the kiosk page with the kiosk
 * endpoints stubbed at `fetch`. After the action's button, an employee whose
 * vehicle use is asked or expected picks the vehicle and enters the reading,
 * pre-filled and warned about as at the web clock; nothing is asked when off.
 */
const kiosk: KioskDeviceInfo = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "Depot",
	locationId: "11111111-1111-4111-8111-111111111111",
	locationName: "Depot",
	timezone: "Europe/Berlin",
	boardEnabled: false,
	language: "en",
	offlineMode: false,
};

const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const van = "f1123000-0000-4000-8000-0000000000a1";
const truck = "f1123000-0000-4000-8000-0000000000a2";

const vehicleUse: KioskVehicleUse = {
	mode: "asked",
	vehicles: [
		{ id: truck, name: "Truck", licencePlate: "M-TR 2", archived: false },
		{ id: van, name: "Van", licencePlate: "M-VW 1", archived: false },
	],
	suggestedVehicleIds: [truck],
	lastEndKmByVehicleId: { [van]: 12_085, [truck]: 340 },
	vehiclesOnOtherLiveWork: [van],
	live: null,
};

const vanUse = {
	vehicle: { kind: "organization" as const, vehicleId: van },
	startKm: 12_000,
	endKm: null,
	distanceKm: null,
};

const dayTotal = { date: "2026-10-10", timezone: "Europe/Berlin", minutes: 0 };
const clockedOut = { status: "clocked_out" } as const;
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

function snapshot(
	state: KioskEmployeeSnapshot["state"],
	vehicles?: KioskVehicleUse,
): KioskEmployeeSnapshot {
	return { employee: anna, state, dayTotal, ...(vehicles ? { vehicleUse: vehicles } : {}) };
}

type Call = { url: string; body: Record<string, unknown> | null };

function stubFetch(before: KioskEmployeeSnapshot, action: KioskClockResult["action"]) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
			if (url === "/api/kiosk/session") return Response.json({ kiosk });
			if (url === "/api/kiosk/employees") return Response.json({ employees: [anna] });
			if (url === "/api/kiosk/employee-status") return Response.json(before);
			if (url === "/api/kiosk/clock") {
				return Response.json({
					employee: anna,
					state: clockedOut,
					dayTotal,
					outcome: "executed",
					action,
					at: { instant: "2026-10-10T10:00:00Z", zone: "Europe/Berlin" },
				} satisfies KioskClockResult);
			}
			return Response.json({}, { status: 404 });
		}),
	);
	return calls;
}

async function openTurn() {
	render(<KioskApp />);
	fireEvent.click(await screen.findByRole("button", { name: /Anna Berger/ }));
	await screen.findByRole("heading", { name: "Anna Berger" });
	for (const digit of "2468") fireEvent.click(screen.getByRole("button", { name: digit }));
	fireEvent.click(screen.getByRole("button", { name: "OK" }));
}

function clockBodies(calls: Call[]) {
	return calls.filter((call) => call.url === "/api/kiosk/clock").map((call) => call.body);
}

describe("vehicle use at the kiosk (#1123)", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, "z8k_device-token");
		window.history.replaceState(null, "", "/en/kiosk");
		navigation.locale = "en";
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("asks nothing while vehicle use is off", async () => {
		const calls = stubFetch(snapshot(clockedOut), "clock_in");
		await openTurn();

		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		await screen.findByRole("status", { name: "Done" });
		const [body] = clockBodies(calls);
		expect(body?.action).toBe("clock_in");
		expect(body).not.toHaveProperty("vehicleUse");
	});

	it("pre-selects the assigned vehicle with its last end reading and clocks in with it", async () => {
		const calls = stubFetch(snapshot(clockedOut, vehicleUse), "clock_in");
		await openTurn();

		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		const vehicles = await screen.findByRole("radiogroup", { name: "Vehicle" });
		expect(within(vehicles).getByRole("radio", { name: "Truck (M-TR 2)" })).toHaveProperty(
			"checked",
			true,
		);
		expect(screen.getByLabelText("Start reading (km)")).toHaveProperty("value", "340");
		expect(clockBodies(calls)).toEqual([]);

		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));

		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)).toEqual([
			expect.objectContaining({
				action: "clock_in",
				vehicleUse: { vehicle: { kind: "organization", vehicleId: truck }, startKm: 340 },
			}),
		]);
	});

	it("warns as the web clock does but still clocks in", async () => {
		const calls = stubFetch(snapshot(clockedOut, { ...vehicleUse, mode: "expected" }), "clock_in");
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		expect(await screen.findByText(/expects you to record the vehicle/)).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: "Van (M-VW 1)" }));
		expect(screen.getByLabelText("Start reading (km)")).toHaveProperty("value", "12085");
		fireEvent.change(screen.getByLabelText("Start reading (km)"), { target: { value: "12000" } });

		const warnings = await screen.findByRole("status", { name: "Please check the vehicle use" });
		expect(
			within(warnings).getByText(/below this vehicle's last recorded end reading/),
		).toBeTruthy();
		expect(within(warnings).getByText(/already recorded on another employee/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)[0]?.vehicleUse).toEqual({
			vehicle: { kind: "organization", vehicleId: van },
			startKm: 12_000,
		});
	});

	it("clocks in without vehicle use when no vehicle is picked", async () => {
		const calls = stubFetch(snapshot(clockedOut, vehicleUse), "clock_in");
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));

		fireEvent.click(await screen.findByRole("radio", { name: "No vehicle" }));
		expect(screen.queryByLabelText("Start reading (km)")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Clock in" }));

		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)[0]).not.toHaveProperty("vehicleUse");
	});

	it("asks the end reading at clock-out for the live work's vehicle", async () => {
		const calls = stubFetch(snapshot(clockedIn, { ...vehicleUse, live: vanUse }), "clock_out");
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));

		// The readings are formatted in the device's locale.
		expect(await screen.findByText(/Van \(M-VW 1\) · 12[.,]000 → – km/)).toBeTruthy();
		fireEvent.change(screen.getByLabelText("End reading (km)"), { target: { value: "12085" } });
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)).toEqual([
			expect.objectContaining({ action: "clock_out", vehicleUse: { endKm: 12_085 } }),
		]);
	});

	it("still clocks out, without vehicle use, when the end reading is below the start", async () => {
		const calls = stubFetch(snapshot(clockedIn, { ...vehicleUse, live: vanUse }), "clock_out");
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));

		fireEvent.change(await screen.findByLabelText("End reading (km)"), {
			target: { value: "11000" },
		});
		expect(screen.getByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		const confirmation = await screen.findByRole("status", { name: "Done" });
		expect(within(confirmation).getByText("Vehicle use was not recorded")).toBeTruthy();
		expect(clockBodies(calls)[0]).not.toHaveProperty("vehicleUse");
	});

	it("asks one reading on resuming a break and nothing on starting one", async () => {
		const calls = stubFetch(snapshot(onBreak, { ...vehicleUse, live: vanUse }), "resume_break");
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Resume work" }));

		fireEvent.change(await screen.findByLabelText("Odometer reading at the break (km)"), {
			target: { value: "12040" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Resume work" }));

		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)).toEqual([
			expect.objectContaining({ action: "resume_break", vehicleUse: { readingKm: 12_040 } }),
		]);
	});

	it("starts a break at once", async () => {
		const calls = stubFetch(snapshot(clockedIn, { ...vehicleUse, live: vanUse }), "start_break");
		await openTurn();

		fireEvent.click(await screen.findByRole("button", { name: "Start break" }));

		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)[0]).not.toHaveProperty("vehicleUse");
	});

	it("returns to the employee's actions from the vehicle step", async () => {
		const calls = stubFetch(snapshot(clockedOut, vehicleUse), "clock_in");
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
		await screen.findByRole("radiogroup", { name: "Vehicle" });

		fireEvent.click(screen.getByRole("button", { name: "Back" }));

		expect(await screen.findByText("Not clocked in")).toBeTruthy();
		expect(clockBodies(calls)).toEqual([]);
	});
});
