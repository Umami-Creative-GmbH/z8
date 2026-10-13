import { describe, expect, it } from "vitest";
import {
	buildVehicleUseReview,
	type VehicleUseReviewSource,
	vehicleUseReviewCsvRows,
} from "./vehicle-use-review";

function source(overrides: Partial<VehicleUseReviewSource> = {}): VehicleUseReviewSource {
	return {
		settings: { enabled: true },
		assignments: [],
		employees: [],
		employeeNames: {},
		vehicles: { active: 0, archived: 0 },
		...overrides,
	};
}

const named = { identityVisibility: "named", minimumAggregationThreshold: 1 } as const;

const assignments: VehicleUseReviewSource["assignments"] = [
	{
		id: "a-org",
		assignmentType: "organization",
		teamId: null,
		employeeId: null,
		mode: "asked",
	},
	{
		id: "a-service",
		assignmentType: "team",
		teamId: "team-service",
		teamName: "Service",
		employeeId: null,
		mode: "expected",
	},
	{
		id: "a-office",
		assignmentType: "team",
		teamId: "team-office",
		teamName: "Office",
		employeeId: null,
		mode: "off",
	},
	{
		id: "a-ben",
		assignmentType: "employee",
		teamId: null,
		employeeId: "e-ben",
		mode: "expected",
	},
	{
		id: "a-anna",
		assignmentType: "employee",
		teamId: null,
		employeeId: "e-anna",
		mode: "off",
	},
];
const employeeNames = { "e-anna": "Anna Field", "e-ben": "Ben Office" };

describe("buildVehicleUseReview configuration", () => {
	it("shows the switch, the assignments with their mode and the vehicle count", () => {
		const review = buildVehicleUseReview(
			source({ assignments, employeeNames, vehicles: { active: 3, archived: 1 } }),
			named,
		);

		expect(review.enabled).toBe(true);
		expect(review.organizationAssignment).toBe("asked");
		expect(review.teamAssignments).toEqual([
			{ teamName: "Office", mode: "off" },
			{ teamName: "Service", mode: "expected" },
		]);
		expect(review.employeeAssignments).toEqual({
			state: "listed",
			rows: [
				{ employee: { kind: "named", name: "Anna Field" }, mode: "off" },
				{ employee: { kind: "named", name: "Ben Office" }, mode: "expected" },
			],
		});
		expect(review.vehicles).toEqual({ active: 3, archived: 1 });
	});

	it("lists employee assignments under pseudonyms when identities are pseudonymized", () => {
		const review = buildVehicleUseReview(source({ assignments, employeeNames }), {
			identityVisibility: "pseudonymized",
			minimumAggregationThreshold: 1,
		});

		expect(review.employeeAssignments).toEqual({
			state: "listed",
			rows: [
				{ employee: { kind: "pseudonym", ref: "A" }, mode: "off" },
				{ employee: { kind: "pseudonym", ref: "B" }, mode: "expected" },
			],
		});
		expect(JSON.stringify(review)).not.toMatch(/Anna|Ben|e-anna|e-ben/);
	});

	it("only counts employee assignments per mode when identities are aggregated", () => {
		const review = buildVehicleUseReview(source({ assignments, employeeNames }), {
			identityVisibility: "aggregated",
			minimumAggregationThreshold: 1,
		});

		expect(review.employeeAssignments).toEqual({
			state: "counted",
			asked: 0,
			expected: 1,
			off: 1,
		});
		expect(JSON.stringify(review)).not.toMatch(/Anna|Ben|e-anna|e-ben/);
	});
});

