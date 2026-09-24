import { describe, expect, it } from "vitest";
import {
	requesterMayBeResolved,
	resolveDirectEligibleManagers,
	resolveEligibleManagers,
	resolvePrimaryEligibleManager,
} from "./manager-eligibility";

const employees = [
	{
		id: "requester",
		organizationId: "org-1",
		isActive: true,
		role: "employee" as const,
	},
	{
		id: "direct-a",
		organizationId: "org-1",
		isActive: true,
		role: "manager" as const,
	},
	{
		id: "direct-b",
		organizationId: "org-1",
		isActive: true,
		role: "manager" as const,
	},
	{
		id: "team-manager-a",
		organizationId: "org-1",
		isActive: true,
		role: "manager" as const,
	},
	{
		id: "team-manager-b",
		organizationId: "org-1",
		isActive: true,
		role: "admin" as const,
	},
	{
		id: "inactive-manager",
		organizationId: "org-1",
		isActive: false,
		role: "manager" as const,
	},
	{
		id: "employee-role",
		organizationId: "org-1",
		isActive: true,
		role: "employee" as const,
	},
	{
		id: "other-org-manager",
		organizationId: "org-2",
		isActive: true,
		role: "manager" as const,
	},
];

describe("resolveEligibleManagers", () => {
	it("uses active direct managers before team managers", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [{ employeeId: "requester", managerId: "direct-b" }],
				teamMemberships: [{ employeeId: "requester", teamId: "team-a" }],
				teams: [
					{
						id: "team-a",
						organizationId: "org-1",
						primaryManagerId: "team-manager-a",
					},
				],
			}),
		).toEqual({ ok: true, source: "direct", managerIds: ["direct-b"] });
	});

	it("falls back to primary managers for every team membership", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [],
				teamMemberships: [
					{ employeeId: "requester", teamId: "team-a" },
					{ employeeId: "requester", teamId: "team-b" },
				],
				teams: [
					{
						id: "team-a",
						organizationId: "org-1",
						primaryManagerId: "team-manager-a",
					},
					{
						id: "team-b",
						organizationId: "org-1",
						primaryManagerId: "team-manager-b",
					},
				],
			}),
		).toEqual({
			ok: true,
			source: "team",
			managerIds: ["team-manager-a", "team-manager-b"],
		});
	});

	it("dedupes team managers and ignores invalid managers", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [
					{ employeeId: "requester", managerId: "inactive-manager" },
				],
				teamMemberships: [
					{ employeeId: "requester", teamId: "team-a" },
					{ employeeId: "requester", teamId: "team-b" },
					{ employeeId: "requester", teamId: "team-c" },
					{ employeeId: "requester", teamId: "team-d" },
				],
				teams: [
					{
						id: "team-a",
						organizationId: "org-1",
						primaryManagerId: "team-manager-a",
					},
					{
						id: "team-b",
						organizationId: "org-1",
						primaryManagerId: "team-manager-a",
					},
					{
						id: "team-c",
						organizationId: "org-1",
						primaryManagerId: "employee-role",
					},
					{
						id: "team-d",
						organizationId: "org-1",
						primaryManagerId: "other-org-manager",
					},
				],
			}),
		).toEqual({ ok: true, source: "team", managerIds: ["team-manager-a"] });
	});

	it("returns a clear failure when no eligible manager resolves", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [],
				teamMemberships: [],
				teams: [],
			}),
		).toEqual({
			ok: false,
			reason:
				"Requester has no active direct or team manager in this organization.",
		});
	});

	it("rejects inactive requesters before resolving managers", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees: employees.map((employee) =>
					employee.id === "requester"
						? { ...employee, isActive: false }
						: employee,
				),
				managerLinks: [{ employeeId: "requester", managerId: "direct-a" }],
				teamMemberships: [],
				teams: [],
			}),
		).toEqual({
			ok: false,
			reason: "Requester is not active in this organization.",
		});
	});

	it("rejects cross-organization requesters before resolving managers", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees: employees.map((employee) =>
					employee.id === "requester"
						? { ...employee, organizationId: "org-2" }
						: employee,
				),
				managerLinks: [{ employeeId: "requester", managerId: "direct-a" }],
				teamMemberships: [],
				teams: [],
			}),
		).toEqual({
			ok: false,
			reason: "Requester is not active in this organization.",
		});
	});

	it("selects a deterministic display approver", () => {
		expect(
			resolvePrimaryEligibleManager({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [
					{ employeeId: "requester", managerId: "direct-b" },
					{ employeeId: "requester", managerId: "direct-a", isPrimary: true },
				],
				teamMemberships: [],
				teams: [],
			}),
		).toEqual({
			ok: true,
			source: "direct",
			managerId: "direct-a",
			managerIds: ["direct-a", "direct-b"],
		});
	});
});

