import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BreakVehicleReading,
	ClockInVehicleUse,
	ClockOutVehicleUse,
} from "../src/components/VehicleUseFields";
import { useVehicleUse } from "../src/hooks/useVehicleUse";
import { LocaleProvider } from "../src/lib/i18n";
import type { DesktopContext, DesktopVehicleUse } from "../src/types";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(cleanup);
beforeEach(() => {
	invoke.mockReset();
	invoke.mockResolvedValue({ warnings: [] });
});

const VAN = "0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5";
const CAR = "1d2e3f40-5b6c-4d7e-8f80-91a2b3c4d5e6";

function context(
	vehicleUse: Partial<DesktopVehicleUse> | null,
	clockedIn = false,
): DesktopContext {
	return {
		userId: "user-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		timezone: "Europe/Berlin",
		locale: null,
		fetchedAt: "2026-10-13T08:00:00.000Z",
		cached: false,
		dayTotalBasis: undefined as never,
		projects: [],
		categories: [],
		liveWork: clockedIn
			? {
					id: "period-1",
					projectId: null,
					workCategoryId: null,
					workLocationType: "office",
				}
			: null,
		...(vehicleUse === null
			? {}
			: {
					vehicleUse: {
						mode: "asked",
						vehicles: [
							{ id: CAR, name: "Car", licencePlate: "M-CR 2" },
							{ id: VAN, name: "Van", licencePlate: "M-VN 1" },
						],
						suggestedVehicleIds: [VAN],
						lastEndKmByVehicleId: { [VAN]: 12_040, [CAR]: 800 },
						live: null,
						...vehicleUse,
					},
				}),
	};
}

/** The clock as App wires it: fields, and the clock button reading what they send. */
function Clock({
	data,
	onSend,
}: {
	data: DesktopContext;
	onSend: (sent: unknown) => void;
}) {
	const vehicle = useVehicleUse(data);
	const clockedIn = !!data.liveWork;
	return (
		<>
			{clockedIn ? (
				<>
					<ClockOutVehicleUse state={vehicle} disabled={false} />
					<BreakVehicleReading state={vehicle} disabled={false} />
					<button type="button" onClick={() => onSend(vehicle.clockOut)}>
						Clock out
					</button>
					<button type="button" onClick={() => onSend(vehicle.takenBreak)}>
						I was on break
					</button>
					<button
						type="button"
						onClick={() => {
							const sent = vehicle.clockOut;
							onSend(sent);
							vehicle.breakStarted(sent.ok ? sent.vehicleUse : undefined);
							vehicle.reset({ keepCarried: true });
						}}
					>
						Start break
					</button>
				</>
			) : (
				<>
					<ClockInVehicleUse state={vehicle} disabled={false} />
					<button type="button" onClick={() => onSend(vehicle.clockIn)}>
						Clock in
					</button>
				</>
			)}
		</>
	);
}

function setup(data: DesktopContext, wrap = (node: ReactNode) => node) {
	const onSend = vi.fn();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const tree = (next: DesktopContext) => (
		<QueryClientProvider client={client}>
			{wrap(<Clock data={next} onSend={onSend} />)}
		</QueryClientProvider>
	);
	const { rerender } = render(tree(data));
	return {
		/** A context refresh, e.g. after the clock event committed. */
		refresh: (next: DesktopContext) => rerender(tree(next)),
		send: async (name: string) => {
			await userEvent.click(screen.getByRole("button", { name }));
			return onSend.mock.lastCall?.[0];
		},
	};
}

