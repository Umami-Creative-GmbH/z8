import { describe, expect, it } from "vitest";
import {
	getVacationAssignmentSectionVisibility,
	getWorkPolicyAssignmentSectionVisibility,
} from "./policy-assignment-surface";

describe("policy assignment surface visibility", () => {
	it("hides stripped vacation team sections for scoped managers", () => {
		expect(
			getVacationAssignmentSectionVisibility({
				canManageTeamAssignments: false,
				teamAssignmentsCount: 0,
				canManageEmployeeAssignments: true,
				employeeAssignmentsCount: 0,
			}),
		).toEqual({
			showTeamSection: false,
			showEmployeeSection: true,
		});
	});

	it("keeps vacation team sections visible when data or permissions exist", () => {
		expect(
			getVacationAssignmentSectionVisibility({
				canManageTeamAssignments: true,
				teamAssignmentsCount: 0,
				canManageEmployeeAssignments: true,
				employeeAssignmentsCount: 0,
			}),
		).toEqual({
			showTeamSection: true,
			showEmployeeSection: true,
		});

		expect(
			getVacationAssignmentSectionVisibility({
				canManageTeamAssignments: false,
				teamAssignmentsCount: 2,
				canManageEmployeeAssignments: false,
				employeeAssignmentsCount: 1,
			}),
		).toEqual({
			showTeamSection: true,
			showEmployeeSection: true,
		});
	});

	it("hides stripped organization and team work-policy sections for scoped managers", () => {
		expect(
			getWorkPolicyAssignmentSectionVisibility({
				canManageOrgAssignments: false,
				hasOrgAssignment: false,
				canManageTeamAssignments: false,
				teamAssignmentsCount: 0,
				canManageEmployeeAssignments: true,
				employeeAssignmentsCount: 0,
			}),
		).toEqual({
			showOrgSection: false,
			showTeamSection: false,
			showEmployeeSection: true,
		});
	});

	it("keeps work-policy sections visible when data or permissions exist", () => {
		expect(
			getWorkPolicyAssignmentSectionVisibility({
				canManageOrgAssignments: true,
				hasOrgAssignment: false,
				canManageTeamAssignments: false,
				teamAssignmentsCount: 1,
				canManageEmployeeAssignments: false,
				employeeAssignmentsCount: 1,
			}),
		).toEqual({
			showOrgSection: true,
			showTeamSection: true,
			showEmployeeSection: true,
		});
	});
});
