/**
 * #1124: the desktop asks for the same vehicle use plausibility warnings as the
 * web clock. The route is a thin adapter over the `checkVehicleUseWarnings`
 * server action, whose rules run on PostgreSQL in
 * `time-tracking/actions/vehicle-use-warnings.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/vehicle-use-warnings", () => ({
	checkVehicleUseWarnings: state.check,
}));

const { POST } = await import("./route");

async function post(body: unknown) {
	const response = await POST(
		new Request("https://z8.test/api/desktop/vehicle-use-warnings", {
			method: "POST",
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
	);
	return { status: response.status, body: await response.json() };
}

const vehicleUse = {
	vehicle: { kind: "organization", vehicleId: "0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5" },
	startKm: 12_000,
};

describe("POST /api/desktop/vehicle-use-warnings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.check.mockResolvedValue({
			success: true,
			data: { warnings: [{ code: "start_below_last_end", lastRecordedEndKm: 12_500 }] },
		});
	});

	it("checks a clock-in starting now for the signed-in employee", async () => {
		await expect(post({ vehicleUse })).resolves.toEqual({
			status: 200,
			body: { warnings: [{ code: "start_below_last_end", lastRecordedEndKm: 12_500 }] },
		});
		expect(state.check).toHaveBeenCalledWith({ vehicleUse });
	});

	it("checks the clock-out of the live work it names, never someone else's", async () => {
		const closingWorkPeriodId = "5c0b1a8e-2f4d-4e6a-9b3c-7d8e9f0a1b2c";
		await post({ vehicleUse, closingWorkPeriodId, targetEmployeeId: "someone-else" });

		expect(state.check).toHaveBeenCalledWith({ vehicleUse, closingWorkPeriodId });
	});

	it("answers no warnings when the check fails or the body is unreadable", async () => {
		state.check.mockResolvedValue({ success: false, error: "Not authenticated" });
		await expect(post({ vehicleUse })).resolves.toEqual({
			status: 200,
			body: { warnings: [] },
		});
		await expect(post("not json")).resolves.toEqual({ status: 400, body: { warnings: [] } });
	});
});
