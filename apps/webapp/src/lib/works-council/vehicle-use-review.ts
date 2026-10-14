/**
 * The works-council portal's read-only vehicle use section (#1130, spec #807,
 * Time Tracking ADR 0009): the organization switch, the assignments with their
 * mode and the vehicle count, with names following the works council's
 * `identityVisibility`. Odometer readings and driven distances are never part
 * of it: the source carries none, so neither the portal nor its export can
 * render one.
 *
 * Pseudonyms are given out per section, so "Employee A" here need not be
 * "Employee A" in the position capture section.
 *
 * This file has no I/O; `vehicle-use-review-data.ts` loads the source.
 */
import {
	type VehicleUseAssignmentRule,
	type VehicleUseMode,
	vehicleUseModeFor,
} from "@/lib/time-tracking/vehicle-use/policy";
import {
	csvReviewIdentity,
	reviewIdentities,
	reviewIdentitySortKey,
	type WorksCouncilReviewIdentity,
	type WorksCouncilReviewVisibility,
} from "./review-identity";

export type VehicleUseReviewAssignment = {
	id: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	teamName?: string | null;
	employeeId: string | null;
	mode: VehicleUseMode;
};

export type VehicleUseReviewSource = {
	settings: { enabled: boolean };
	assignments: VehicleUseReviewAssignment[];
	/** The organization's active employees. */
	employees: Array<{ employeeId: string; teamId: string | null }>;
	/** Display names of every employee the section may reference, by employee id. */
	employeeNames: Record<string, string>;
	/** How many organization vehicles exist, by state. */
	vehicles: { active: number; archived: number };
};

export type VehicleUseReview = {
	enabled: boolean;
	/** The organization-wide assignment's mode, if one exists. */
	organizationAssignment: VehicleUseMode | null;
	teamAssignments: Array<{ teamName: string; mode: VehicleUseMode }>;
	/** Listed per employee where identities may be referenced, otherwise only counted. */
	employeeAssignments:
		| {
				state: "listed";
				rows: Array<{ employee: WorksCouncilReviewIdentity; mode: VehicleUseMode }>;
		  }
		| { state: "counted"; asked: number; expected: number; off: number };
	/** Active employees vehicle use is asked or expected of right now. */
	coveredEmployees: VehicleUseCoverage;
	vehicles: { active: number; archived: number };
};

/**
 * Active employees whose vehicle use mode is `asked` or `expected` right now
 * (the same rule the clock path uses). Below the works council's minimum
 * aggregation threshold the split by mode is withheld.
 */
export type VehicleUseCoverage =
	| { state: "available"; coveredEmployees: number; asked: number; expected: number }
	| { state: "insufficient_data"; coveredEmployees: number };

export function buildVehicleUseReview(
	source: VehicleUseReviewSource,
	visibility: WorksCouncilReviewVisibility,
): VehicleUseReview {
	const employeeRows = source.assignments.filter(
		(row): row is VehicleUseReviewAssignment & { employeeId: string } =>
			row.assignmentType === "employee" && row.employeeId !== null,
	);
	const employeeIdentity = reviewIdentities(
		visibility.identityVisibility,
		employeeRows.map((row) => row.employeeId),
		(employeeId) => source.employeeNames[employeeId],
	);
	const organization = source.assignments.find((row) => row.assignmentType === "organization");

	return {
		enabled: source.settings.enabled,
		organizationAssignment: organization ? organization.mode : null,
		teamAssignments: source.assignments
			.filter((row) => row.assignmentType === "team")
			.map((row) => ({ teamName: row.teamName ?? "", mode: row.mode }))
			.sort((left, right) => left.teamName.localeCompare(right.teamName)),
		employeeAssignments:
			visibility.identityVisibility === "aggregated"
				? {
						state: "counted",
						asked: employeeRows.filter((row) => row.mode === "asked").length,
						expected: employeeRows.filter((row) => row.mode === "expected").length,
						off: employeeRows.filter((row) => row.mode === "off").length,
					}
				: {
						state: "listed",
						rows: employeeRows
							.map((row) => ({ employee: employeeIdentity(row.employeeId), mode: row.mode }))
							.sort((left, right) =>
								reviewIdentitySortKey(left.employee).localeCompare(
									reviewIdentitySortKey(right.employee),
								),
							),
					},
		coveredEmployees: countCoverage(source, visibility),
		vehicles: { active: source.vehicles.active, archived: source.vehicles.archived },
	};
}

function countCoverage(
	source: VehicleUseReviewSource,
	visibility: WorksCouncilReviewVisibility,
): VehicleUseCoverage {
	const configuration = {
		enabled: source.settings.enabled,
		assignments: source.assignments.flatMap(toAssignmentRule),
	};
	let asked = 0;
	let expected = 0;
	for (const subject of source.employees) {
		const mode = vehicleUseModeFor(subject, configuration);
		if (mode === "asked") asked += 1;
		else if (mode === "expected") expected += 1;
	}
	const coveredEmployees = asked + expected;
	// Named identities already show who is who; a small group hides only behind
	// pseudonyms or aggregates.
	if (
		visibility.identityVisibility !== "named" &&
		coveredEmployees < visibility.minimumAggregationThreshold
	) {
		return { state: "insufficient_data", coveredEmployees };
	}
	return { state: "available", coveredEmployees, asked, expected };
}

function toAssignmentRule(row: VehicleUseReviewAssignment): VehicleUseAssignmentRule[] {
	if (row.assignmentType === "organization") {
		return [{ assignmentType: "organization", mode: row.mode }];
	}
	if (row.assignmentType === "team" && row.teamId) {
		return [{ assignmentType: "team", teamId: row.teamId, mode: row.mode }];
	}
	if (row.assignmentType === "employee" && row.employeeId) {
		return [{ assignmentType: "employee", employeeId: row.employeeId, mode: row.mode }];
	}
	return [];
}

/**
 * The section as CSV rows (cells unquoted) for the works-council review export.
 * Labels are English, like the rest of that export.
 */
export function vehicleUseReviewCsvRows(review: VehicleUseReview): unknown[][] {
	const rows: unknown[][] = [
		["Vehicle use"],
		["Vehicle use enabled", review.enabled ? "yes" : "no"],
		["Organization assignment", review.organizationAssignment ?? "none"],
		...review.teamAssignments.map((row) => ["Team assignment", row.teamName, row.mode]),
	];
	if (review.employeeAssignments.state === "counted") {
		rows.push(
			["Employee assignments asked", review.employeeAssignments.asked],
			["Employee assignments expected", review.employeeAssignments.expected],
			["Employee assignments off", review.employeeAssignments.off],
		);
	} else {
		for (const row of review.employeeAssignments.rows) {
			rows.push(["Employee assignment", csvReviewIdentity(row.employee, "Employee"), row.mode]);
		}
	}
	const coverage = review.coveredEmployees;
	rows.push(["Vehicle use: covered employees", coverage.coveredEmployees]);
	if (coverage.state === "available") {
		rows.push(["Vehicle use: asked", coverage.asked], ["Vehicle use: expected", coverage.expected]);
	} else {
		rows.push(["Vehicle use counts", "insufficient_data"]);
	}
	rows.push(
		["Organization vehicles (active)", review.vehicles.active],
		["Organization vehicles (archived)", review.vehicles.archived],
	);
	return rows;
}
