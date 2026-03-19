export function getVacationAssignmentSectionVisibility(input: {
	canManageTeamAssignments: boolean;
	teamAssignmentsCount: number;
	canManageEmployeeAssignments: boolean;
	employeeAssignmentsCount: number;
}) {
	return {
		showTeamSection: input.canManageTeamAssignments || input.teamAssignmentsCount > 0,
		showEmployeeSection: input.canManageEmployeeAssignments || input.employeeAssignmentsCount > 0,
	};
}

export function getWorkPolicyAssignmentSectionVisibility(input: {
	canManageOrgAssignments: boolean;
	hasOrgAssignment: boolean;
	canManageTeamAssignments: boolean;
	teamAssignmentsCount: number;
	canManageEmployeeAssignments: boolean;
	employeeAssignmentsCount: number;
}) {
	return {
		showOrgSection: input.canManageOrgAssignments || input.hasOrgAssignment,
		showTeamSection: input.canManageTeamAssignments || input.teamAssignmentsCount > 0,
		showEmployeeSection: input.canManageEmployeeAssignments || input.employeeAssignmentsCount > 0,
	};
}
