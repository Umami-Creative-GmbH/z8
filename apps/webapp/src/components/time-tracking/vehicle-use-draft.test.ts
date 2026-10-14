import { describe, expect, it } from "vitest";
import {
	EMPTY_VEHICLE_USE_DRAFT,
	prefilledVehicleUseDraft,
	vehicleUseDraftOf,
	vehicleUseFromDraft,
	withPickedVehicle,
} from "./vehicle-use-draft";

const vehicleId = "0b9f8f2e-6c1d-4d6c-9a43-7f2f3c1f5e10";

describe("vehicle use drafts", () => {
	it("submits no vehicle use for an empty draft", () => {
		expect(vehicleUseFromDraft(EMPTY_VEHICLE_USE_DRAFT)).toEqual({
			ok: true,
			input: null,
			use: null,
		});
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
		expect(vehicleUseFromDraft({ vehicle: "", startKm: "200", endKm: "", distanceKm: "" })).toEqual(
			{ ok: false, code: "invalid_vehicle" },
		);
		expect(
			vehicleUseFromDraft({ vehicle: "own", startKm: "1.5", endKm: "", distanceKm: "" }),
		).toEqual({ ok: false, code: "invalid_reading" });
	});

	describe("pre-fill (#1121)", () => {
		const truckId = "5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
		const context = {
			mode: "asked" as const,
			vehicles: [],
			suggestedVehicleIds: [vehicleId, truckId],
			lastEndKmByVehicleId: { [vehicleId]: 12_400, [truckId]: 50_250 },
		};

		it("pre-selects the first assigned vehicle with its last end reading as the start reading", () => {
			expect(prefilledVehicleUseDraft(context)).toEqual({
				vehicle: vehicleId,
				startKm: "12400",
				endKm: "",
				distanceKm: "",
			});
		});

		it("pre-selects an assigned vehicle without readings with an empty start reading", () => {
			expect(prefilledVehicleUseDraft({ ...context, lastEndKmByVehicleId: {} })).toEqual({
				...EMPTY_VEHICLE_USE_DRAFT,
				vehicle: vehicleId,
			});
		});

		it("pre-fills nothing without an assigned vehicle, or while vehicle use is off", () => {
			expect(prefilledVehicleUseDraft({ ...context, suggestedVehicleIds: [] })).toEqual(
				EMPTY_VEHICLE_USE_DRAFT,
			);
			expect(prefilledVehicleUseDraft({ ...context, mode: "off" })).toEqual(
				EMPTY_VEHICLE_USE_DRAFT,
			);
			expect(prefilledVehicleUseDraft({ mode: "asked", vehicles: [] })).toEqual(
				EMPTY_VEHICLE_USE_DRAFT,
			);
		});

		it("pre-fills the start reading of a newly picked vehicle while it is empty or still pre-filled", () => {
			const readings = context.lastEndKmByVehicleId;
			const prefilled = prefilledVehicleUseDraft(context);
			expect(withPickedVehicle(prefilled, truckId, readings)).toEqual({
				...prefilled,
				vehicle: truckId,
				startKm: "50250",
			});
			expect(withPickedVehicle(EMPTY_VEHICLE_USE_DRAFT, truckId, readings)).toMatchObject({
				vehicle: truckId,
				startKm: "50250",
			});
			// A pre-filled reading of the previous vehicle does not stay with the own vehicle.
			expect(withPickedVehicle(prefilled, "own", readings)).toMatchObject({
				vehicle: "own",
				startKm: "",
			});
		});

		it("keeps a start reading the employee typed when another vehicle is picked", () => {
			const typed = { vehicle: vehicleId, startKm: "12410", endKm: "", distanceKm: "" };
			expect(withPickedVehicle(typed, truckId, context.lastEndKmByVehicleId)).toEqual({
				...typed,
				vehicle: truckId,
			});
		});
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
