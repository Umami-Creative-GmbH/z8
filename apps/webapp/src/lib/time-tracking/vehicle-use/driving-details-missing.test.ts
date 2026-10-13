import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type DrivingDetailsConfiguration,
	drivingDetailsExpectedSince,
	isDrivingDetailsMissing,
	lacksDrivingDetails,
} from "./driving-details-missing";
import type { WorkVehicleUse } from "./work-vehicle-use";

const at = parseInstant;
const field = { employeeId: "employee-field", teamId: "team-field" };
const office = { employeeId: "employee-office", teamId: "team-office" };

const van: WorkVehicleUse["vehicle"] = {
	kind: "organization",
	vehicleId: "6f1c9d52-1d7e-4b0a-9a51-2a3b4c5d6e7f",
};

describe("lacksDrivingDetails", () => {
	it("lacks them without a vehicle", () => {
		expect(lacksDrivingDetails(null)).toBe(true);
	});

	it("lacks them while a reading is missing and no distance is known", () => {
		expect(
			lacksDrivingDetails({ vehicle: van, startKm: 1200, endKm: null, distanceKm: null }),
		).toBe(true);
		expect(
			lacksDrivingDetails({ vehicle: { kind: "own" }, startKm: null, endKm: null, distanceKm: null }),
		).toBe(true);
	});

	it("is complete with both readings", () => {
		expect(lacksDrivingDetails({ vehicle: van, startKm: 1200, endKm: 1250, distanceKm: 50 })).toBe(
			false,
		);
	});

	it("is complete with a distance entered directly while the start reading is missing", () => {
		expect(
			lacksDrivingDetails({ vehicle: { kind: "own" }, startKm: null, endKm: null, distanceKm: 42 }),
		).toBe(false);
	});
});

describe("drivingDetailsExpectedSince", () => {
	const configuration = (
		overrides: Partial<DrivingDetailsConfiguration> = {},
	): DrivingDetailsConfiguration => ({
		enabled: true,
		enabledSince: at("2026-09-01T00:00:00Z"),
		assignments: [],
		...overrides,
	});

	it("is null with the organization switch off, whatever is assigned", () => {
		expect(
			drivingDetailsExpectedSince(
				field,
				configuration({
					enabled: false,
					assignments: [
						{ assignmentType: "organization", mode: "expected", since: at("2026-09-02T00:00:00Z") },
					],
				}),
			),
		).toBeNull();
	});

	it("is null for an employee who is only asked, or excluded", () => {
		const assignments = [
			{ assignmentType: "organization" as const, mode: "expected" as const, since: at("2026-09-02T00:00:00Z") },
			{ assignmentType: "team" as const, teamId: field.teamId, mode: "asked" as const, since: at("2026-09-03T00:00:00Z") },
			{
				assignmentType: "employee" as const,
				employeeId: office.employeeId,
				mode: "off" as const,
				since: at("2026-09-03T00:00:00Z"),
			},
		];
		expect(drivingDetailsExpectedSince(field, configuration({ assignments }))).toBeNull();
		expect(drivingDetailsExpectedSince(office, configuration({ assignments }))).toBeNull();
	});

	it("starts when the deciding assignment last became expected, or when the switch was turned on, whichever is later", () => {
		const assignments = [
			{ assignmentType: "organization" as const, mode: "asked" as const, since: at("2026-08-01T00:00:00Z") },
			{
				assignmentType: "team" as const,
				teamId: field.teamId,
				mode: "expected" as const,
				since: at("2026-09-10T00:00:00Z"),
			},
			{
				assignmentType: "employee" as const,
				employeeId: office.employeeId,
				mode: "expected" as const,
				since: at("2026-08-15T00:00:00Z"),
			},
		];
		expect(drivingDetailsExpectedSince(field, configuration({ assignments }))?.toString()).toBe(
			"2026-09-10T00:00:00Z",
		);
		expect(drivingDetailsExpectedSince(office, configuration({ assignments }))?.toString()).toBe(
			"2026-09-01T00:00:00Z",
		);
	});
});

describe("isDrivingDetailsMissing", () => {
	const since = at("2026-09-01T00:00:00Z");
	const work = (overrides: Partial<Parameters<typeof isDrivingDetailsMissing>[0]> = {}) => ({
		startedAt: at("2026-09-02T07:00:00Z"),
		endedAt: at("2026-09-02T15:00:00Z") as ReturnType<typeof at> | null,
		vehicleUse: null as WorkVehicleUse | null,
		...overrides,
	});

	it("flags completed work of an expected employee that lacks its vehicle or a reading", () => {
		expect(isDrivingDetailsMissing(work(), since)).toBe(true);
		expect(
			isDrivingDetailsMissing(
				work({ vehicleUse: { vehicle: van, startKm: 10, endKm: null, distanceKm: null } }),
				since,
			),
		).toBe(true);
	});

	it("clears once the details are completed", () => {
		expect(
			isDrivingDetailsMissing(
				work({ vehicleUse: { vehicle: van, startKm: 10, endKm: 60, distanceKm: 50 } }),
				since,
			),
		).toBe(false);
	});

	it("never flags an employee who is not expected to record vehicle use", () => {
		expect(isDrivingDetailsMissing(work(), null)).toBe(false);
	});

	it("never flags live work, nor work that started before vehicle use was expected", () => {
		expect(isDrivingDetailsMissing(work({ endedAt: null }), since)).toBe(false);
		expect(
			isDrivingDetailsMissing(
				work({ startedAt: at("2026-08-31T23:00:00Z"), endedAt: at("2026-09-01T03:00:00Z") }),
				since,
			),
		).toBe(false);
	});
});
