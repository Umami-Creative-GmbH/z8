import { describe, expect, it } from "vitest";
import { licencePlateKey, normalizeLicencePlate, parseVehicleChange } from "./vehicle-rules";

const EMPLOYEE = "0b6f4b5e-3c0a-4f57-9a43-6a4a3f0d2c11";
const TEAM = "6c1c9a2e-8d55-4a8e-9a8b-1f2e3d4c5b6a";
const VEHICLE = "9f8e7d6c-5b4a-4321-8fed-cba987654321";

describe("licence plates", () => {
	it("stores a plate upper-cased with single spaces", () => {
		expect(normalizeLicencePlate("  m-ab   1234 ")).toBe("M-AB 1234");
		expect(normalizeLicencePlate("lö-x 12e")).toBe("LÖ-X 12E");
	});

	it("compares plates without spaces, hyphens and dots", () => {
		expect(licencePlateKey("M-AB 1234")).toBe("MAB1234");
		expect(licencePlateKey("m ab-1234")).toBe("MAB1234");
		expect(licencePlateKey("B.XY 9")).toBe("BXY9");
	});
});

describe("parseVehicleChange", () => {
	it("accepts a new vehicle with normalized name, plate and de-duplicated drivers", () => {
		expect(
			parseVehicleChange({
				kind: "create",
				name: "  Van 1 ",
				licencePlate: "m-ab 1234",
				drivers: { employeeIds: [EMPLOYEE, EMPLOYEE.toUpperCase()], teamIds: [TEAM] },
			}),
		).toEqual({
			ok: true,
			change: {
				kind: "create",
				name: "Van 1",
				licencePlate: "M-AB 1234",
				drivers: { employeeIds: [EMPLOYEE], teamIds: [TEAM] },
			},
		});
	});

	it("treats missing drivers as none", () => {
		expect(
			parseVehicleChange({
				kind: "update",
				vehicleId: VEHICLE,
				name: "Van",
				licencePlate: "B X 1",
			}),
		).toEqual({
			ok: true,
			change: {
				kind: "update",
				vehicleId: VEHICLE,
				name: "Van",
				licencePlate: "B X 1",
				drivers: { employeeIds: [], teamIds: [] },
			},
		});
	});

	it.each([
		[{ kind: "create", name: " ", licencePlate: "B X 1" }, "invalid_name"],
		[{ kind: "create", name: "x".repeat(101), licencePlate: "B X 1" }, "invalid_name"],
		[{ kind: "create", name: "Van", licencePlate: " - " }, "invalid_licence_plate"],
		[{ kind: "create", name: "Van", licencePlate: "B".repeat(21) }, "invalid_licence_plate"],
		[{ kind: "create", name: "Van", licencePlate: 7 }, "invalid_licence_plate"],
		[
			{ kind: "create", name: "Van", licencePlate: "B X 1", drivers: { employeeIds: ["nope"] } },
			"invalid_drivers",
		],
		[
			{ kind: "create", name: "Van", licencePlate: "B X 1", drivers: { teamIds: "x" } },
			"invalid_drivers",
		],
		[{ kind: "update", vehicleId: "1", name: "Van", licencePlate: "B X 1" }, "vehicle_not_found"],
		[{ kind: "archive", vehicleId: 3 }, "vehicle_not_found"],
		[{ kind: "explode", vehicleId: VEHICLE }, "invalid_change"],
		[null, "invalid_change"],
	])("refuses %j with %s", (input, reason) => {
		expect(parseVehicleChange(input)).toEqual({ ok: false, reason });
	});

	it("refuses more than 500 drivers", () => {
		const employeeIds = Array.from(
			{ length: 501 },
			(_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
		);
		expect(
			parseVehicleChange({
				kind: "create",
				name: "Van",
				licencePlate: "B X 1",
				drivers: { employeeIds },
			}),
		).toEqual({ ok: false, reason: "invalid_drivers" });
	});

	it.each(["archive", "restore", "delete"])("accepts %s by vehicle id", (kind) => {
		expect(parseVehicleChange({ kind, vehicleId: VEHICLE.toUpperCase() })).toEqual({
			ok: true,
			change: { kind, vehicleId: VEHICLE },
		});
	});
});
