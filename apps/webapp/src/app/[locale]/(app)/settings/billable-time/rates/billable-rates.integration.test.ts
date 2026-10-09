/**
 * #898: billable rates at four rate levels on PostgreSQL.
 *
 * The real server actions, rate writer, EXCLUDE constraints, audit trail and
 * applicable-rate reader run against a disposable database. Only the
 * request/session, SSO session store, Next cache and logger are replaced.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

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
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { endBillableRate, getBillableRateHistory, setBillableRate } = await import("./actions");
const { updateBillableCurrency } = await import("../actions");
const { getApplicableRate } = await import("@/lib/billable-time/billable-rates");
const { db } = await import("@/db");

const ids = {
	organization: "t898-org",
	otherOrganization: "t898-other-org",
	ownerUser: "t898-owner-user",
	adminUser: "t898-admin-user",
	memberUser: "t898-member-user",
	otherOwnerUser: "t898-other-owner-user",
	employee: "89800000-0000-4000-8000-000000000001",
	otherEmployee: "89800000-0000-4000-8000-000000000002",
	foreignEmployee: "89800000-0000-4000-8000-000000000003",
	customer: "89800000-0000-4000-8000-000000000011",
	foreignCustomer: "89800000-0000-4000-8000-000000000012",
	project: "89800000-0000-4000-8000-000000000021",
	projectWithoutCustomer: "89800000-0000-4000-8000-000000000022",
	foreignProject: "89800000-0000-4000-8000-000000000023",
} as const;
const users = [ids.ownerUser, ids.adminUser, ids.memberUser, ids.otherOwnerUser];

const employeeRate = { level: "employee", employeeId: ids.employee } as const;
const customerRate = { level: "customer", customerId: ids.customer } as const;
const projectRate = { level: "project", projectId: ids.project } as const;
const employeeProjectRate = {
	level: "employee_project",
	employeeId: ids.employee,
	projectId: ids.project,
} as const;

/** Work that started at 09:00 local time (UTC+02:00) on `day`. */
function workOn(day: string, projectId: string | null = ids.project) {
	return {
		employeeId: ids.employee,
		projectId,
		startedAt: Temporal.PlainDateTime.from(`${day}T09:00`).toZonedDateTime("+02:00").toInstant(),
		startOffsetMinutes: 120,
	};
}

