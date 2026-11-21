import { describe, expect, it, vi } from "vitest";
import {
	getEligibleApprovalScopesForManager,
	getEligibleManagerIdsForRequester,
	getPrimaryEligibleManagerIdForRequester,
	isEligibleManagerForApprovalRequest,
} from "./manager-eligibility-db";

function createPgError(code: string) {
	return Object.assign(new Error(`Postgres error ${code}`), { code });
}

/**
 * A db whose reads settle on a later macrotask and that counts how many are in
 * flight at once: `db` may be a transaction, one connection, which must not be
 * handed a query while another is still executing (pg@9 drops that).
 */
function createOneConnectionDb(rows: {
	employees: unknown[];
	managerLinks: unknown[];
	memberships: unknown[];
	teams: unknown[];
}) {
	const reads: string[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const read = (name: string, result: unknown[]) =>
		vi.fn(async () => {
			reads.push(name);
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 0));
			inFlight -= 1;
			return result;
		});

	return {
		reads,
		maxInFlight: () => maxInFlight,
		db: {
			query: {
				employee: { findMany: read("employee", rows.employees) },
				employeeManagers: { findMany: read("employeeManagers", rows.managerLinks) },
				teamMembership: { findMany: read("teamMembership", rows.memberships) },
				team: { findMany: read("team", rows.teams) },
			},
		},
	};
}

const lonelyRequester = {
	employees: [{ id: "requester-1", organizationId: "org-1", isActive: true, role: "employee" }],
	managerLinks: [],
	memberships: [],
	teams: [],
};

describe("getEligibleApprovalScopesForManager", () => {
	it("reads one query at a time, the organization's employees first", async () => {
		const pending = createOneConnectionDb({
			employees: [
				{
					id: "requester-1",
					organizationId: "org-1",
					isActive: true,
					role: "employee",
				},
				{
					id: "manager-1",
					organizationId: "org-1",
					isActive: true,
					role: "manager",
				},
			],
			managerLinks: [{ employeeId: "requester-1", managerId: "manager-1", isPrimary: true }],
			memberships: [],
			teams: [],
		});

		const result = getEligibleApprovalScopesForManager({
			db: pending.db,
			managerEmployeeId: "manager-1",
			organizationId: "org-1",
		});

		await expect(result).resolves.toEqual([
			{
				requesterEmployeeId: "requester-1",
				eligibleApproverIds: ["manager-1"],
			},
		]);
		expect(pending.reads[0]).toBe("employee");
		expect(pending.reads).toHaveLength(4);
		expect(pending.maxInFlight()).toBe(1);
	});

	it("falls back to direct approval visibility when team eligibility schema is not migrated", async () => {
		const db = {
			query: {
				employee: {
					findMany: vi.fn(async () => [
						{
							id: "requester-1",
							organizationId: "org-1",
							isActive: true,
							role: "employee",
						},
						{
							id: "manager-1",
							organizationId: "org-1",
							isActive: true,
							role: "manager",
						},
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => [
						{
							employeeId: "requester-1",
							managerId: "manager-1",
							isPrimary: true,
						},
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
			{
				requesterEmployeeId: "requester-1",
				eligibleApproverIds: ["manager-1"],
			},
		]);
	});
});

describe("getEligibleManagerIdsForRequester", () => {
	it("reads one query at a time", async () => {
		const pending = createOneConnectionDb(lonelyRequester);

		await expect(
			getEligibleManagerIdsForRequester({
				db: pending.db,
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual([]);
		expect(pending.reads).toHaveLength(4);
		expect(pending.maxInFlight()).toBe(1);
	});
});

describe("getPrimaryEligibleManagerIdForRequester", () => {
	it("reads one query at a time", async () => {
		const pending = createOneConnectionDb(lonelyRequester);

		await expect(
			getPrimaryEligibleManagerIdForRequester({
				db: pending.db,
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
			}),
		).resolves.toBeNull();
		expect(pending.reads).toHaveLength(4);
		expect(pending.maxInFlight()).toBe(1);
	});

	it("returns the primary direct manager when multiple direct manager links exist", async () => {
		const db = {
			query: {
				employee: {
					findMany: vi.fn(async () => [
						{
							id: "requester-1",
							organizationId: "org-1",
							isActive: true,
							role: "employee",
						},
						{
							id: "manager-1",
							organizationId: "org-1",
							isActive: true,
							role: "manager",
						},
						{
							id: "manager-2",
							organizationId: "org-1",
							isActive: true,
							role: "manager",
						},
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => [
						{
							employeeId: "requester-1",
							managerId: "manager-1",
							isPrimary: false,
						},
						{
							employeeId: "requester-1",
							managerId: "manager-2",
							isPrimary: true,
						},
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
						{
							id: "requester-1",
							organizationId: "org-1",
							isActive: true,
							role: "employee",
						},
						{
							id: "manager-1",
							organizationId: "org-1",
							isActive: true,
							role: "manager",
						},
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => []),
				},
				teamMembership: {
					findMany: vi.fn(async () => [
						{ employeeId: "requester-1", teamId: "team-1" },
					]),
				},
				team: {
					findMany: vi.fn(async () => [
						{
							id: "team-1",
							organizationId: "org-1",
							primaryManagerId: "manager-1",
						},
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
						{
							id: "requester-1",
							organizationId: "org-1",
							isActive: true,
							role: "employee",
						},
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

describe("departed requester eligibility", () => {
	function departedRequesterDb(request: { requestedBy: string; approverId: string } | null) {
		return {
			query: {
				approvalRequest: { findFirst: vi.fn(async () => request) },
				employee: {
					findMany: vi.fn(async () => [
						{
							id: "requester-1",
							organizationId: "org-1",
							isActive: false,
							role: "employee",
						},
						{
							id: "manager-1",
							organizationId: "org-1",
							isActive: true,
							role: "manager",
						},
						{
							id: "manager-2",
							organizationId: "org-1",
							isActive: true,
							role: "manager",
						},
					]),
				},
				employeeManagers: {
					findMany: vi.fn(async () => [
						{ employeeId: "requester-1", managerId: "manager-1", isPrimary: true },
						{ employeeId: "requester-1", managerId: "manager-2", isPrimary: false },
					]),
				},
				teamMembership: { findMany: vi.fn(async () => []) },
				team: { findMany: vi.fn(async () => []) },
			},
		};
	}

	it("lets an eligible manager settle a persisted request from a departed requester", async () => {
		await expect(
			isEligibleManagerForApprovalRequest({
				db: departedRequesterDb({ requestedBy: "requester-1", approverId: "manager-1" }),
				approvalRequestId: "request-1",
				managerEmployeeId: "manager-2",
				organizationId: "org-1",
			}),
		).resolves.toBe(true);
	});

	it("keeps a departed requester visible in a manager's existing approval scopes", async () => {
		await expect(
			getEligibleApprovalScopesForManager({
				db: departedRequesterDb(null),
				managerEmployeeId: "manager-2",
				organizationId: "org-1",
			}),
		).resolves.toEqual([
			{ requesterEmployeeId: "requester-1", eligibleApproverIds: ["manager-1", "manager-2"] },
		]);
	});

	it("resolves no approver for a new submission from a departed requester", async () => {
		await expect(
			getPrimaryEligibleManagerIdForRequester({
				db: departedRequesterDb(null),
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
			}),
		).resolves.toBeNull();
	});
});
