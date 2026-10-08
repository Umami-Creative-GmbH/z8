/**
 * #749: payroll access grants are revoked, audited, and re-saved after a named
 * employee departs. The settings server actions run against PostgreSQL; only the
 * session is mocked.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t749-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

const { getPayrollAccessAdminDataAction, revokePayrollAccessGrantAction, savePayrollAccessAction } =
	await import("./actions");
const { hasActivePayrollAccessGrant, resolvePayrollAccessibleEmployeeIds } = await import(
	"@/lib/payroll-access/permissions"
);
const { getPayrollWorkspaceSummaryAction } = await import("@/app/[locale]/(app)/payroll/actions");

const ids = {
	organization: "t749-payroll-access-org",
	otherOrganization: "t749-other-org",
	ownerUser: "t749-owner-user",
	officerUser: "t749-officer-user",
	workerUser: "t749-worker-user",
	leaverUser: "t749-leaver-user",
	foreignUser: "t749-foreign-user",
	owner: "d7490000-0000-4000-8000-000000000001",
	officer: "d7490000-0000-4000-8000-000000000002",
	worker: "d7490000-0000-4000-8000-000000000003",
	leaver: "d7490000-0000-4000-8000-000000000004",
	foreign: "d7490000-0000-4000-8000-000000000005",
	team: "d7490000-0000-4000-8000-0000000000a1",
	foreignTeam: "d7490000-0000-4000-8000-0000000000a2",
} as const;
const users = [ids.ownerUser, ids.officerUser, ids.workerUser, ids.leaverUser, ids.foreignUser];

type AuditRow = {
	action: string;
	entity_type: string;
	entity_id: string;
	employee_id: string | null;
	performed_by: string;
	changes: string;
};

describe("payroll access grant hygiene on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function save(input: {
		payrollEmployeeId?: string;
		scope: "all" | "specific";
		teamIds?: string[];
		employeeIds?: string[];
	}) {
		actAs(ids.ownerUser);
		return savePayrollAccessAction({
			payrollEmployeeId: input.payrollEmployeeId ?? ids.officer,
			scope: input.scope,
			teamIds: input.teamIds ?? [],
			employeeIds: input.employeeIds ?? [],
		});
	}

	async function savedGrantId(input: Parameters<typeof save>[0]) {
		const result = await save(input);
		if (!result.success) throw new Error(result.error);
		return result.data.grantId;
	}

	async function grants() {
		const { rows } = await admin.query(
			`select id, scope, is_active from payroll_access_grant
			 where organization_id = $1 and payroll_employee_id = $2 order by created_at, id`,
			[ids.organization, ids.officer],
		);
		return rows as { id: string; scope: string; is_active: boolean }[];
	}

	async function auditRows(): Promise<AuditRow[]> {
		const { rows } = await admin.query(
			`select action, entity_type, entity_id, employee_id, performed_by, changes from audit_log
			 where organization_id = $1 and action like 'payroll_access.%' order by timestamp, id`,
			[ids.organization],
		);
		return rows as AuditRow[];
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T749 payroll access', $1, 'Europe/Berlin', $3), ($2, 'T749 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t749-m-owner', $1, $2, 'owner', 'approved', $7),
			 ('t749-m-officer', $1, $3, 'member', 'approved', $7),
			 ('t749-m-worker', $1, $4, 'member', 'approved', $7),
			 ('t749-m-leaver', $1, $5, 'member', 'approved', $7),
			 ('t749-m-foreign', $6, $8, 'owner', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.officerUser,
				ids.workerUser,
				ids.leaverUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, employee_number, updated_at) values
			 ($1, $2, $11, 'admin', 'OWN-1', $12), ($3, $4, $11, 'employee', 'OFF-1', $12),
			 ($5, $6, $11, 'employee', 'WRK-1', $12), ($7, $8, $11, 'employee', 'LEA-1', $12),
			 ($9, $10, $13, 'admin', 'FOR-1', $12)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.officer,
				ids.officerUser,
				ids.worker,
				ids.workerUser,
				ids.leaver,
				ids.leaverUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $2, 'Berlin', now()), ($3, $4, 'Foreign', now())`,
			[ids.team, ids.organization, ids.foreignTeam, ids.otherOrganization],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
	}

	beforeEach(async () => {
		vi.restoreAllMocks();
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("audits a new grant with its scope", async () => {
		const grantId = await savedGrantId({
			scope: "specific",
			teamIds: [ids.team],
			employeeIds: [ids.worker],
		});

		const audit = await auditRows();
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({
			action: "payroll_access.grant_created",
			entity_type: "payroll_access_grant",
			entity_id: grantId,
			employee_id: ids.officer,
			performed_by: ids.ownerUser,
		});
		expect(JSON.parse(audit[0].changes)).toEqual({
			from: null,
			to: { scope: "specific", teamIds: [ids.team], employeeIds: [ids.worker] },
		});
	});

	it("audits a change with the old and new scope, keeps unchanged scope rows, and skips unchanged saves", async () => {
		const grantId = await savedGrantId({
			scope: "specific",
			teamIds: [ids.team],
			employeeIds: [ids.worker],
		});
		const { rows: before } = await admin.query(
			"select id from payroll_access_team where grant_id = $1",
			[grantId],
		);

		expect(
			await savedGrantId({
				scope: "specific",
				teamIds: [ids.team],
				employeeIds: [ids.leaver],
			}),
		).toBe(grantId);
		// Unchanged: no write, no audit entry.
		expect(
			await savedGrantId({
				scope: "specific",
				teamIds: [ids.team],
				employeeIds: [ids.leaver],
			}),
		).toBe(grantId);

		const { rows: after } = await admin.query(
			"select id from payroll_access_team where grant_id = $1",
			[grantId],
		);
		expect(after).toEqual(before);
		const { rows: named } = await admin.query(
			"select employee_id from payroll_access_employee where grant_id = $1",
			[grantId],
		);
		expect(named).toEqual([{ employee_id: ids.leaver }]);

		const audit = await auditRows();
		expect(audit.map((row) => row.action)).toEqual([
			"payroll_access.grant_created",
			"payroll_access.grant_changed",
		]);
		expect(JSON.parse(audit[1].changes)).toEqual({
			from: { scope: "specific", teamIds: [ids.team], employeeIds: [ids.worker] },
			to: { scope: "specific", teamIds: [ids.team], employeeIds: [ids.leaver] },
		});
	});

	it("re-saves a grant whose named employee has departed and keeps them on it", async () => {
		const grantId = await savedGrantId({
			scope: "specific",
			teamIds: [],
			employeeIds: [ids.worker, ids.leaver],
		});
		await admin.query("update employee set is_active = false where id = $1", [ids.leaver]);

		actAs(ids.ownerUser);
		const adminData = await getPayrollAccessAdminDataAction();
		if (!adminData.success) throw new Error(adminData.error);
		expect(adminData.data.employees.map((employee) => employee.id)).not.toContain(ids.leaver);
		expect(adminData.data.departedEmployees.map((employee) => employee.id)).toEqual([ids.leaver]);
		const grant = adminData.data.grants.find((candidate) => candidate.id === grantId);
		expect(grant?.employeeIds.toSorted()).toEqual([ids.worker, ids.leaver].toSorted());

		// The unchanged grant as the editor sends it back.
		expect(
			await save({ scope: "specific", teamIds: grant?.teamIds, employeeIds: grant?.employeeIds }),
		).toMatchObject({ success: true, data: { grantId } });
		// So is a change to the rest of the grant.
		expect(
			await save({ scope: "specific", teamIds: [ids.team], employeeIds: grant?.employeeIds }),
		).toMatchObject({ success: true, data: { grantId } });
		const { rows: named } = await admin.query(
			"select employee_id from payroll_access_employee where grant_id = $1 order by employee_id",
			[grantId],
		);
		expect(named.map((row) => row.employee_id)).toEqual([ids.worker, ids.leaver].toSorted());

		// A departed employee who is not on the grant cannot be newly named.
		await admin.query("update employee set is_active = false where id = $1", [ids.worker]);
		await save({ scope: "specific", employeeIds: [ids.leaver] });
		expect(await save({ scope: "specific", employeeIds: [ids.leaver, ids.worker] })).toMatchObject({
			success: false,
			code: "ValidationError",
		});
	});

	it("revokes a grant: the officer loses payroll access at once and the revocation is audited", async () => {
		const grantId = await savedGrantId({ scope: "specific", employeeIds: [ids.worker] });
		expect(
			await hasActivePayrollAccessGrant({
				organizationId: ids.organization,
				payrollEmployeeId: ids.officer,
			}),
		).toBe(true);

		actAs(ids.ownerUser);
		expect(await revokePayrollAccessGrantAction({ grantId })).toEqual({
			success: true,
			data: { grantId },
		});

		expect(await grants()).toEqual([{ id: grantId, scope: "specific", is_active: false }]);
		expect(
			await hasActivePayrollAccessGrant({
				organizationId: ids.organization,
				payrollEmployeeId: ids.officer,
			}),
		).toBe(false);
		expect(
			await resolvePayrollAccessibleEmployeeIds({
				organizationId: ids.organization,
				payrollEmployeeId: ids.officer,
			}),
		).toEqual([]);
		actAs(ids.officerUser);
		expect(
			await getPayrollWorkspaceSummaryAction({
				startDate: "2026-07-01",
				endDate: "2026-07-31",
				label: "July 2026",
			}),
		).toMatchObject({ success: false });

		const audit = await auditRows();
		expect(audit.at(-1)).toMatchObject({
			action: "payroll_access.grant_revoked",
			entity_id: grantId,
			employee_id: ids.officer,
			performed_by: ids.ownerUser,
		});
		expect(JSON.parse(audit.at(-1)?.changes ?? "null")).toEqual({
			from: { scope: "specific", teamIds: [], employeeIds: [ids.worker] },
			to: null,
		});

		actAs(ids.ownerUser);
		const adminData = await getPayrollAccessAdminDataAction();
		expect(adminData.success && adminData.data.grants).toEqual([]);
	});

	it("never reactivates a revoked grant: a later grant for the same officer is a new one", async () => {
		const revokedId = await savedGrantId({ scope: "specific", employeeIds: [ids.worker] });
		actAs(ids.ownerUser);
		await revokePayrollAccessGrantAction({ grantId: revokedId });

		const newId = await savedGrantId({ scope: "all" });

		expect(newId).not.toBe(revokedId);
		expect(await grants()).toEqual([
			{ id: revokedId, scope: "specific", is_active: false },
			{ id: newId, scope: "all", is_active: true },
		]);
		// The revoked grant keeps the scope it had.
		const { rows } = await admin.query(
			"select employee_id from payroll_access_employee where grant_id = $1",
			[revokedId],
		);
		expect(rows).toEqual([{ employee_id: ids.worker }]);
		expect((await auditRows()).map((row) => [row.action, row.entity_id])).toEqual([
			["payroll_access.grant_created", revokedId],
			["payroll_access.grant_revoked", revokedId],
			["payroll_access.grant_created", newId],
		]);
	});

	it("refuses revoking a revoked grant, another organization's grant, or without settings access", async () => {
		const grantId = await savedGrantId({ scope: "all" });

		actAs(ids.officerUser);
		expect(await revokePayrollAccessGrantAction({ grantId })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		actAs(ids.foreignUser, ids.otherOrganization);
		expect(await revokePayrollAccessGrantAction({ grantId })).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(await grants()).toEqual([{ id: grantId, scope: "all", is_active: true }]);

		actAs(ids.ownerUser);
		await revokePayrollAccessGrantAction({ grantId });
		expect(await revokePayrollAccessGrantAction({ grantId })).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect((await auditRows()).map((row) => row.action)).toEqual([
			"payroll_access.grant_created",
			"payroll_access.grant_revoked",
		]);
	});

	it("refuses teams and employees of another organization", async () => {
		expect(await save({ scope: "specific", teamIds: [ids.foreignTeam] })).toMatchObject({
			success: false,
			code: "ValidationError",
		});
		expect(await save({ scope: "specific", employeeIds: [ids.foreign] })).toMatchObject({
			success: false,
			code: "ValidationError",
		});
		expect(await grants()).toEqual([]);
		expect(await auditRows()).toEqual([]);
	});
});