describe("vehicleUseReviewCsvRows", () => {
	const review = (identityVisibility: "aggregated" | "pseudonymized" | "named") =>
		buildVehicleUseReview(
			source({
				assignments,
				employeeNames,
				employees: [
					{ employeeId: "e-ben", teamId: null },
					{ employeeId: "e-carl", teamId: "team-service" },
					{ employeeId: "e-emil", teamId: null },
				],
				vehicles: { active: 2, archived: 1 },
			}),
			{ identityVisibility, minimumAggregationThreshold: 1 },
		);

	it("writes the switch, assignments with their mode, covered employees and vehicle count", () => {
		const rows = vehicleUseReviewCsvRows(review("named"));

		expect(rows).toEqual([
			["Vehicle use"],
			["Vehicle use enabled", "yes"],
			["Organization assignment", "asked"],
			["Team assignment", "Office", "off"],
			["Team assignment", "Service", "expected"],
			["Employee assignment", "Anna Field", "off"],
			["Employee assignment", "Ben Office", "expected"],
			["Vehicle use: covered employees", 3],
			["Vehicle use: asked", 1],
			["Vehicle use: expected", 2],
			["Organization vehicles (active)", 2],
			["Organization vehicles (archived)", 1],
		]);
	});

	it("writes no names under pseudonymized or aggregated identities", () => {
		const pseudonymized = vehicleUseReviewCsvRows(review("pseudonymized"));
		expect(JSON.stringify(pseudonymized)).not.toMatch(/Anna|Ben/);
		expect(pseudonymized).toContainEqual(["Employee assignment", "Employee A", "off"]);
		expect(pseudonymized).toContainEqual(["Employee assignment", "Employee B", "expected"]);

		const aggregated = vehicleUseReviewCsvRows(review("aggregated"));
		expect(JSON.stringify(aggregated)).not.toMatch(/Anna|Ben|Employee A/);
		expect(aggregated).toContainEqual(["Employee assignments asked", 0]);
		expect(aggregated).toContainEqual(["Employee assignments expected", 1]);
		expect(aggregated).toContainEqual(["Employee assignments off", 1]);
	});

	it("writes insufficient data instead of the split below the minimum aggregation threshold", () => {
		const rows = vehicleUseReviewCsvRows(
			buildVehicleUseReview(
				source({ assignments, employees: [{ employeeId: "e-emil", teamId: null }] }),
				{ identityVisibility: "aggregated", minimumAggregationThreshold: 3 },
			),
		);

		expect(rows).toContainEqual(["Vehicle use: covered employees", 1]);
		expect(rows).toContainEqual(["Vehicle use counts", "insufficient_data"]);
		expect(JSON.stringify(rows)).not.toMatch(/Vehicle use: asked|Vehicle use: expected/);
	});

	it("writes 'none' when the organization has no assignment of its own", () => {
		const rows = vehicleUseReviewCsvRows(buildVehicleUseReview(source(), named));
		expect(rows).toContainEqual(["Organization assignment", "none"]);
	});
});

describe("buildVehicleUseReview covered employees", () => {
	const employees = [
		// Own assignment "expected" wins over the team's "off".
		{ employeeId: "e-ben", teamId: "team-office" },
		// Own assignment "off" wins over the team's "expected".
		{ employeeId: "e-anna", teamId: "team-service" },
		// Team "expected".
		{ employeeId: "e-carl", teamId: "team-service" },
		// Team "off" wins over the organization's "asked".
		{ employeeId: "e-dora", teamId: "team-office" },
		// Organization "asked".
		{ employeeId: "e-emil", teamId: null },
		{ employeeId: "e-finn", teamId: "team-without-assignment" },
	];

	it("counts the active employees vehicle use is asked or expected of right now", () => {
		const review = buildVehicleUseReview(source({ assignments, employees }), named);

		expect(review.coveredEmployees).toEqual({
			state: "available",
			coveredEmployees: 4,
			asked: 2,
			expected: 2,
		});
	});

	it("covers nobody while the organization switch is off", () => {
		const review = buildVehicleUseReview(
			source({ settings: { enabled: false }, assignments, employees }),
			named,
		);

		expect(review.enabled).toBe(false);
		expect(review.coveredEmployees).toEqual({
			state: "available",
			coveredEmployees: 0,
			asked: 0,
			expected: 0,
		});
	});

	it("withholds the split below the minimum aggregation threshold unless identities are named", () => {
		for (const identityVisibility of ["aggregated", "pseudonymized"] as const) {
			expect(
				buildVehicleUseReview(source({ assignments, employees }), {
					identityVisibility,
					minimumAggregationThreshold: 5,
				}).coveredEmployees,
			).toEqual({ state: "insufficient_data", coveredEmployees: 4 });
		}
		expect(
			buildVehicleUseReview(source({ assignments, employees }), {
				identityVisibility: "named",
				minimumAggregationThreshold: 5,
			}).coveredEmployees.state,
		).toBe("available");
		expect(
			buildVehicleUseReview(source({ assignments, employees }), {
				identityVisibility: "aggregated",
				minimumAggregationThreshold: 4,
			}).coveredEmployees.state,
		).toBe("available");
	});
});