describe("billable rates on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function auditEntries() {
		const { rows } = await admin.query<{
			action: string;
			performed_by: string;
			entity_type: string;
			employee_id: string | null;
			changes: string;
		}>(
			`select action, performed_by, entity_type, employee_id, changes from audit_log
			 where organization_id = $1 and entity_type = 'billable_rate' order by timestamp, id`,
			[ids.organization],
		);
		return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, projects_enabled, billable_time_enabled, created_at) values
			 ($1, 'T898', $1, true, true, $3), ($2, 'T898 other', $2, true, true, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'CHF')`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t898-m-owner', $1, $3, 'owner', 'approved', $7),
			 ('t898-m-admin', $1, $4, 'admin', 'approved', $7),
			 ('t898-m-member', $1, $5, 'member', 'approved', $7),
			 ('t898-m-other-owner', $2, $6, 'owner', 'approved', $7),
			 ('t898-m-admin-in-other', $2, $4, 'member', 'approved', $7)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.adminUser,
				ids.memberUser,
				ids.otherOwnerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, first_name, last_name, updated_at) values
			 ($1, $4, $6, 'Ada', 'Member', $8),
			 ($2, $5, $6, 'Bo', 'Admin', $8),
			 ($3, $9, $7, 'Cy', 'Foreign', $8)`,
			[
				ids.employee,
				ids.otherEmployee,
				ids.foreignEmployee,
				ids.memberUser,
				ids.adminUser,
				ids.organization,
				ids.otherOrganization,
				timestamp,
				ids.otherOwnerUser,
			],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $3, 'Acme', $5, $6), ($2, $4, 'Foreign customer', $7, $6)`,
			[
				ids.customer,
				ids.foreignCustomer,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				timestamp,
				ids.otherOwnerUser,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, customer_id, created_by, updated_at) values
			 ($1, $4, 'Website', $6, $7, $8),
			 ($2, $4, 'Internal', null, $7, $8),
			 ($3, $5, 'Foreign project', null, $9, $8)`,
			[
				ids.project,
				ids.projectWithoutCustomer,
				ids.foreignProject,
				ids.organization,
				ids.otherOrganization,
				ids.customer,
				ids.ownerUser,
				timestamp,
				ids.otherOwnerUser,
			],
		);
		actAs(ids.adminUser);
	});

	afterAll(cleanup);

	describe("rate periods", () => {
		it("closes the previous open rate when a rate is added from a date", async () => {
			await setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "80" });

			const result = await setBillableRate({
				target: employeeRate,
				effectiveFrom: "2026-07-01",
				rate: "85,50",
			});

			expect(result).toMatchObject({
				success: true,
				data: {
					periods: [
						{ effectiveFrom: "2026-07-01", effectiveTo: null, hourlyRate: "85.50" },
						{ effectiveFrom: "2026-01-01", effectiveTo: "2026-07-01", hourlyRate: "80.00" },
					],
				},
			});
			await expect(getBillableRateHistory({ target: employeeRate })).resolves.toMatchObject({
				success: true,
				data: { currency: "EUR", periods: [{ hourlyRate: "85.50" }, { hourlyRate: "80.00" }] },
			});
		});

		it("lets a backdated rate reprice work recorded before it", async () => {
			await setBillableRate({ target: projectRate, effectiveFrom: "2026-06-01", rate: "100" });
			await expect(getApplicableRate(db, ids.organization, workOn("2026-03-10"))).resolves.toEqual({
				kind: "unpriced",
			});

			await setBillableRate({ target: projectRate, effectiveFrom: "2026-03-01", rate: "95" });

			await expect(
				getApplicableRate(db, ids.organization, workOn("2026-03-10")),
			).resolves.toMatchObject({ kind: "priced", rate: BigInt(9500), level: "project" });
			await expect(
				getApplicableRate(db, ids.organization, workOn("2026-06-10")),
			).resolves.toMatchObject({ rate: BigInt(10000) });
		});

		it("ends a rate from a date, leaving later work unpriced", async () => {
			await setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "80" });

			await expect(
				endBillableRate({ target: employeeRate, effectiveFrom: "2026-05-01" }),
			).resolves.toMatchObject({
				success: true,
				data: { periods: [{ effectiveFrom: "2026-01-01", effectiveTo: "2026-05-01" }] },
			});
			await expect(getApplicableRate(db, ids.organization, workOn("2026-05-02"))).resolves.toEqual({
				kind: "unpriced",
			});
		});

		it("refuses an invalid rate or date", async () => {
			await expect(
				setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "0" }),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
			await expect(
				setBillableRate({ target: employeeRate, effectiveFrom: "2026-02-30", rate: "80" }),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
			await expect(
				setBillableRate({ target: { level: "employee" }, effectiveFrom: "2026-01-01", rate: "80" }),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
		});
	});

	describe("rate levels", () => {
		it("resolves the most specific level with a rate in effect", async () => {
			await setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "80" });
			await setBillableRate({ target: customerRate, effectiveFrom: "2026-01-01", rate: "90" });
			await setBillableRate({ target: projectRate, effectiveFrom: "2026-01-01", rate: "100" });
			await setBillableRate({
				target: employeeProjectRate,
				effectiveFrom: "2026-04-01",
				rate: "110",
			});

			await expect(
				getApplicableRate(db, ids.organization, workOn("2026-03-31")),
			).resolves.toMatchObject({ rate: BigInt(10000), level: "project" });
			await expect(
				getApplicableRate(db, ids.organization, workOn("2026-04-01")),
			).resolves.toMatchObject({ rate: BigInt(11000), level: "employee_project" });
		});

		it("never resolves a customer rate for work on a project without a customer", async () => {
			await setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "80" });
			await setBillableRate({ target: customerRate, effectiveFrom: "2026-01-01", rate: "90" });

			await expect(
				getApplicableRate(db, ids.organization, workOn("2026-03-10", ids.projectWithoutCustomer)),
			).resolves.toMatchObject({ rate: BigInt(8000), level: "employee" });
			await expect(
				getApplicableRate(db, ids.organization, workOn("2026-03-10")),
			).resolves.toMatchObject({ rate: BigInt(9000), level: "customer" });
		});
	});

	describe("database rules", () => {
		const overlapping = [
			["employee_project", ids.employee, ids.project, null],
			["project", null, ids.project, null],
			["customer", null, null, ids.customer],
			["employee", ids.employee, null, null],
		] as const;

		it.each(overlapping)(
			"rejects overlapping %s rate periods",
			async (level, employeeId, projectId, customerId) => {
				const insert = (from: string, to: string | null) =>
					admin.query(
						`insert into billable_rate (organization_id, level, employee_id, project_id, customer_id, hourly_rate, effective_from, effective_to)
					 values ($1, $2, $3, $4, $5, 90, $6, $7)`,
						[ids.organization, level, employeeId, projectId, customerId, from, to],
					);
				await insert("2026-01-01", "2026-06-01");
				// Adjacent half-open periods are fine.
				await insert("2026-06-01", null);

				await expect(insert("2026-05-31", "2026-06-01")).rejects.toMatchObject({ code: "23P01" });
			},
		);

		it("rejects a rate whose target belongs to another organization", async () => {
			await expect(
				admin.query(
					`insert into billable_rate (organization_id, level, customer_id, hourly_rate, effective_from)
					 values ($1, 'customer', $2, 90, '2026-01-01')`,
					[ids.organization, ids.foreignCustomer],
				),
			).rejects.toMatchObject({ code: "23503" });
		});
	});

	describe("audit trail", () => {
		it("records every change with actor, level, target, old and new value and effective date", async () => {
			await setBillableRate({ target: customerRate, effectiveFrom: "2026-06-01", rate: "90" });
			await setBillableRate({ target: customerRate, effectiveFrom: "2026-02-01", rate: "85" });
			await setBillableRate({ target: customerRate, effectiveFrom: "2026-08-01", rate: "95" });
			await endBillableRate({ target: customerRate, effectiveFrom: "2026-10-01" });
			// No change, no entry.
			await setBillableRate({ target: customerRate, effectiveFrom: "2026-08-15", rate: "95" });

			const entries = await auditEntries();
			expect(entries).toHaveLength(4);
			expect(entries).toEqual([
				expect.objectContaining({
					action: "billable_time.rate_set",
					performed_by: ids.adminUser,
					changes: expect.objectContaining({
						level: "customer",
						customerId: ids.customer,
						effectiveFrom: "2026-06-01",
						old: null,
						new: "90.00",
					}),
				}),
				expect.objectContaining({
					action: "billable_time.rate_set",
					changes: expect.objectContaining({
						effectiveFrom: "2026-02-01",
						old: null,
						new: "85.00",
					}),
				}),
				expect.objectContaining({
					changes: expect.objectContaining({
						effectiveFrom: "2026-08-01",
						old: "90.00",
						new: "95.00",
					}),
				}),
				expect.objectContaining({
					action: "billable_time.rate_ended",
					changes: expect.objectContaining({
						effectiveFrom: "2026-10-01",
						old: "95.00",
						new: null,
					}),
				}),
			]);
		});

		it("links employee rate entries to the employee", async () => {
			await setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "80" });

			expect(await auditEntries()).toEqual([
				expect.objectContaining({ employee_id: ids.employee }),
			]);
		});
	});

	describe("access", () => {
		it("lets owners and admins read and write, and refuses members", async () => {
			actAs(ids.ownerUser);
			await expect(
				setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "80" }),
			).resolves.toMatchObject({ success: true });

			actAs(ids.memberUser);
			await expect(
				setBillableRate({ target: employeeRate, effectiveFrom: "2026-02-01", rate: "99" }),
			).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
			await expect(getBillableRateHistory({ target: employeeRate })).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
			await expect(
				endBillableRate({ target: employeeRate, effectiveFrom: "2026-02-01" }),
			).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		});

		it("refuses targets of another organization", async () => {
			for (const target of [
				{ level: "employee", employeeId: ids.foreignEmployee },
				{ level: "project", projectId: ids.foreignProject },
				{ level: "customer", customerId: ids.foreignCustomer },
				{ level: "employee_project", employeeId: ids.employee, projectId: ids.foreignProject },
			]) {
				await expect(
					setBillableRate({ target, effectiveFrom: "2026-01-01", rate: "80" }),
				).resolves.toMatchObject({ success: false, code: "NotFoundError" });
			}
			const { rows } = await admin.query(
				"select id from billable_rate where organization_id = any($1::text[])",
				[[ids.organization, ids.otherOrganization]],
			);
			expect(rows).toEqual([]);
		});

		it("acts on the active organization, where an admin elsewhere is only a member", async () => {
			actAs(ids.adminUser, ids.otherOrganization);

			await expect(
				setBillableRate({
					target: { level: "employee", employeeId: ids.foreignEmployee },
					effectiveFrom: "2026-01-01",
					rate: "80",
				}),
			).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		});

		it("keeps rates read-only while Billable Time is off", async () => {
			await admin.query("update organization set billable_time_enabled = false where id = $1", [
				ids.organization,
			]);

			await expect(
				setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "80" }),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
			await expect(getBillableRateHistory({ target: employeeRate })).resolves.toMatchObject({
				success: false,
			});
		});
	});

	it("makes the billable currency read-only once a rate exists", async () => {
		await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
			success: true,
		});
		await setBillableRate({ target: employeeRate, effectiveFrom: "2026-01-01", rate: "80" });

		await expect(updateBillableCurrency({ currency: "EUR" })).resolves.toMatchObject({
			success: false,
			code: "ConflictError",
		});
	});
});
