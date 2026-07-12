/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	getVacationAssignmentSectionVisibility,
	getWorkPolicyAssignmentSectionVisibility,
} from "./policy-assignment-surface";
import { WorkPolicyAssignmentSections } from "./work-policy/work-policy-assignment-sections";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

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

	it("renders work-policy sections that are visible from assignment data or permissions", () => {
		const visibility = getWorkPolicyAssignmentSectionVisibility({
			canManageOrgAssignments: false,
			hasOrgAssignment: false,
			canManageTeamAssignments: false,
			teamAssignmentsCount: 1,
			canManageEmployeeAssignments: true,
			employeeAssignmentsCount: 0,
		});

		render(
			createElement(WorkPolicyAssignmentSections, {
				sections: {
					...(visibility.showTeamSection
						? {
							team: {
								assignments: [
									{
										id: "team-assignment-1",
										team: { id: "team-1", name: "Support" },
										policy: { id: "policy-1", name: "Support policy" },
									},
								],
								canManage: false,
							},
						}
						: {}),
					...(visibility.showEmployeeSection
						? { employee: { assignments: [], canManage: true } }
						: {}),
				},
				onAssignClick: vi.fn(),
				onDeleteClick: vi.fn(),
			}),
		);

		expect(screen.queryByText("Organization Default")).toBeNull();
		expect(screen.getByText("Team Overrides")).toBeTruthy();
		expect(screen.getByText("Support")).toBeTruthy();
		expect(screen.getByText("Employee Overrides")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add Employee" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Add Team" })).toBeNull();
	});

	it("labels assignment removal controls", () => {
		render(
			createElement(WorkPolicyAssignmentSections, {
				sections: {
					organization: {
						assignment: {
							id: "org-assignment-1",
							policy: { id: "policy-1", name: "Default policy" },
						},
						canManage: true,
					},
				},
				onAssignClick: vi.fn(),
				onDeleteClick: vi.fn(),
			}),
		);

		expect(screen.getByRole("button", { name: "Remove Assignment" })).toBeTruthy();
	});
});
