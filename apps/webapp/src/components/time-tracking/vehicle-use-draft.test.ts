import { describe, expect, it } from "vitest";
import { EMPTY_VEHICLE_USE_DRAFT, vehicleUseDraftOf, vehicleUseFromDraft } from "./vehicle-use-draft";

const vehicleId = "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10";

describe("vehicle use drafts", () => {
	it("submits no vehicle use for an empty draft", () => {
		expect(vehicleUseFromDraft(EMPTY_VEHICLE_USE_DRAFT)).toEqual({ ok: true, input: null, use: null });
	});

	it("derives the distance from both readings", () => {
		expect(
			vehicleUseFromDraft({ vehicle: vehicleId, startKm: "100", endKm: "180", distanceKm: "" }),
		).toEqual({
			ok: true,
			input: {
				vehicle: { kind: "organization", vehicleId },
				startKm: 100,
				endKm: 180,
				distanceKm: null,
			},
			use: {
				vehicle: { kind: "organization", vehicleId },
				startKm: 100,
				endKm: 180,
				distanceKm: 80,
			},
		});
	});

	it("takes the entered distance only without a start reading", () => {
		expect(
			vehicleUseFromDraft({ vehicle: "own", startKm: "", endKm: "", distanceKm: "25" }),
		).toMatchObject({ ok: true, use: { distanceKm: 25 } });
		expect(
			vehicleUseFromDraft({ vehicle: "own", startKm: "10", endKm: "", distanceKm: "25" }),
		).toMatchObject({ ok: true, use: { distanceKm: null } });
	});

	it("refuses an end reading below the start reading, readings without a vehicle and fractions", () => {
		expect(
			vehicleUseFromDraft({ vehicle: "own", startKm: "200", endKm: "150", distanceKm: "" }),
		).toEqual({ ok: false, code: "end_before_start" });
		expect(
			vehicleUseFromDraft({ vehicle: "", startKm: "200", endKm: "", distanceKm: "" }),
		).toEqual({ ok: false, code: "invalid_vehicle" });
		expect(
			vehicleUseFromDraft({ vehicle: "own", startKm: "1.5", endKm: "", distanceKm: "" }),
		).toEqual({ ok: false, code: "invalid_reading" });
	});

	it("round-trips recorded vehicle use", () => {
		const draft = vehicleUseDraftOf({
			vehicle: { kind: "own" },
			startKm: null,
			endKm: null,
			distanceKm: 12,
		});
		expect(draft).toEqual({ vehicle: "own", startKm: "", endKm: "", distanceKm: "12" });
		expect(vehicleUseFromDraft(draft)).toMatchObject({ ok: true, use: { distanceKm: 12 } });
	});
});