describe("resolveDirectEligibleManagers", () => {
	it("does not use team fallback when no direct manager exists", () => {
		expect(
			resolveDirectEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "direct-a",
				employees,
				managerLinks: [],
				teamMemberships: [{ employeeId: "direct-a", teamId: "team-a" }],
				teams: [
					{
						id: "team-a",
						organizationId: "org-1",
						primaryManagerId: "team-manager-a",
					},
				],
			}),
		).toEqual({
			ok: false,
			reason: "Requester has no active direct manager in this organization.",
		});
	});
});

describe("requesterMayBeResolved", () => {
	it.each([
		{ exists: true, active: true, mode: "new_submission", expected: true },
		{ exists: true, active: false, mode: "new_submission", expected: false },
		{ exists: true, active: true, mode: "existing_workflow", expected: true },
		{ exists: true, active: false, mode: "existing_workflow", expected: true },
		{ exists: false, active: true, mode: "existing_workflow", expected: false },
		{ exists: false, active: false, mode: "new_submission", expected: false },
	] as const)("exists=$exists active=$active mode=$mode -> $expected", (row) => {
		expect(
			requesterMayBeResolved({
				requesterExistsInOrganization: row.exists,
				requesterIsActive: row.active,
				mode: row.mode,
			}),
		).toBe(row.expected);
	});
});

describe("existing workflow requester eligibility", () => {
	const departedEmployees = [
		...employees.filter((employee) => employee.id !== "requester"),
		{
			id: "requester",
			organizationId: "org-1",
			isActive: false,
			role: "employee" as const,
		},
	];
	const baseInput = {
		organizationId: "org-1",
		requesterEmployeeId: "requester",
		employees: departedEmployees,
		managerLinks: [
			{ employeeId: "requester", managerId: "direct-a", isPrimary: true },
			{ employeeId: "requester", managerId: "inactive-manager" },
		],
		teamMemberships: [],
		teams: [],
	};

	it("rejects a departed requester for a new submission by default", () => {
		expect(resolveEligibleManagers(baseInput)).toEqual({
			ok: false,
			reason: "Requester is not active in this organization.",
		});
		expect(
			resolveDirectEligibleManagers({ ...baseInput, requesterMode: "new_submission" }),
		).toMatchObject({ ok: false });
	});

	it("keeps active managers of a departed requester for an existing workflow", () => {
		expect(
			resolveEligibleManagers({ ...baseInput, requesterMode: "existing_workflow" }),
		).toEqual({ ok: true, source: "direct", managerIds: ["direct-a"] });
		expect(
			resolvePrimaryEligibleManager({ ...baseInput, requesterMode: "existing_workflow" }),
		).toMatchObject({ ok: true, managerId: "direct-a" });
		expect(
			resolveDirectEligibleManagers({ ...baseInput, requesterMode: "existing_workflow" }),
		).toEqual({ ok: true, source: "direct", managerIds: ["direct-a"] });
	});

	it("still denies a historical requester from another organization", () => {
		expect(
			resolveEligibleManagers({
				...baseInput,
				organizationId: "org-2",
				requesterMode: "existing_workflow",
			}),
		).toEqual({ ok: false, reason: "Requester is not active in this organization." });
	});
});
