import { describe, expect, it } from "vitest";
import { type VehicleUseAssignmentRule, vehicleUseModeFor } from "./policy";

const field = { employeeId: "employee-field", teamId: "team-field" };
const office = { employeeId: "employee-office", teamId: "team-office" };
const teamless = { employeeId: "employee-teamless", teamId: null };

describe("vehicleUseModeFor", () => {
	it("is off for everyone while the organization switch is off, whatever is assigned", () => {
		const assignments: VehicleUseAssignmentRule[] = [
			{ assignmentType: "organization", mode: "expected" },
			{ assignmentType: "employee", employeeId: field.employeeId, mode: "expected" },
		];
		expect(vehicleUseModeFor(field, { enabled: false, assignments })).toBe("off");
		expect(vehicleUseModeFor(teamless, { enabled: false, assignments })).toBe("off");
	});

	it("is off with the switch on but nobody assigned", () => {
		expect(vehicleUseModeFor(field, { enabled: true, assignments: [] })).toBe("off");
	});

	it("applies the organization assignment to everyone without a more specific one", () => {
		const assignments: VehicleUseAssignmentRule[] = [
			{ assignmentType: "organization", mode: "asked" },
		];
		expect(vehicleUseModeFor(field, { enabled: true, assignments })).toBe("asked");
		expect(vehicleUseModeFor(teamless, { enabled: true, assignments })).toBe("asked");
	});

	it("lets the primary team's assignment win over the organization's", () => {
		const assignments: VehicleUseAssignmentRule[] = [
			{ assignmentType: "organization", mode: "asked" },
			{ assignmentType: "team", teamId: field.teamId, mode: "expected" },
		];
		expect(vehicleUseModeFor(field, { enabled: true, assignments })).toBe("expected");
		expect(vehicleUseModeFor(office, { enabled: true, assignments })).toBe("asked");
		expect(vehicleUseModeFor(teamless, { enabled: true, assignments })).toBe("asked");
	});

	it("lets the employee's own assignment win over their team's, including an exclusion", () => {
		const assignments: VehicleUseAssignmentRule[] = [
			{ assignmentType: "organization", mode: "asked" },
			{ assignmentType: "team", teamId: field.teamId, mode: "expected" },
			{ assignmentType: "employee", employeeId: field.employeeId, mode: "off" },
			{ assignmentType: "employee", employeeId: office.employeeId, mode: "expected" },
		];
		expect(vehicleUseModeFor(field, { enabled: true, assignments })).toBe("off");
		expect(vehicleUseModeFor(office, { enabled: true, assignments })).toBe("expected");
	});

	it("lets a team exclusion win over the organization assignment", () => {
		const assignments: VehicleUseAssignmentRule[] = [
			{ assignmentType: "organization", mode: "expected" },
			{ assignmentType: "team", teamId: office.teamId, mode: "off" },
		];
		expect(vehicleUseModeFor(office, { enabled: true, assignments })).toBe("off");
		expect(vehicleUseModeFor(field, { enabled: true, assignments })).toBe("expected");
	});
});
