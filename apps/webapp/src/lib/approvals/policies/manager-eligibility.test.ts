import { describe, expect, it } from "vitest";
import { resolveEligibleManagers, resolvePrimaryEligibleManager } from "./manager-eligibility";

const employees = [
	{ id: "requester", organizationId: "org-1", isActive: true, role: "employee" as const },
	{ id: "direct-a", organizationId: "org-1", isActive: true, role: "manager" as const },
	{ id: "direct-b", organizationId: "org-1", isActive: true, role: "manager" as const },
	{ id: "team-manager-a", organizationId: "org-1", isActive: true, role: "manager" as const },
	{ id: "team-manager-b", organizationId: "org-1", isActive: true, role: "admin" as const },
	{ id: "inactive-manager", organizationId: "org-1", isActive: false, role: "manager" as const },
	{ id: "employee-role", organizationId: "org-1", isActive: true, role: "employee" as const },
	{ id: "other-org-manager", organizationId: "org-2", isActive: true, role: "manager" as const },
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
				teams: [{ id: "team-a", organizationId: "org-1", primaryManagerId: "team-manager-a" }],
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
					{ id: "team-a", organizationId: "org-1", primaryManagerId: "team-manager-a" },
					{ id: "team-b", organizationId: "org-1", primaryManagerId: "team-manager-b" },
				],
			}),
		).toEqual({ ok: true, source: "team", managerIds: ["team-manager-a", "team-manager-b"] });
	});

	it("dedupes team managers and ignores invalid managers", () => {
		expect(
			resolveEligibleManagers({
				organizationId: "org-1",
				requesterEmployeeId: "requester",
				employees,
				managerLinks: [{ employeeId: "requester", managerId: "inactive-manager" }],
				teamMemberships: [
					{ employeeId: "requester", teamId: "team-a" },
					{ employeeId: "requester", teamId: "team-b" },
					{ employeeId: "requester", teamId: "team-c" },
					{ employeeId: "requester", teamId: "team-d" },
				],
				teams: [
					{ id: "team-a", organizationId: "org-1", primaryManagerId: "team-manager-a" },
					{ id: "team-b", organizationId: "org-1", primaryManagerId: "team-manager-a" },
					{ id: "team-c", organizationId: "org-1", primaryManagerId: "employee-role" },
					{ id: "team-d", organizationId: "org-1", primaryManagerId: "other-org-manager" },
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
		).toEqual({ ok: false, reason: "Requester has no active direct or team manager in this organization." });
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
		).toEqual({ ok: true, source: "direct", managerId: "direct-a", managerIds: ["direct-a", "direct-b"] });
	});
});
