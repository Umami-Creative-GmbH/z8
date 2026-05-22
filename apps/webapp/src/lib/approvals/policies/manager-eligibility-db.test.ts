import { describe, expect, it, vi } from "vitest";
import {
	getEligibleApprovalScopesForManager,
	getPrimaryEligibleManagerIdForRequester,
} from "./manager-eligibility-db";

function createPgError(code: string) {
	return Object.assign(new Error(`Postgres error ${code}`), { code });
}

describe("getEligibleApprovalScopesForManager", () => {
	it("falls back to direct approval visibility when team eligibility schema is not migrated", async () => {
		const db = {
			query: {
				employee: {
					findMany: vi.fn(async () => [
						{ id: "requester-1", organizationId: "org-1", isActive: true, role: "employee" },
						{ id: "manager-1", organizationId: "org-1", isActive: true, role: "manager" },
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => [
						{ employeeId: "requester-1", managerId: "manager-1", isPrimary: true },
					]),
				},
				teamMembership: {
					findMany: vi.fn(async () => {
						throw createPgError("42P01");
					}),
				},
				team: {
					findMany: vi.fn(async () => []),
				},
			},
		};

		await expect(
			getEligibleApprovalScopesForManager({
				db,
				managerEmployeeId: "manager-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual([
			{ requesterEmployeeId: "requester-1", eligibleApproverIds: ["manager-1"] },
		]);
	});
});

describe("getPrimaryEligibleManagerIdForRequester", () => {
	it("returns the primary direct manager when multiple direct manager links exist", async () => {
		const db = {
			query: {
				employee: {
					findMany: vi.fn(async () => [
						{ id: "requester-1", organizationId: "org-1", isActive: true, role: "employee" },
						{ id: "manager-1", organizationId: "org-1", isActive: true, role: "manager" },
						{ id: "manager-2", organizationId: "org-1", isActive: true, role: "manager" },
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => [
						{ employeeId: "requester-1", managerId: "manager-1", isPrimary: false },
						{ employeeId: "requester-1", managerId: "manager-2", isPrimary: true },
					]),
				},
				teamMembership: {
					findMany: vi.fn(async () => []),
				},
				team: {
					findMany: vi.fn(async () => []),
				},
			},
		};

		await expect(
			getPrimaryEligibleManagerIdForRequester({
				db,
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
			}),
		).resolves.toBe("manager-2");
	});

	it("falls back to the team primary manager when no direct manager exists", async () => {
		const db = {
			query: {
				employee: {
					findMany: vi.fn(async () => [
						{ id: "requester-1", organizationId: "org-1", isActive: true, role: "employee" },
						{ id: "manager-1", organizationId: "org-1", isActive: true, role: "manager" },
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => []),
				},
				teamMembership: {
					findMany: vi.fn(async () => [{ employeeId: "requester-1", teamId: "team-1" }]),
				},
				team: {
					findMany: vi.fn(async () => [
						{ id: "team-1", organizationId: "org-1", primaryManagerId: "manager-1" },
					]),
				},
			},
		};

		await expect(
			getPrimaryEligibleManagerIdForRequester({
				db,
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
			}),
		).resolves.toBe("manager-1");
	});

	it("returns null when neither direct manager nor team fallback manager exists", async () => {
		const db = {
			query: {
				employee: {
					findMany: vi.fn(async () => [
						{ id: "requester-1", organizationId: "org-1", isActive: true, role: "employee" },
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => []),
				},
				teamMembership: {
					findMany: vi.fn(async () => []),
				},
				team: {
					findMany: vi.fn(async () => []),
				},
			},
		};

		await expect(
			getPrimaryEligibleManagerIdForRequester({
				db,
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
			}),
		).resolves.toBeNull();
	});
});
