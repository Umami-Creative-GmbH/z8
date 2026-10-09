/**
 * #899: cost rates per employee on PostgreSQL.
 *
 * The real server actions, cost-rate writer, EXCLUDE constraint, audit trail
 * and readers run against a disposable database. Only the request/session, SSO
 * session store, Next cache and logger are replaced.
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

const { endCostRate, getCostRateHistory, setCostRate } = await import("./actions");
const { updateBillableCurrency } = await import("../actions");
const { getCostRate, listCostRatesForWork } = await import("@/lib/billable-time/cost-rates");
const { db } = await import("@/db");

const ids = {
	organization: "t899-org",
	otherOrganization: "t899-other-org",
	ownerUser: "t899-owner-user",
	adminUser: "t899-admin-user",
	memberUser: "t899-member-user",
	managerUser: "t899-manager-user",
	otherOwnerUser: "t899-other-owner-user",
	hourlyEmployee: "89900000-0000-4000-8000-000000000001",
	salariedEmployee: "89900000-0000-4000-8000-000000000002",
	managerEmployee: "89900000-0000-4000-8000-000000000003",
	foreignEmployee: "89900000-0000-4000-8000-000000000004",
	project: "89900000-0000-4000-8000-000000000021",
} as const;
const users = [ids.ownerUser, ids.adminUser, ids.memberUser, ids.managerUser, ids.otherOwnerUser];

/** Midday on `day` at UTC+02:00. */
function middayOn(day: string) {
	return {
		at: Temporal.PlainDateTime.from(`${day}T12:00`).toZonedDateTime("+02:00").toInstant(),
		offsetMinutes: 120,
	};
}