describe("vehicle use at the desktop clock (#1124)", () => {
	it("asks nothing while vehicle use is off or the server predates it", async () => {
		for (const data of [context(null), context({ mode: "off" })]) {
			const view = setup(data);
			expect(screen.queryByRole("combobox", { name: "Vehicle" })).toBeNull();
			expect(await view.send("Clock in")).toEqual({ ok: true });
			cleanup();
		}
	});

	it("pre-selects the assigned vehicle with its last end reading and sends it at clock-in", async () => {
		const view = setup(context({}));
		const vehicle = await screen.findByRole("combobox", { name: "Vehicle" });
		expect((vehicle as HTMLSelectElement).value).toBe(VAN);
		expect(
			(
				screen.getByRole("textbox", {
					name: "Start reading (km)",
				}) as HTMLInputElement
			).value,
		).toBe("12040");
		expect(await view.send("Clock in")).toEqual({
			ok: true,
			vehicleUse: {
				vehicle: { kind: "organization", vehicleId: VAN },
				startKm: 12_040,
			},
		});

		await userEvent.selectOptions(vehicle, "own");
		expect(
			(
				screen.getByRole("textbox", {
					name: "Start reading (km)",
				}) as HTMLInputElement
			).value,
		).toBe("");
		expect(await view.send("Clock in")).toEqual({
			ok: true,
			vehicleUse: { vehicle: { kind: "own" } },
		});
	});

	it("tells an employee with vehicle use expected that it is expected", async () => {
		setup(context({ mode: "expected" }));
		expect(
			await screen.findByText(
				"Your organization expects you to record the vehicle you drove and its readings.",
			),
		).toBeDefined();
	});

	it("shows the server's plausibility warnings for the clock-in", async () => {
		invoke.mockResolvedValue({
			warnings: [{ code: "vehicle_on_other_live_work" }],
		});
		setup(context({}));
		expect(
			await screen.findByText(
				"This vehicle is already recorded on another employee's running work.",
				{},
				{ timeout: 3000 },
			),
		).toBeDefined();
		expect(invoke).toHaveBeenCalledWith("check_vehicle_use_warnings", {
			vehicleUse: {
				vehicle: { kind: "organization", vehicleId: VAN },
				startKm: 12_040,
				endKm: null,
				distanceKm: null,
			},
		});
	});

	it("asks the end reading at clock-out and refuses one below the start reading", async () => {
		const live = {
			vehicle: { kind: "organization" as const, vehicleId: VAN },
			startKm: 12_040,
			endKm: null,
			distanceKm: null,
		};
		const view = setup(context({ live }, true));
		expect(screen.getByText("Van (M-VN 1) · from 12,040 km")).toBeDefined();
		const end = screen.getByRole("textbox", { name: "End reading (km)" });
		await userEvent.type(end, "12000");
		expect(screen.getByRole("alert").textContent).toBe(
			"The end reading cannot be below the start reading.",
		);
		await userEvent.clear(end);
		await userEvent.type(end, "12085");
		expect(await view.send("Clock out")).toEqual({
			ok: true,
			vehicleUse: { endKm: 12_085 },
		});
	});

	it("asks the driven distance at clock-out when no start reading was recorded", async () => {
		const live = {
			vehicle: { kind: "own" as const },
			startKm: null,
			endKm: null,
			distanceKm: null,
		};
		const view = setup(context({ live }, true));
		await userEvent.type(
			screen.getByRole("textbox", { name: "Driven distance (km)" }),
			"42",
		);
		expect(await view.send("Clock out")).toEqual({
			ok: true,
			vehicleUse: { distanceKm: 42 },
		});
	});

	it("asks one optional reading at an idle break while the work records a vehicle", async () => {
		const live = {
			vehicle: { kind: "own" as const },
			startKm: 100,
			endKm: null,
			distanceKm: null,
		};
		const view = setup(context({ live }, true));
		expect(await view.send("I was on break")).toEqual({ ok: true });
		await userEvent.type(
			screen.getByRole("textbox", {
				name: "Odometer reading at the break (km)",
			}),
			"150",
		);
		expect(await view.send("I was on break")).toEqual({
			ok: true,
			vehicleUse: { readingKm: 150 },
		});
	});

	it("resumes a manual break with the vehicle and the reading it was started with", async () => {
		const live = {
			vehicle: { kind: "organization" as const, vehicleId: CAR },
			startKm: 800,
			endKm: null,
			distanceKm: null,
		};
		const view = setup(context({ live }, true));
		await userEvent.type(
			screen.getByRole("textbox", { name: "End reading (km)" }),
			"850",
		);
		expect(await view.send("Start break")).toEqual({
			ok: true,
			vehicleUse: { endKm: 850 },
		});
		// On break: clocked out, the context no longer has live work.
		view.refresh(context({ live: null }));
		const vehicle = await screen.findByRole("combobox", { name: "Vehicle" });
		expect((vehicle as HTMLSelectElement).value).toBe(CAR);
		expect(
			(
				screen.getByRole("textbox", {
					name: "Start reading (km)",
				}) as HTMLInputElement
			).value,
		).toBe("850");
	});

	it("asks no break reading while the work records no vehicle", () => {
		setup(context({}, true));
		expect(
			screen.queryByRole("textbox", {
				name: "Odometer reading at the break (km)",
			}),
		).toBeNull();
	});

	it("presents vehicle use in German", async () => {
		setup(context({ mode: "expected" }), (node) => (
			<LocaleProvider language="de">{node}</LocaleProvider>
		));
		expect(
			await screen.findByRole("combobox", { name: "Fahrzeug" }),
		).toBeDefined();
		expect(
			screen.getByRole("textbox", { name: "Anfangskilometerstand (km)" }),
		).toBeDefined();
		expect(
			screen.getByRole("option", { name: "Eigenes Fahrzeug" }),
		).toBeDefined();
	});
});
