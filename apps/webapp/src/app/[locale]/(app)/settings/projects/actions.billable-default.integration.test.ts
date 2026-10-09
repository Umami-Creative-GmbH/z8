/**
 * #900 runtime evidence: a project's billable default.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The real project settings server actions run against PostgreSQL. Only the
 * request/session, SSO proof, billing, notification delivery, audit sink and
 * Next cache boundaries are replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { sessions } = await vi.hoisted(async () => {
	const { AsyncLocalStorage } = await import("node:async_hooks");
	return {
		sessions: new AsyncLocalStorage<{ userId: string; organizationId: string }>(),
	};
});

// getRequestSession awaits connection(), which throws outside a Next request scope.
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => {
				const current = sessions.getStore();
				return current
					? {
							user: { id: current.userId, role: "user" },
							session: {
								id: `t900-session-${current.userId}`,
								userId: current.userId,
								activeOrganizationId: current.organizationId,
							},
						}
					: null;
			},
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		getPrincipalContext: async () => {
			const current = sessions.getStore();
			return current ? loadOrganizationPrincipalContext(db, current) : null;
		},
	};
});

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: async () => undefined,
}));

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return {
		...original,
		logger: { ...original.logger, ...quiet },
		createLogger: () => ({ ...original.logger, ...quiet }),
	};
});

const projects = await import("./actions");
const customers = await import("../customers/actions");
const { getProjectTotalHours } = await import("@/lib/notifications/project-notification-triggers");

const ids = {
	organization: "t900-default-org",
	ownerUser: "t900-default-owner-user",
	projectManagerUser: "t900-default-pm-user",
	employeeUser: "t900-default-employee-user",
	owner: "e9001000-0000-4000-8000-000000000001",
	projectManager: "e9001000-0000-4000-8000-000000000002",
	employee: "e9001000-0000-4000-8000-000000000003",
	customer: "e9001000-0000-4000-8000-000000000010",
	customerProject: "e9001000-0000-4000-8000-000000000020",
	internalProject: "e9001000-0000-4000-8000-000000000021",
	unmanagedProject: "e9001000-0000-4000-8000-000000000022",
	clockIn: "e9001000-0000-4000-8000-000000000030",
	billableWork: "e9001000-0000-4000-8000-000000000031",
	clockInOther: "e9001000-0000-4000-8000-000000000032",
	nonBillableWork: "e9001000-0000-4000-8000-000000000033",
} as const;
const users = [ids.ownerUser, ids.projectManagerUser, ids.employeeUser];

describe("project billable default on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs<T>(userId: string, action: () => Promise<T>): Promise<T> {
		return sessions.run({ userId, organizationId: ids.organization }, action);
	}

	async function billableDefault(projectId: string) {
		const { rows } = await admin.query<{ billable_default: boolean }>(
			"select billable_default from project where id = $1",
			[projectId],
		);
		return rows[0]?.billable_default;
	}

	async function workBillability() {
		const { rows } = await admin.query<{ id: string; is_billable: boolean }>(
			"select id, is_billable from work_period where organization_id = $1 order by id",
			[ids.organization],
		);
		return Object.fromEntries(rows.map((row) => [row.id, row.is_billable]));
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, billable_time_enabled, created_at)
			 values ($1, 'T900 default', $1, 'UTC', true, true, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR')`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ($2 || '-member', $1, $2, 'owner', 'approved', $5),
			 ($3 || '-member', $1, $3, 'member', 'approved', $5),
			 ($4 || '-member', $1, $4, 'member', 'approved', $5)`,
			[ids.organization, ids.ownerUser, ids.projectManagerUser, ids.employeeUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'admin', $8), ($3, $4, $7, 'manager', $8), ($5, $6, $7, 'employee', $8)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.projectManager,
				ids.projectManagerUser,
				ids.employee,
				ids.employeeUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Acme', $3, $4)`,
			[ids.customer, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, customer_id, created_by, updated_at) values
			 ($1, $4, 'Customer project', 'active', true, $5, $6, $7),
			 ($2, $4, 'Internal project', 'active', true, null, $6, $7),
			 ($3, $4, 'Unmanaged project', 'active', true, $5, $6, $7)`,
			[
				ids.customerProject,
				ids.internalProject,
				ids.unmanagedProject,
				ids.organization,
				ids.customer,
				ids.ownerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by)
			 select project_id, $2, $3 from unnest($1::uuid[]) as project_id`,
			[[ids.customerProject, ids.internalProject], ids.projectManager, ids.ownerUser],
		);
		// Existing work on the customer's project: one billable, one not.
		for (const [entry, period, billable, hour] of [
			[ids.clockIn, ids.billableWork, true, 8],
			[ids.clockInOther, ids.nonBillableWork, false, 13],
		] as const) {
			const start = new Date(Date.UTC(2026, 6, 20, hour));
			await admin.query(
				`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				   timezone, timezone_source, hash, created_by)
				 values ($1, $2, $3, 'clock_in', $4, 0, 'UTC', 'user_setting', $5, $6)`,
				[entry, ids.employee, ids.organization, start, `t900-hash-${entry}`, ids.employeeUser],
			);
			await admin.query(
				`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, end_time,
				   duration_minutes, is_active, project_id, is_billable, updated_at)
				 values ($1, $2, $3, $4, $5, $5::timestamp + interval '1 hour', 60, false, $6, $7, now())`,
				[period, ids.employee, ids.organization, entry, start, ids.customerProject, billable],
			);
		}
	}

	beforeEach(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("lets an org admin switch a customer's project billable by default", async () => {
		const result = await actAs(ids.ownerUser, () =>
			projects.updateProject(ids.customerProject, { billableDefault: true }),
		);

		expect(result).toEqual({ success: true, data: undefined });
		expect(await billableDefault(ids.customerProject)).toBe(true);
		const listed = await actAs(ids.ownerUser, () => projects.getProjects(ids.organization));
		expect(
			listed.success && listed.data.find((project) => project.id === ids.customerProject),
		).toMatchObject({ billableDefault: true });
	});

	it("refuses a billable default on a project without a customer", async () => {
		const result = await actAs(ids.ownerUser, () =>
			projects.updateProject(ids.internalProject, { billableDefault: true }),
		);

		expect(result).toMatchObject({ success: false });
		expect(await billableDefault(ids.internalProject)).toBe(false);
	});

	it("creates a project billable by default only with a customer", async () => {
		const refused = await actAs(ids.ownerUser, () =>
			projects.createProject({
				organizationId: ids.organization,
				name: "Internal billable",
				billableDefault: true,
			}),
		);
		expect(refused).toMatchObject({ success: false });
		const { rows: none } = await admin.query(
			"select id from project where organization_id = $1 and name = 'Internal billable'",
			[ids.organization],
		);
		expect(none).toEqual([]);

		const created = await actAs(ids.ownerUser, () =>
			projects.createProject({
				organizationId: ids.organization,
				name: "Customer billable",
				customerId: ids.customer,
				billableDefault: true,
			}),
		);
		expect(created).toMatchObject({ success: true });
		if (!created.success) return;
		expect(await billableDefault(created.data.id)).toBe(true);
	});

	it("lets a project manager set it on their project, but not on another one", async () => {
		await expect(
			actAs(ids.projectManagerUser, () =>
				projects.updateProject(ids.customerProject, { billableDefault: true }),
			),
		).resolves.toMatchObject({ success: true });
		expect(await billableDefault(ids.customerProject)).toBe(true);

		await expect(
			actAs(ids.projectManagerUser, () =>
				projects.updateProject(ids.unmanagedProject, { billableDefault: true }),
			),
		).resolves.toMatchObject({ success: false });
		expect(await billableDefault(ids.unmanagedProject)).toBe(false);
	});

	it("refuses users who cannot edit the project", async () => {
		await expect(
			actAs(ids.employeeUser, () =>
				projects.updateProject(ids.customerProject, { billableDefault: true }),
			),
		).resolves.toMatchObject({ success: false });
		expect(await billableDefault(ids.customerProject)).toBe(false);
	});

	it("switches the default off when the project loses its customer", async () => {
		await actAs(ids.ownerUser, () =>
			projects.updateProject(ids.customerProject, { billableDefault: true }),
		);

		await expect(
			actAs(ids.ownerUser, () => projects.updateProject(ids.customerProject, { customerId: null })),
		).resolves.toMatchObject({ success: true });
		expect(await billableDefault(ids.customerProject)).toBe(false);
	});

	it("never changes existing work when the billable default changes", async () => {
		const before = await workBillability();
		expect(before).toEqual({ [ids.billableWork]: true, [ids.nonBillableWork]: false });

		await actAs(ids.ownerUser, () =>
			projects.updateProject(ids.customerProject, { billableDefault: true }),
		);
		expect(await workBillability()).toEqual(before);
		await actAs(ids.ownerUser, () =>
			projects.updateProject(ids.customerProject, { billableDefault: false }),
		);
		expect(await workBillability()).toEqual(before);
	});

	it("treats a project whose customer was deleted as a project without customer", async () => {
		await admin.query("update customer set is_active = false where id = $1", [ids.customer]);

		await expect(
			actAs(ids.ownerUser, () =>
				projects.updateProject(ids.customerProject, { billableDefault: true }),
			),
		).resolves.toMatchObject({ success: false });
		expect(await billableDefault(ids.customerProject)).toBe(false);

		// Another edit switches a default left on from before the deletion off.
		await admin.query("update project set billable_default = true where id = $1", [
			ids.unmanagedProject,
		]);
		await expect(
			actAs(ids.ownerUser, () =>
				projects.updateProject(ids.unmanagedProject, { description: "Still running" }),
			),
		).resolves.toMatchObject({ success: true });
		expect(await billableDefault(ids.unmanagedProject)).toBe(false);
	});

	it("switches the billable default off on the customer's projects when the customer is deleted", async () => {
		await actAs(ids.ownerUser, () =>
			projects.updateProject(ids.customerProject, { billableDefault: true }),
		);
		const before = await workBillability();

		await expect(
			actAs(ids.ownerUser, () => customers.deleteCustomer(ids.customer)),
		).resolves.toMatchObject({ success: true });

		expect(await billableDefault(ids.customerProject)).toBe(false);
		// Existing work keeps its billability; reports show it as without customer.
		expect(await workBillability()).toEqual(before);
	});

	it("refuses to change the billable default while Billable Time is off, and keeps it", async () => {
		await actAs(ids.ownerUser, () =>
			projects.updateProject(ids.customerProject, { billableDefault: true }),
		);
		await admin.query("update organization set billable_time_enabled = false where id = $1", [
			ids.organization,
		]);

		await expect(
			actAs(ids.ownerUser, () =>
				projects.updateProject(ids.customerProject, { billableDefault: false }),
			),
		).resolves.toMatchObject({ success: false });
		await expect(
			actAs(ids.ownerUser, () =>
				projects.createProject({
					organizationId: ids.organization,
					name: "Created while off",
					customerId: ids.customer,
					billableDefault: true,
				}),
			),
		).resolves.toMatchObject({ success: false });
		expect(await billableDefault(ids.customerProject)).toBe(true);

		// Other edits still work and keep the default, which new work keeps taking.
		await expect(
			actAs(ids.ownerUser, () =>
				projects.updateProject(ids.customerProject, { description: "Edited while off" }),
			),
		).resolves.toMatchObject({ success: true });
		expect(await billableDefault(ids.customerProject)).toBe(true);
	});

	it("counts booked hours from completed work only, as the reports and budget alerts do (#794)", async () => {
		// Deleted work keeps its times in the row; running work has no duration yet.
		await admin.query(
			`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
			   timezone, timezone_source, hash, created_by) values
			 ('e9001000-0000-4000-8000-000000000040', $1, $2, 'clock_in', '2026-07-21T08:00:00Z', 0, 'UTC', 'user_setting', 't900-hash-deleted', $3),
			 ('e9001000-0000-4000-8000-000000000042', $1, $2, 'clock_in', '2026-07-22T08:00:00Z', 0, 'UTC', 'user_setting', 't900-hash-running', $3)`,
			[ids.employee, ids.organization, ids.employeeUser],
		);
		await admin.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, end_time,
			   duration_minutes, is_active, project_id, deleted_at, updated_at) values
			 ('e9001000-0000-4000-8000-000000000041', $1, $2, 'e9001000-0000-4000-8000-000000000040',
			  '2026-07-21T08:00:00Z', '2026-07-21T11:00:00Z', 180, false, $3, now(), now()),
			 ('e9001000-0000-4000-8000-000000000043', $1, $2, 'e9001000-0000-4000-8000-000000000042',
			  '2026-07-22T08:00:00Z', null, null, true, $3, null, now())`,
			[ids.employee, ids.organization, ids.customerProject],
		);

		const listed = await actAs(ids.ownerUser, () => projects.getProjects(ids.organization));
		expect(
			listed.success && listed.data.find((project) => project.id === ids.customerProject),
		).toMatchObject({ totalHoursBooked: 2 });
		await expect(getProjectTotalHours(ids.customerProject, ids.organization)).resolves.toBe(2);
	});

	it("refuses a billable default that is not a boolean", async () => {
		const result = await actAs(ids.ownerUser, () =>
			projects.updateProject(ids.customerProject, { billableDefault: "yes" as never }),
		);

		expect(result).toMatchObject({ success: false });
		expect(await billableDefault(ids.customerProject)).toBe(false);
	});
});