describe("cost rates on PostgreSQL", () => {
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
			 where organization_id = $1 and entity_type = 'cost_rate' order by timestamp, id`,
			[ids.organization],
		);
		return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
	}

	async function wageOf(employeeId: string) {
		const { rows: history } = await admin.query<{ hourly_rate: string }>(
			"select hourly_rate from employee_rate_history where employee_id = $1 order by effective_from",
			[employeeId],
		);
		const { rows: current } = await admin.query<{ current_hourly_rate: string | null }>(
			"select current_hourly_rate from employee where id = $1",
			[employeeId],
		);
		return {
			history: history.map((row) => row.hourly_rate),
			current: current[0]?.current_hourly_rate ?? null,
		};
	}

	beforeEach(async () => {
		await cleanup();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, projects_enabled, billable_time_enabled, created_at) values
			 ($1, 'T899', $1, true, true, $3), ($2, 'T899 other', $2, true, true, $3)`,
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
			 ('t899-m-owner', $1, $3, 'owner', 'approved', $8),
			 ('t899-m-admin', $1, $4, 'admin', 'approved', $8),
			 ('t899-m-member', $1, $5, 'member', 'approved', $8),
			 ('t899-m-manager', $1, $6, 'member', 'approved', $8),
			 ('t899-m-other-owner', $2, $7, 'owner', 'approved', $8),
			 ('t899-m-admin-in-other', $2, $4, 'member', 'approved', $8)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				ids.adminUser,
				ids.memberUser,
				ids.managerUser,
				ids.otherOwnerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, first_name, last_name, role, contract_type, current_hourly_rate, updated_at) values
			 ($1, $5, $9, 'Ada', 'Hourly', 'employee', 'hourly', 25.00, $11),
			 ($2, $6, $9, 'Bo', 'Salaried', 'employee', 'fixed', 30.00, $11),
			 ($3, $7, $9, 'Cy', 'Manager', 'manager', 'fixed', null, $11),
			 ($4, $8, $10, 'Di', 'Foreign', 'employee', 'hourly', 20.00, $11)`,
			[
				ids.hourlyEmployee,
				ids.salariedEmployee,
				ids.managerEmployee,
				ids.foreignEmployee,
				ids.memberUser,
				ids.adminUser,
				ids.managerUser,
				ids.otherOwnerUser,
				ids.organization,
				ids.otherOrganization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_rate_history (employee_id, organization_id, hourly_rate, currency, effective_from, effective_to, created_by) values
			 ($1, $2, 22.00, 'EUR', '2025-01-01', '2026-01-01', $3),
			 ($1, $2, 25.00, 'EUR', '2026-01-01', null, $3)`,
			[ids.hourlyEmployee, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into project (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Website', $3, $4)`,
			[ids.project, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.project, ids.managerEmployee, ids.ownerUser],
		);
		actAs(ids.adminUser);
	});

	afterAll(cleanup);

	describe("cost rate periods", () => {
		it("sets cost rates for hourly and salaried employees alike", async () => {
			for (const employeeId of [ids.hourlyEmployee, ids.salariedEmployee]) {
				await expect(
					setCostRate({ employeeId, effectiveFrom: "2026-01-01", rate: "48,50" }),
				).resolves.toMatchObject({
					success: true,
					data: {
						changed: true,
						periods: [{ effectiveFrom: "2026-01-01", effectiveTo: null, hourlyRate: "48.50" }],
					},
				});
			}

			await expect(
				getCostRate(db, ids.organization, {
					employeeId: ids.salariedEmployee,
					...middayOn("2026-05-01"),
				}),
			).resolves.toMatchObject({ kind: "known", rate: BigInt(4850) });
		});

		it("closes the open cost rate at a new one and lets a backdated one apply to earlier work", async () => {
			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2026-06-01",
				rate: "50",
			});
			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2026-09-01",
				rate: "55",
			});
			await expect(
				getCostRate(db, ids.organization, {
					employeeId: ids.hourlyEmployee,
					...middayOn("2026-03-10"),
				}),
			).resolves.toEqual({ kind: "unknown" });

			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2026-03-01",
				rate: "45",
			});

			await expect(getCostRateHistory({ employeeId: ids.hourlyEmployee })).resolves.toMatchObject({
				success: true,
				data: {
					currency: "EUR",
					periods: [
						{ effectiveFrom: "2026-09-01", effectiveTo: null, hourlyRate: "55.00" },
						{ effectiveFrom: "2026-06-01", effectiveTo: "2026-09-01", hourlyRate: "50.00" },
						{ effectiveFrom: "2026-03-01", effectiveTo: "2026-06-01", hourlyRate: "45.00" },
					],
				},
			});
			await expect(
				getCostRate(db, ids.organization, {
					employeeId: ids.hourlyEmployee,
					...middayOn("2026-03-10"),
				}),
			).resolves.toMatchObject({ kind: "known", rate: BigInt(4500) });
		});

		it("ends a cost rate from a date, leaving later work's cost unknown", async () => {
			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2026-01-01",
				rate: "50",
			});

			await expect(
				endCostRate({ employeeId: ids.hourlyEmployee, effectiveFrom: "2026-05-01" }),
			).resolves.toMatchObject({
				success: true,
				data: { periods: [{ effectiveFrom: "2026-01-01", effectiveTo: "2026-05-01" }] },
			});
			await expect(
				getCostRate(db, ids.organization, {
					employeeId: ids.hourlyEmployee,
					...middayOn("2026-05-02"),
				}),
			).resolves.toEqual({ kind: "unknown" });
		});

		it("refuses an invalid rate, date or employee", async () => {
			await expect(
				setCostRate({ employeeId: ids.hourlyEmployee, effectiveFrom: "2026-01-01", rate: "0" }),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
			await expect(
				setCostRate({ employeeId: ids.hourlyEmployee, effectiveFrom: "2026-02-30", rate: "50" }),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
			await expect(
				setCostRate({ employeeId: "not-a-uuid", effectiveFrom: "2026-01-01", rate: "50" }),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
		});

		it("loads the cost rates of many employees for a day range, scoped to the organization", async () => {
			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2026-01-01",
				rate: "50",
			});
			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2026-07-01",
				rate: "60",
			});
			await setCostRate({
				employeeId: ids.salariedEmployee,
				effectiveFrom: "2026-08-01",
				rate: "70",
			});

			const rates = await listCostRatesForWork(db, ids.organization, {
				employeeIds: [ids.hourlyEmployee, ids.salariedEmployee, ids.foreignEmployee],
				fromDay: Temporal.PlainDate.from("2026-07-15"),
				toDay: Temporal.PlainDate.from("2026-07-31"),
			});

			expect(rates).toEqual([
				expect.objectContaining({
					employeeId: ids.hourlyEmployee,
					rate: BigInt(6000),
					from: Temporal.PlainDate.from("2026-07-01"),
					to: null,
				}),
			]);
			await expect(
				listCostRatesForWork(db, ids.otherOrganization, { employeeIds: [ids.hourlyEmployee] }),
			).resolves.toEqual([]);
		});
	});

	describe("separate from the wage", () => {
		it("suggests the hourly wage in effect without copying it", async () => {
			await expect(getCostRateHistory({ employeeId: ids.hourlyEmployee })).resolves.toMatchObject({
				success: true,
				data: { periods: [], suggestedWage: { hourlyRate: "25.00" } },
			});
			await expect(
				getCostRate(db, ids.organization, {
					employeeId: ids.hourlyEmployee,
					...middayOn("2026-05-01"),
				}),
			).resolves.toEqual({ kind: "unknown" });
		});

		it("suggests no wage for a salaried employee or a wage in another currency", async () => {
			await expect(getCostRateHistory({ employeeId: ids.salariedEmployee })).resolves.toMatchObject(
				{
					success: true,
					data: { suggestedWage: null },
				},
			);

			await admin.query(
				"update employee_rate_history set currency = 'CHF' where employee_id = $1",
				[ids.hourlyEmployee],
			);
			await expect(getCostRateHistory({ employeeId: ids.hourlyEmployee })).resolves.toMatchObject({
				success: true,
				data: { suggestedWage: null },
			});
		});

		it("never changes the wage history or the current wage", async () => {
			const before = await wageOf(ids.hourlyEmployee);

			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2025-06-01",
				rate: "60",
			});
			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2026-02-01",
				rate: "65",
			});
			await endCostRate({ employeeId: ids.hourlyEmployee, effectiveFrom: "2026-04-01" });

			expect(await wageOf(ids.hourlyEmployee)).toEqual(before);
			expect(before).toEqual({ history: ["22.00", "25.00"], current: "25.00" });
		});
	});

	describe("database rules", () => {
		it("rejects overlapping cost rate periods of one employee", async () => {
			const insert = (employeeId: string, from: string, to: string | null) =>
				admin.query(
					`insert into cost_rate (organization_id, employee_id, hourly_rate, effective_from, effective_to)
					 values ($1, $2, 50, $3, $4)`,
					[ids.organization, employeeId, from, to],
				);
			await insert(ids.hourlyEmployee, "2026-01-01", "2026-06-01");
			// Adjacent half-open periods and other employees are fine.
			await insert(ids.hourlyEmployee, "2026-06-01", null);
			await insert(ids.salariedEmployee, "2026-03-01", null);

			await expect(insert(ids.hourlyEmployee, "2026-05-31", "2026-06-01")).rejects.toMatchObject({
				code: "23P01",
			});
		});

		it("rejects a cost rate for an employee of another organization", async () => {
			await expect(
				admin.query(
					`insert into cost_rate (organization_id, employee_id, hourly_rate, effective_from)
					 values ($1, $2, 50, '2026-01-01')`,
					[ids.organization, ids.foreignEmployee],
				),
			).rejects.toMatchObject({ code: "23503" });
		});
	});

	describe("audit trail", () => {
		it("records every change with actor, employee, old and new value and effective date", async () => {
			await setCostRate({
				employeeId: ids.salariedEmployee,
				effectiveFrom: "2026-06-01",
				rate: "50",
			});
			await setCostRate({
				employeeId: ids.salariedEmployee,
				effectiveFrom: "2026-02-01",
				rate: "45",
			});
			await setCostRate({
				employeeId: ids.salariedEmployee,
				effectiveFrom: "2026-08-01",
				rate: "55",
			});
			await endCostRate({ employeeId: ids.salariedEmployee, effectiveFrom: "2026-10-01" });
			// No change, no entry.
			await setCostRate({
				employeeId: ids.salariedEmployee,
				effectiveFrom: "2026-08-15",
				rate: "55",
			});

			const entries = await auditEntries();
			expect(entries).toEqual([
				expect.objectContaining({
					action: "billable_time.cost_rate_set",
					performed_by: ids.adminUser,
					employee_id: ids.salariedEmployee,
					changes: expect.objectContaining({
						employeeId: ids.salariedEmployee,
						currency: "EUR",
						effectiveFrom: "2026-06-01",
						old: null,
						new: "50.00",
					}),
				}),
				expect.objectContaining({
					action: "billable_time.cost_rate_set",
					changes: expect.objectContaining({
						effectiveFrom: "2026-02-01",
						old: null,
						new: "45.00",
					}),
				}),
				expect.objectContaining({
					changes: expect.objectContaining({
						effectiveFrom: "2026-08-01",
						old: "50.00",
						new: "55.00",
					}),
				}),
				expect.objectContaining({
					action: "billable_time.cost_rate_ended",
					changes: expect.objectContaining({
						effectiveFrom: "2026-10-01",
						old: "55.00",
						new: null,
					}),
				}),
			]);
		});
	});

	describe("access", () => {
		it("lets owners and admins read and write", async () => {
			actAs(ids.ownerUser);
			await expect(
				setCostRate({ employeeId: ids.hourlyEmployee, effectiveFrom: "2026-01-01", rate: "50" }),
			).resolves.toMatchObject({ success: true });
			await expect(getCostRateHistory({ employeeId: ids.hourlyEmployee })).resolves.toMatchObject({
				success: true,
			});
		});

		it.each([
			["employee", ids.memberUser],
			["project manager", ids.managerUser],
		])("refuses a %s, even for their own cost rate", async (_role, userId) => {
			await setCostRate({
				employeeId: ids.hourlyEmployee,
				effectiveFrom: "2026-01-01",
				rate: "50",
			});
			actAs(userId);

			for (const employeeId of [ids.hourlyEmployee, ids.managerEmployee]) {
				await expect(getCostRateHistory({ employeeId })).resolves.toMatchObject({
					success: false,
					code: "AuthorizationError",
				});
				await expect(
					setCostRate({ employeeId, effectiveFrom: "2026-02-01", rate: "99" }),
				).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
				await expect(
					endCostRate({ employeeId, effectiveFrom: "2026-02-01" }),
				).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
			}
		});

		it("refuses an employee of another organization", async () => {
			await expect(
				setCostRate({ employeeId: ids.foreignEmployee, effectiveFrom: "2026-01-01", rate: "50" }),
			).resolves.toMatchObject({ success: false, code: "NotFoundError" });
			await expect(getCostRateHistory({ employeeId: ids.foreignEmployee })).resolves.toMatchObject({
				success: false,
				code: "NotFoundError",
			});
			const { rows } = await admin.query("select id from cost_rate where employee_id = $1", [
				ids.foreignEmployee,
			]);
			expect(rows).toEqual([]);
		});

		it("acts on the active organization, where an admin elsewhere is only a member", async () => {
			actAs(ids.adminUser, ids.otherOrganization);

			await expect(
				setCostRate({ employeeId: ids.foreignEmployee, effectiveFrom: "2026-01-01", rate: "50" }),
			).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		});

		it("keeps cost rates read-only while Billable Time is off", async () => {
			await admin.query("update organization set billable_time_enabled = false where id = $1", [
				ids.organization,
			]);

			await expect(
				setCostRate({ employeeId: ids.hourlyEmployee, effectiveFrom: "2026-01-01", rate: "50" }),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
			await expect(getCostRateHistory({ employeeId: ids.hourlyEmployee })).resolves.toMatchObject({
				success: false,
			});
		});
	});

	it("makes the billable currency read-only once a cost rate exists", async () => {
		await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
			success: true,
		});
		await setCostRate({
			employeeId: ids.salariedEmployee,
			effectiveFrom: "2026-01-01",
			rate: "50",
		});

		await expect(updateBillableCurrency({ currency: "EUR" })).resolves.toMatchObject({
			success: false,
			code: "ConflictError",
		});
	});
});
