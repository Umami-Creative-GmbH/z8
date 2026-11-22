/**
 * PostgreSQL integration suite for server-computed `settingsCapabilities` (ADR 0003):
 * real memberships, employee records, custom roles (month close/reopen, approval
 * management), project managers, driving licence policies, and active report share links.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { settingsAccessOf } from "@/lib/organization-action/settings-access";
import { DEFAULT_SETTINGS_CAPABILITIES } from "./capabilities";

vi.mock("@/db", async () => (await import("@/test/integration-database")).integrationDbModule());

const { db } = await import("@/db");
const { resolveSettingsCapabilitiesForIdentity } = await import("./capabilities.server");

describe("settingsCapabilities on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let memberCloseMonths: { userId: string; employeeId: string };
	let memberReopenMonths: { userId: string; employeeId: string };
	let memberApproval: { userId: string; employeeId: string };
	let memberProjectManager: { userId: string; employeeId: string };
	let plainMember: { userId: string; employeeId: string };
	let scopedManager: { userId: string; employeeId: string };
	let workforceAdmin: { userId: string; employeeId: string };
	let orgAdmin: { userId: string; employeeId: string };
	let formerEmployee: { userId: string; employeeId: string };

	async function grantCustomRole(
		employeeId: string,
		name: string,
		action: string,
		subject: string,
	) {
		const roleId = randomUUID();
		await fixture.pool.query(
			`insert into custom_role (id, organization_id, name, base_tier, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'employee', true, $4, now())`,
			[roleId, fixture.organizationId, name, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into custom_role_permission (id, custom_role_id, action, subject)
			 values ($1, $2, $3, $4)`,
			[randomUUID(), roleId, action, subject],
		);
		await fixture.pool.query(
			`insert into employee_custom_role (id, employee_id, custom_role_id, assigned_by)
			 values ($1, $2, $3, $4)`,
			[randomUUID(), employeeId, roleId, fixture.ownerUserId],
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();

		plainMember = await fixture.seedEmployee({ role: "member" });
		memberCloseMonths = await fixture.seedEmployee({ role: "member" });
		memberReopenMonths = await fixture.seedEmployee({ role: "member" });
		memberApproval = await fixture.seedEmployee({ role: "member" });
		memberProjectManager = await fixture.seedEmployee({ role: "member" });
		scopedManager = await fixture.seedEmployee({ role: "member" });
		workforceAdmin = await fixture.seedEmployee({ role: "member" });
		orgAdmin = await fixture.seedEmployee({ role: "admin" });
		formerEmployee = await fixture.seedEmployee({ role: "member", isActive: false });

		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			scopedManager.employeeId,
		]);
		await fixture.pool.query(`update employee set role = 'admin' where id = $1`, [
			workforceAdmin.employeeId,
		]);
		await fixture.pool.query(`update employee set role = 'employee' where id = $1`, [
			orgAdmin.employeeId,
		]);

		await grantCustomRole(memberCloseMonths.employeeId, "Month closer", "close", "PayrollPeriod");
		await grantCustomRole(
			memberReopenMonths.employeeId,
			"Month reopener",
			"reopen",
			"PayrollPeriod",
		);
		await grantCustomRole(memberApproval.employeeId, "Approval manager", "manage", "Approval");

		const projectId = randomUUID();
		await fixture.pool.query(
			`insert into project (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Managed Project', $3, now())`,
			[projectId, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into project_manager (id, project_id, employee_id, assigned_by)
			 values ($1, $2, $3, $4)`,
			[randomUUID(), projectId, memberProjectManager.employeeId, fixture.ownerUserId],
		);

		await fixture.pool.query(
			`insert into driving_licence_policy (
				organization_id, enabled, interval_months, timezone, reminder_lead_days,
				retention_months, retention_justification, updated_by, updated_at
			) values ($1, true, 6, 'UTC', '[30, 14, 7]'::jsonb, 12, 'Statutory check compliance retention', $2, now())`,
			[fixture.organizationId, fixture.ownerUserId],
		);

		await fixture.pool.query(
			`insert into report_share_link (
				id, organization_id, created_by, creator_employee_id, kind, project_id, project_ids,
				from_day, to_day, figures, include_employees, creator_locale,
				token_digest, token_hash_version, created_at, expires_at
			) values (
				$1, $2, $3, $4, 'project', $5, ARRAY[$5]::uuid[],
				'2026-01-01', '2026-01-31', 'hours', false, 'en',
				$6, 'v1', now(), now() + interval '7 days'
			)`,
			[
				randomUUID(),
				fixture.organizationId,
				fixture.ownerUserId,
				orgAdmin.employeeId,
				projectId,
				`digest-${randomUUID()}`,
			],
		);
	});

	afterAll(async () => {
		await fixture.close();
	});

	it("resolves custom-role month-close and month-reopen capabilities for org members", async () => {
		for (const actor of [memberCloseMonths, memberReopenMonths]) {
			const caps = await resolveSettingsCapabilitiesForIdentity(
				{
					settingsAccess: "member",
					identity: {
						userId: actor.userId,
						organizationId: fixture.organizationId,
						membershipRole: "member",
						employee: {
							id: actor.employeeId,
							organizationId: fixture.organizationId,
							role: "employee",
							teamId: null,
						},
					},
				},
				db,
			);
			expect(caps).toEqual({
				...DEFAULT_SETTINGS_CAPABILITIES,
				canAccessClosedMonths: true,
			});
		}
	});

	it("resolves custom-role approval-management capability for org members and workforce admins", async () => {
		const memberCaps = await resolveSettingsCapabilitiesForIdentity(
			{
				settingsAccess: "member",
				identity: {
					userId: memberApproval.userId,
					organizationId: fixture.organizationId,
					membershipRole: "member",
					employee: {
						id: memberApproval.employeeId,
						organizationId: fixture.organizationId,
						role: "employee",
						teamId: null,
					},
				},
			},
			db,
		);
		expect(memberCaps).toEqual({
			...DEFAULT_SETTINGS_CAPABILITIES,
			canManageApprovalEscalation: true,
		});

		const workforceAdminCaps = await resolveSettingsCapabilitiesForIdentity(
			{
				settingsAccess: "scopedManager",
				identity: {
					userId: workforceAdmin.userId,
					organizationId: fixture.organizationId,
					membershipRole: "member",
					employee: {
						id: workforceAdmin.employeeId,
						organizationId: fixture.organizationId,
						role: "admin",
						teamId: null,
					},
				},
			},
			db,
		);
		expect(workforceAdminCaps).toEqual({
			...DEFAULT_SETTINGS_CAPABILITIES,
			canManageApprovalEscalation: true,
		});
	});

	it("resolves project-manager capability for members managing a project and denies plain members/scoped managers without custom roles", async () => {
		const pmCaps = await resolveSettingsCapabilitiesForIdentity(
			{
				settingsAccess: "member",
				identity: {
					userId: memberProjectManager.userId,
					organizationId: fixture.organizationId,
					membershipRole: "member",
					employee: {
						id: memberProjectManager.employeeId,
						organizationId: fixture.organizationId,
						role: "employee",
						teamId: null,
					},
				},
			},
			db,
		);
		expect(pmCaps).toEqual({
			...DEFAULT_SETTINGS_CAPABILITIES,
			canManageProjects: true,
		});

		const plainCaps = await resolveSettingsCapabilitiesForIdentity(
			{
				settingsAccess: "member",
				identity: {
					userId: plainMember.userId,
					organizationId: fixture.organizationId,
					membershipRole: "member",
					employee: {
						id: plainMember.employeeId,
						organizationId: fixture.organizationId,
						role: "employee",
						teamId: null,
					},
				},
			},
			db,
		);
		expect(plainCaps).toEqual(DEFAULT_SETTINGS_CAPABILITIES);

		const managerCaps = await resolveSettingsCapabilitiesForIdentity(
			{
				settingsAccess: "scopedManager",
				identity: {
					userId: scopedManager.userId,
					organizationId: fixture.organizationId,
					membershipRole: "member",
					employee: {
						id: scopedManager.employeeId,
						organizationId: fixture.organizationId,
						role: "manager",
						teamId: null,
					},
				},
			},
			db,
		);
		expect(managerCaps).toEqual(DEFAULT_SETTINGS_CAPABILITIES);
	});

	it("resolves driving licence, active report share links, and closed months for orgAdmin and owner", async () => {
		const adminCaps = await resolveSettingsCapabilitiesForIdentity(
			{
				settingsAccess: "orgAdmin",
				identity: {
					userId: orgAdmin.userId,
					organizationId: fixture.organizationId,
					membershipRole: "admin",
					employee: {
						id: orgAdmin.employeeId,
						organizationId: fixture.organizationId,
						role: "employee",
						teamId: null,
					},
				},
			},
			db,
		);
		expect(adminCaps).toEqual({
			canAccessClosedMonths: true,
			canManageApprovalEscalation: false,
			canManageProjects: false,
			canManageDrivingLicence: true,
			hasActiveReportShareLinks: true,
		});

		const ownerCaps = await resolveSettingsCapabilitiesForIdentity(
			{
				settingsAccess: "owner",
				identity: {
					userId: fixture.ownerUserId,
					organizationId: fixture.organizationId,
					membershipRole: "owner",
					employee: null,
				},
			},
			db,
		);
		expect(ownerCaps).toEqual({
			canAccessClosedMonths: true,
			canManageApprovalEscalation: false,
			canManageProjects: false,
			canManageDrivingLicence: true,
			hasActiveReportShareLinks: true,
		});
	});

	it("returns all-false capabilities when settingsAccess is null (former employee)", async () => {
		const access = settingsAccessOf({
			membershipRole: "member",
			employee: { id: formerEmployee.employeeId, role: "employee", former: true },
		});
		expect(access).toBeNull();

		const caps = await resolveSettingsCapabilitiesForIdentity(
			{
				settingsAccess: access,
				identity: null,
			},
			db,
		);
		expect(caps).toEqual(DEFAULT_SETTINGS_CAPABILITIES);
	});
});
