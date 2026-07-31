import { describe, expect, it } from "vitest";
import type {
	EligibleManagerEmployee,
	EligibleManagerLink,
	EligibleTeam,
	EligibleTeamMembership,
} from "../policies/manager-eligibility";
import {
	ApprovalStageActivationError,
	type ApprovalStageResolverSnapshot,
	resolveApprovalStageReviewers,
} from "./approver-resolver";
import type { ApprovalRoutingContext } from "./types";

interface Directory {
	employees: EligibleManagerEmployee[];
	managerLinks: EligibleManagerLink[];
	teamMemberships: EligibleTeamMembership[];
	teams: EligibleTeam[];
}

function context(): ApprovalRoutingContext {
	return {
		organizationId: "org-1",
		workflowType: "manual_time_submission",
		source: { type: "time_entry", id: "entry-1" },
		requesterEmployeeId: "requester",
		teamIds: [],
		locationId: null,
		absenceCategoryId: null,
		travelExpenseAmount: null,
		overtimeRisk: null,
		employeeGroupIds: [],
	};
}

function stage(
	overrides: Partial<ApprovalStageResolverSnapshot> = {},
): ApprovalStageResolverSnapshot {
	return {
		approverType: "direct_manager",
		fallbackBehavior: "fail",
		...overrides,
	};
}

