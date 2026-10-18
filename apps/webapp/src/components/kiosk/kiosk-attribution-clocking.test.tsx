/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskAttribution,
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
 * #887: project and work category at an online kiosk clock-out, driven through
 * the kiosk page with the kiosk endpoints stubbed at `fetch`. After "Clock out"
 * a clocked-in employee keeps, picks or clears either; nothing else asks.
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
const shopFitting = { id: "f8870000-0000-4000-8000-000000000031", name: "Shop fitting" };
const sale = { id: "f8870000-0000-4000-8000-000000000032", name: "Anniversary sale" };
const travel = { id: "f8870000-0000-4000-8000-000000000042", name: "Travel" };
const training = { id: "f8870000-0000-4000-8000-000000000043", name: "Training" };

const attribution: KioskAttribution = {
	project: { current: shopFitting, options: [sale, shopFitting] },
	workCategory: { current: travel, options: [travel, training] },
};

const dayTotal = { date: "2026-10-10", timezone: "Europe/Berlin", minutes: 0 };
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
	extra: Partial<KioskEmployeeSnapshot> = {},
	state: KioskEmployeeSnapshot["state"] = clockedIn,
): KioskEmployeeSnapshot {
	return { employee: anna, state, dayTotal, attribution, ...extra };
}

type Call = { url: string; body: Record<string, unknown> | null };

