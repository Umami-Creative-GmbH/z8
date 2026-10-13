/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getClockVehicleUseContext: vi.fn(),
	changeLiveVehicleUse: vi.fn(),
	checkVehicleUseWarnings: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/clock-vehicle-use", () => ({
	getClockVehicleUseContext: mocks.getClockVehicleUseContext,
	changeLiveVehicleUse: mocks.changeLiveVehicleUse,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/vehicle-use-warnings", () => ({
	checkVehicleUseWarnings: mocks.checkVehicleUseWarnings,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import {
	BreakVehicleReading,
	ClockInVehicleUse,
	ClockOutVehicleUse,
	useClockVehicleUse,
} from "./clock-vehicle-use";

const t = ((_key: string, fallback: string, params?: Record<string, unknown>) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ""))) as never;
const VAN = "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10";
const PERIOD = "a3bb189e-8bf9-4888-9912-ace4e6543002";
const vehicles = [{ id: VAN, name: "Van", licencePlate: "M-VW 1", archived: false }];
const liveVan = {
	vehicle: { kind: "organization", vehicleId: VAN },
	startKm: 12_000,
	endKm: null,
	distanceKm: null,
};

function context(overrides: Record<string, unknown> = {}) {
	return {
		success: true,
		data: {
			mode: "asked",
			vehicles,
			suggestedVehicleIds: [VAN],
			lastEndKmByVehicleId: { [VAN]: 12_000 },
			live: null,
			...overrides,
		},
	};
}

function Clock({ kind }: { kind: "in" | "out" }) {
	const state = useClockVehicleUse({ enabled: true });
	return (
		<div>
			{kind === "in" ? (
				<ClockInVehicleUse state={state} t={t} />
			) : (
				<>
					<ClockOutVehicleUse state={state} t={t} />
					<BreakVehicleReading state={state} t={t} />
				</>
			)}
			<output data-testid="sent">
				{JSON.stringify({ in: state.clockIn, out: state.clockOut, break: state.takenBreak })}
			</output>
		</div>
	);
}

function renderClock(kind: "in" | "out") {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return render(<Clock kind={kind} />, { wrapper });
}

const sent = () => JSON.parse(screen.getByTestId("sent").textContent ?? "{}");

describe("vehicle use at the web clock (#1122)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.checkVehicleUseWarnings.mockResolvedValue({ success: true, data: { warnings: [] } });
	});
	afterEach(cleanup);

	it("pre-selects the assigned vehicle with its last end reading at clock-in", async () => {
		mocks.getClockVehicleUseContext.mockResolvedValue(context());
		renderClock("in");

		expect(await screen.findByLabelText("Start reading (km)")).toHaveProperty("value", "12000");
		expect(screen.queryByLabelText("End reading (km)")).toBeNull();
		expect(sent().in).toEqual({
			ok: true,
			vehicleUse: { vehicle: { kind: "organization", vehicleId: VAN }, startKm: 12_000 },
		});
	});

	it("asks nothing and sends nothing while vehicle use is off", async () => {
		mocks.getClockVehicleUseContext.mockResolvedValue(context({ mode: "off" }));
		renderClock("in");

		await waitFor(() => expect(mocks.getClockVehicleUseContext).toHaveBeenCalled());
		expect(screen.queryByText("Vehicle use")).toBeNull();
		expect(sent().in).toEqual({ ok: true });
	});

	it("asks the end reading at clock-out and names one below the start reading", async () => {
		mocks.getClockVehicleUseContext.mockResolvedValue(
			context({ live: { workPeriodId: PERIOD, vehicleUse: liveVan } }),
		);
		renderClock("out");

		const end = await screen.findByLabelText("End reading (km)");
		fireEvent.change(end, { target: { value: "12085" } });
		expect(sent().out).toEqual({ ok: true, vehicleUse: { endKm: 12_085 } });

		fireEvent.change(end, { target: { value: "11000" } });
		expect(sent().out).toEqual({ ok: false, code: "end_before_start" });
		expect(screen.getByRole("alert").textContent).toMatch(/below the start reading/);
	});

	it("takes one optional break reading while the live work records a vehicle", async () => {
		mocks.getClockVehicleUseContext.mockResolvedValue(
			context({ live: { workPeriodId: PERIOD, vehicleUse: liveVan } }),
		);
		renderClock("out");

		fireEvent.change(await screen.findByLabelText("Odometer reading at the break (km)"), {
			target: { value: "12040" },
		});
		expect(sent().break).toEqual({ ok: true, vehicleUse: { readingKm: 12_040 } });
	});

	it("changes the live start reading while clocked in", async () => {
		mocks.getClockVehicleUseContext.mockResolvedValue(
			context({ live: { workPeriodId: PERIOD, vehicleUse: liveVan } }),
		);
		mocks.changeLiveVehicleUse.mockResolvedValue({ success: true, data: { vehicleUse: null } });
		renderClock("out");

		fireEvent.click(await screen.findByRole("button", { name: "Change" }));
		fireEvent.change(screen.getByLabelText("Start reading (km)"), { target: { value: "12010" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(mocks.changeLiveVehicleUse).toHaveBeenCalledWith({
				workPeriodId: PERIOD,
				vehicleUse: { vehicle: { kind: "organization", vehicleId: VAN }, startKm: 12_010 },
			}),
		);
		expect(mocks.toast.success).toHaveBeenCalled();
	});
});