function directory(overrides: Partial<Directory> = {}): Directory {
	return {
		employees: [
			{
				id: "requester",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
			},
			{
				id: "manager-a",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
			{
				id: "manager-b",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
			{
				id: "director-a",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
			{
				id: "director-b",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
			{
				id: "team-lead",
				organizationId: "org-1",
				isActive: true,
				role: "manager",
			},
			{ id: "admin-a", organizationId: "org-1", isActive: true, role: "admin" },
			{ id: "admin-b", organizationId: "org-1", isActive: true, role: "admin" },
			{
				id: "inactive",
				organizationId: "org-1",
				isActive: false,
				role: "admin",
			},
			{
				id: "foreign",
				organizationId: "org-2",
				isActive: true,
				role: "admin",
			},
		],
		managerLinks: [],
		teamMemberships: [],
		teams: [],
		...overrides,
	};
}

function expectActivationError(
	resolve: () => unknown,
	code: ApprovalStageActivationError["code"],
	message: string,
) {
	try {
		resolve();
	} catch (error) {
		expect(error).toBeInstanceOf(ApprovalStageActivationError);
		expect(error).toMatchObject({ code, message });
		return;
	}

	throw new Error("Expected reviewer resolution to throw an activation error.");
}

describe("resolveApprovalStageReviewers", () => {
	it("returns every sorted eligible direct manager", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage(),
				directory: directory({
					managerLinks: [
						{ employeeId: "requester", managerId: "manager-b" },
						{
							employeeId: "requester",
							managerId: "manager-a",
							isPrimary: true,
						},
					],
				}),
			}),
		).toEqual({
			activationMode: "human",
			approverEmployeeIds: ["manager-a", "manager-b"],
		});
	});

	it("uses team managers when the requester has no direct manager", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage(),
				directory: directory({
					teamMemberships: [{ employeeId: "requester", teamId: "team-a" }],
					teams: [
						{
							id: "team-a",
							organizationId: "org-1",
							primaryManagerId: "manager-a",
						},
					],
				}),
			}),
		).toEqual({ activationMode: "human", approverEmployeeIds: ["manager-a"] });
	});

	it("uses the deterministic primary team manager and only its direct managers for manager_manager", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({ approverType: "manager_manager" }),
				directory: directory({
					managerLinks: [
						{ employeeId: "manager-a", managerId: "director-a" },
						{ employeeId: "manager-b", managerId: "director-b" },
					],
					teamMemberships: [
						{ employeeId: "requester", teamId: "team-b" },
						{ employeeId: "requester", teamId: "team-a" },
						{ employeeId: "manager-a", teamId: "leadership" },
					],
					teams: [
						{
							id: "team-a",
							organizationId: "org-1",
							primaryManagerId: "manager-a",
						},
						{
							id: "team-b",
							organizationId: "org-1",
							primaryManagerId: "manager-b",
						},
						{
							id: "leadership",
							organizationId: "org-1",
							primaryManagerId: "team-lead",
						},
					],
				}),
			}),
		).toEqual({ activationMode: "human", approverEmployeeIds: ["director-a"] });
	});

	it("uses the primary direct manager's active direct manager for manager_manager", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({ approverType: "manager_manager" }),
				directory: directory({
					managerLinks: [
						{ employeeId: "requester", managerId: "manager-b" },
						{
							employeeId: "requester",
							managerId: "manager-a",
							isPrimary: true,
						},
						{ employeeId: "manager-a", managerId: "director-a" },
					],
				}),
			}),
		).toEqual({ activationMode: "human", approverEmployeeIds: ["director-a"] });
	});

	it("does not use a selected primary manager's team fallback for manager_manager", () => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({ approverType: "manager_manager" }),
					directory: directory({
						managerLinks: [
							{
								employeeId: "requester",
								managerId: "manager-a",
								isPrimary: true,
							},
						],
						teamMemberships: [
							{ employeeId: "manager-a", teamId: "leadership" },
						],
						teams: [
							{
								id: "leadership",
								organizationId: "org-1",
								primaryManagerId: "team-lead",
							},
						],
					}),
				}),
			"no_eligible_reviewer",
			"No eligible reviewer.",
		);
	});

	it("returns every active organization admin", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({ approverType: "org_admin" }),
				directory: directory(),
			}),
		).toEqual({
			activationMode: "human",
			approverEmployeeIds: ["admin-a", "admin-b"],
		});
	});

	it("returns an active specific employee in the organization", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({
					approverType: "specific_employee",
					approverEmployeeId: "manager-a",
				}),
				directory: directory(),
			}),
		).toEqual({ activationMode: "human", approverEmployeeIds: ["manager-a"] });
	});

	it.each([
		"inactive",
		"foreign",
	])("fails closed for a %s specific employee", (approverEmployeeId) => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType: "specific_employee",
						approverEmployeeId,
					}),
					directory: directory(),
				}),
			"no_eligible_reviewer",
			"No eligible reviewer.",
		);
	});

	it("returns requester auto approval when the requester is an eligible candidate", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({
					approverType: "specific_employee",
					approverEmployeeId: "requester",
				}),
				directory: directory(),
			}),
		).toEqual({
			activationMode: "requester_auto_approve",
			reason: "requester_is_approver",
		});
	});

	it("uses every sorted normal manager when default_manager follows an ineligible primary", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({
					approverType: "specific_employee",
					approverEmployeeId: "inactive",
					fallbackBehavior: "default_manager",
				}),
				directory: directory({
					managerLinks: [
						{ employeeId: "requester", managerId: "manager-b" },
						{ employeeId: "requester", managerId: "manager-a" },
						{ employeeId: "requester", managerId: "manager-b" },
					],
				}),
			}),
		).toEqual({
			activationMode: "human",
			approverEmployeeIds: ["manager-a", "manager-b"],
		});
	});

	it("uses active in-organization admins when organization_admin follows an ineligible primary", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({
					approverType: "specific_employee",
					approverEmployeeId: "inactive",
					fallbackBehavior: "organization_admin",
				}),
				directory: directory({
					employees: [
						...directory().employees,
						{
							id: "admin-b",
							organizationId: "org-1",
							isActive: true,
							role: "admin",
						},
					],
				}),
			}),
		).toEqual({
			activationMode: "human",
			approverEmployeeIds: ["admin-a", "admin-b"],
		});
	});

	it("auto-approves when the requester is an organization_admin fallback candidate", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({
					approverType: "specific_employee",
					approverEmployeeId: "inactive",
					fallbackBehavior: "organization_admin",
				}),
				directory: directory({
					employees: directory().employees.map((employee) =>
						employee.id === "requester"
							? { ...employee, role: "admin" }
							: employee,
					),
				}),
			}),
		).toEqual({
			activationMode: "requester_auto_approve",
			reason: "requester_is_approver",
		});
	});

	it("does not use a human fallback when fail follows an ineligible primary", () => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType: "specific_employee",
						approverEmployeeId: "inactive",
						fallbackBehavior: "fail",
					}),
					directory: directory({
						managerLinks: [{ employeeId: "requester", managerId: "manager-a" }],
					}),
				}),
			"no_eligible_reviewer",
			"No eligible reviewer.",
		);
	});

	it.each([
		["default_manager", directory()],
		[
			"organization_admin",
			directory({
				employees: directory().employees.filter(
					(employee) => employee.role !== "admin",
				),
			}),
		],
	])("fails closed when the %s fallback has no candidate", (fallbackBehavior, fallbackDirectory) => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType: "specific_employee",
						approverEmployeeId: "inactive",
						fallbackBehavior,
					}),
					directory: fallbackDirectory,
				}),
			"no_eligible_reviewer",
			"No eligible reviewer.",
		);
	});

	it("fails closed for an unsupported persisted fallback value", () => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType: "specific_employee",
						approverEmployeeId: "inactive",
						fallbackBehavior: "unknown",
					}),
					directory: directory(),
				}),
			"invalid_stage_resolver",
			"Unsupported fallback behavior.",
		);
	});

	it("fails closed for an unsupported fallback when the primary has a human reviewer", () => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType: "specific_employee",
						approverEmployeeId: "manager-a",
						fallbackBehavior: "unknown",
					}),
					directory: directory(),
				}),
			"invalid_stage_resolver",
			"Unsupported fallback behavior.",
		);
	});

	it("fails closed for an unsupported fallback when the primary auto-approves", () => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType: "specific_employee",
						approverEmployeeId: "requester",
						fallbackBehavior: "unknown",
					}),
					directory: directory(),
				}),
			"invalid_stage_resolver",
			"Unsupported fallback behavior.",
		);
	});

	it.each([
		[
			"missing",
			undefined,
			"default_manager",
			directory({
				managerLinks: [{ employeeId: "requester", managerId: "manager-a" }],
			}),
		],
		["blank", "", "organization_admin", directory()],
		[
			"non-string",
			42 as unknown as string,
			"default_manager",
			directory({
				managerLinks: [{ employeeId: "requester", managerId: "manager-a" }],
			}),
		],
	])("fails closed for a %s specific_employee ID before fallback resolution", (_description, approverEmployeeId, fallbackBehavior, fallbackDirectory) => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType: "specific_employee",
						approverEmployeeId,
						fallbackBehavior,
					}),
					directory: fallbackDirectory,
				}),
			"invalid_stage_resolver",
			"Unsupported specific employee.",
		);
	});

	it("uses organization_admin fallback when an inactive requester has no primary candidate", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({
					approverType: "specific_employee",
					approverEmployeeId: "manager-a",
					fallbackBehavior: "organization_admin",
				}),
				directory: directory({
					employees: directory().employees.map((employee) =>
						employee.id === "requester"
							? { ...employee, isActive: false, role: "admin" }
							: employee,
					),
				}),
			}),
		).toEqual({
			activationMode: "human",
			approverEmployeeIds: ["admin-a", "admin-b"],
		});
	});

	it("fails closed when an inactive requester has no primary candidate and fallback is fail", () => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType: "specific_employee",
						approverEmployeeId: "inactive",
						fallbackBehavior: "fail",
					}),
					directory: directory({
						employees: directory().employees.map((employee) =>
							employee.id === "requester"
								? { ...employee, isActive: false }
								: employee,
						),
					}),
				}),
			"no_eligible_reviewer",
			"No eligible reviewer.",
		);
	});

	it("uses organization_admin fallback when the requester is absent from the directory", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({
					approverType: "specific_employee",
					approverEmployeeId: "manager-a",
					fallbackBehavior: "organization_admin",
				}),
				directory: directory({
					employees: directory().employees.filter(
						(employee) => employee.id !== "requester",
					),
				}),
			}),
		).toEqual({
			activationMode: "human",
			approverEmployeeIds: ["admin-a", "admin-b"],
		});
	});

	it("uses organization_admin fallback when the requester belongs to another organization", () => {
		expect(
			resolveApprovalStageReviewers({
				context: context(),
				stage: stage({
					approverType: "specific_employee",
					approverEmployeeId: "manager-a",
					fallbackBehavior: "organization_admin",
				}),
				directory: directory({
					employees: directory().employees.map((employee) =>
						employee.id === "requester"
							? { ...employee, organizationId: "org-2", role: "admin" }
							: employee,
					),
				}),
			}),
		).toEqual({
			activationMode: "human",
			approverEmployeeIds: ["admin-a", "admin-b"],
		});
	});

	it.each([
		"team_lead",
		"unknown",
	])("rejects unsupported %s resolver types without fallback", (approverType) => {
		expectActivationError(
			() =>
				resolveApprovalStageReviewers({
					context: context(),
					stage: stage({
						approverType,
						fallbackBehavior: "organization_admin",
					}),
					directory: directory(),
				}),
			"invalid_stage_resolver",
			"Unsupported approver type.",
		);
	});
});
