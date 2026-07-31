import { describe, expect, it, vi } from "vitest";
import {
	getEligibleApprovalScopesForManager,
	getEligibleManagerIdsForRequester,
	getPrimaryEligibleManagerIdForRequester,
} from "./manager-eligibility-db";

function createPgError(code: string) {
	return Object.assign(new Error(`Postgres error ${code}`), { code });
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
}

function createDeferredEligibilityDb() {
	const employees = createDeferred<unknown[]>();
	const managerLinks = createDeferred<unknown[]>();
	const memberships = createDeferred<unknown[]>();
	const teams = createDeferred<unknown[]>();

	return {
		employees,
		managerLinks,
		memberships,
		teams,
		db: {
			query: {
				employee: { findMany: vi.fn(() => employees.promise) },
				employeeManagers: { findMany: vi.fn(() => managerLinks.promise) },
				teamMembership: { findMany: vi.fn(() => memberships.promise) },
				team: { findMany: vi.fn(() => teams.promise) },
			},
		},
	};
}

describe("getEligibleApprovalScopesForManager", () => {
	it("starts manager and team eligibility reads after the organization employee read resolves", async () => {
		const employees = createDeferred<unknown[]>();
		const managerLinks = createDeferred<unknown[]>();
		const memberships = createDeferred<unknown[]>();
		const teams = createDeferred<unknown[]>();
		const db = {
			query: {
				employee: { findMany: vi.fn(() => employees.promise) },
				employeeManagers: { findMany: vi.fn(() => managerLinks.promise) },
				teamMembership: { findMany: vi.fn(() => memberships.promise) },
				team: { findMany: vi.fn(() => teams.promise) },
			},
		};

		const result = getEligibleApprovalScopesForManager({
			db,
			managerEmployeeId: "manager-1",
			organizationId: "org-1",
		});

		expect(db.query.employee.findMany).toHaveBeenCalledOnce();
		expect(db.query.employeeManagers.findMany).not.toHaveBeenCalled();
		expect(db.query.teamMembership.findMany).not.toHaveBeenCalled();
		expect(db.query.team.findMany).not.toHaveBeenCalled();

		employees.resolve([
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
		]);
		await employees.promise;
		await Promise.resolve();

		expect(db.query.employeeManagers.findMany).toHaveBeenCalledOnce();
		expect(db.query.teamMembership.findMany).toHaveBeenCalledOnce();
		expect(db.query.team.findMany).toHaveBeenCalledOnce();

		managerLinks.resolve([
			{ employeeId: "requester-1", managerId: "manager-1", isPrimary: true },
		]);
		memberships.resolve([]);
		teams.resolve([]);
		await expect(result).resolves.toEqual([
			{
				requesterEmployeeId: "requester-1",
				eligibleApproverIds: ["manager-1"],
			},
		]);
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
	it("starts all reads concurrently", async () => {
		const pending = createDeferredEligibilityDb();
		const result = getEligibleManagerIdsForRequester({
			db: pending.db,
			requesterEmployeeId: "requester-1",
			organizationId: "org-1",
		});

		expect(pending.db.query.employee.findMany).toHaveBeenCalledOnce();
		expect(pending.db.query.employeeManagers.findMany).toHaveBeenCalledOnce();
		expect(pending.db.query.teamMembership.findMany).toHaveBeenCalledOnce();
		expect(pending.db.query.team.findMany).toHaveBeenCalledOnce();

		pending.employees.resolve([
			{
				id: "requester-1",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
			},
		]);
		pending.managerLinks.resolve([]);
		pending.memberships.resolve([]);
		pending.teams.resolve([]);
		await expect(result).resolves.toEqual([]);
	});
});

describe("getPrimaryEligibleManagerIdForRequester", () => {
	it("starts all reads concurrently", async () => {
		const pending = createDeferredEligibilityDb();
		const result = getPrimaryEligibleManagerIdForRequester({
			db: pending.db,
			requesterEmployeeId: "requester-1",
			organizationId: "org-1",
		});

		expect(pending.db.query.employee.findMany).toHaveBeenCalledOnce();
		expect(pending.db.query.employeeManagers.findMany).toHaveBeenCalledOnce();
		expect(pending.db.query.teamMembership.findMany).toHaveBeenCalledOnce();
		expect(pending.db.query.team.findMany).toHaveBeenCalledOnce();

		pending.employees.resolve([
			{
				id: "requester-1",
				organizationId: "org-1",
				isActive: true,
				role: "employee",
			},
		]);
		pending.managerLinks.resolve([]);
		pending.memberships.resolve([]);
		pending.teams.resolve([]);
		await expect(result).resolves.toBeNull();
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