/** Answers each clock call in turn: `ok` executes, anything else is that 409 refusal. */
function stubFetch(before: KioskEmployeeSnapshot, answers: string[] = ["ok"]) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
			if (url === "/api/kiosk/session") return Response.json({ kiosk });
			if (url === "/api/kiosk/employees") return Response.json({ employees: [anna] });
			if (url === "/api/kiosk/employee-status") return Response.json(before);
			if (url === "/api/kiosk/clock") {
				const answer = answers.shift() ?? "ok";
				if (answer !== "ok") {
					return Response.json(
						{ code: answer, employee: anna, state: clockedIn, dayTotal },
						{ status: 409 },
					);
				}
				const body = calls.at(-1)?.body;
				return Response.json({
					employee: anna,
					state: { status: "clocked_out" },
					dayTotal,
					outcome: "executed",
					action: body?.action as KioskClockResult["action"],
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

describe("project and work category at the kiosk (#887)", () => {
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
		vi.restoreAllMocks();
	});

	it("keeps the work's project and category unless the employee changes them", async () => {
		const calls = stubFetch(snapshot());
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));

		const projects = await screen.findByRole("radiogroup", { name: "Project" });
		expect(within(projects).getByRole("radio", { name: "Keep Shop fitting" })).toHaveProperty(
			"checked",
			true,
		);
		expect(
			within(screen.getByRole("radiogroup", { name: "Work category" })).getByRole("radio", {
				name: "Keep Travel",
			}),
		).toHaveProperty("checked", true);
		expect(clockBodies(calls)).toEqual([]);

		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		await screen.findByRole("status", { name: "Done" });
		const [body] = clockBodies(calls);
		expect(body?.action).toBe("clock_out");
		expect(body).not.toHaveProperty("project");
		expect(body).not.toHaveProperty("workCategory");
	});

	it("sends a picked project and a cleared category", async () => {
		const calls = stubFetch(snapshot());
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));

		const projects = await screen.findByRole("radiogroup", { name: "Project" });
		// The current project is offered once, as the one to keep.
		expect(
			within(projects)
				.getAllByRole("radio")
				.map((radio) => radio.closest("label")?.textContent),
		).toEqual(["Keep Shop fitting", "Anniversary sale", "No project"]);
		fireEvent.click(within(projects).getByRole("radio", { name: "Anniversary sale" }));
		fireEvent.click(screen.getByRole("radio", { name: "No work category" }));
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)).toEqual([
			expect.objectContaining({ action: "clock_out", project: sale.id, workCategory: null }),
		]);
	});

	it("asks only the fields the snapshot offers", async () => {
		const calls = stubFetch(
			snapshot({ attribution: { workCategory: { current: null, options: [travel, training] } } }),
		);
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));

		const categories = await screen.findByRole("radiogroup", { name: "Work category" });
		expect(screen.queryByRole("radiogroup", { name: "Project" })).toBeNull();
		expect(within(categories).getByRole("radio", { name: "No work category" })).toHaveProperty(
			"checked",
			true,
		);
		fireEvent.click(within(categories).getByRole("radio", { name: "Training" }));
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		await screen.findByRole("status", { name: "Done" });
		const [body] = clockBodies(calls);
		expect(body).toMatchObject({ workCategory: training.id });
		expect(body).not.toHaveProperty("project");
	});

	it("clocks out at once when there is nothing to choose", async () => {
		const calls = stubFetch(snapshot({ attribution: undefined }));
		await openTurn();

		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));

		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)[0]).not.toHaveProperty("project");
	});

	it("asks nothing when starting a break or ending the day on one", async () => {
		const calls = stubFetch(snapshot());
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Start break" }));
		await screen.findByRole("status", { name: "Done" });
		cleanup();

		const onBreakCalls = stubFetch(snapshot({}, onBreak));
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "End day" }));
		await screen.findByRole("status", { name: "Done" });

		for (const body of [...clockBodies(calls), ...clockBodies(onBreakCalls)]) {
			expect(body).not.toHaveProperty("project");
			expect(body).not.toHaveProperty("workCategory");
		}
	});

	it("keeps the choice after a refusal, so the employee can change it or keep and retry", async () => {
		const calls = stubFetch(snapshot(), ["project_not_allowed", "ok"]);
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
		fireEvent.click(await screen.findByRole("radio", { name: "Anniversary sale" }));
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		expect((await screen.findByRole("alert")).textContent).toMatch(
			/project can no longer be booked/,
		);
		expect(screen.getByRole("radio", { name: "Anniversary sale" })).toHaveProperty("checked", true);

		fireEvent.click(screen.getByRole("radio", { name: "Keep Shop fitting" }));
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		await screen.findByRole("status", { name: "Done" });
		const [refused, kept] = clockBodies(calls);
		expect(refused).toMatchObject({ project: sale.id });
		expect(kept).not.toHaveProperty("project");
		// Each explicit attempt is its own operation.
		expect(kept?.operationId).not.toBe(refused?.operationId);
	});

	it("keeps the choice when the kiosk lost its connection before sending", async () => {
		const calls = stubFetch(snapshot());
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
		fireEvent.click(await screen.findByRole("radio", { name: "Training" }));
		vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		expect(
			await screen.findByText(/Nothing was recorded; clocking works only while online/),
		).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Training" })).toHaveProperty("checked", true);
		expect(clockBodies(calls)).toEqual([]);
	});

	it("asks the end reading after the choice and sends both", async () => {
		const van = "f1123000-0000-4000-8000-0000000000a1";
		const vehicleUse: KioskVehicleUse = {
			mode: "asked",
			vehicles: [{ id: van, name: "Van", licencePlate: "M-VW 1", archived: false }],
			suggestedVehicleIds: [],
			lastEndKmByVehicleId: {},
			vehiclesOnOtherLiveWork: [],
			live: {
				vehicle: { kind: "organization", vehicleId: van },
				startKm: 12_000,
				endKm: null,
				distanceKm: null,
			},
		};
		const calls = stubFetch(snapshot({ vehicleUse }));
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
		fireEvent.click(await screen.findByRole("radio", { name: "Anniversary sale" }));
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		fireEvent.change(await screen.findByLabelText("End reading (km)"), {
			target: { value: "12085" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		await screen.findByRole("status", { name: "Done" });
		expect(clockBodies(calls)).toEqual([
			expect.objectContaining({ project: sale.id, vehicleUse: { endKm: 12_085 } }),
		]);

		// Back from the vehicle step returns to the choice as it was left.
		cleanup();
		stubFetch(snapshot({ vehicleUse }));
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
		fireEvent.click(await screen.findByRole("radio", { name: "Training" }));
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));
		await screen.findByLabelText("End reading (km)");
		fireEvent.click(screen.getByRole("button", { name: "Back" }));
		expect(await screen.findByRole("radio", { name: "Training" })).toHaveProperty("checked", true);
	});

	it("goes back to the employee's actions, and forgets the choice when the turn ends", async () => {
		const calls = stubFetch(snapshot());
		await openTurn();
		fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
		fireEvent.click(await screen.findByRole("radio", { name: "Anniversary sale" }));

		fireEvent.click(screen.getByRole("button", { name: "Back" }));
		expect(await screen.findByText(/Clocked in since/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clock out" }));

		expect(await screen.findByRole("radio", { name: "Keep Shop fitting" })).toHaveProperty(
			"checked",
			true,
		);
		expect(clockBodies(calls)).toEqual([]);
	});
});
