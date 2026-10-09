/**
 * #901: bulk-marking a project's work billable or non-billable, on PostgreSQL.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Real work is recorded with the web clock-in/out actions in both admissions
 * (legacy and adopted append). The bulk preview and apply actions then run over a
 * mixed range: work that changes, work already in the target state, held-back
 * work (pending submission), deleted work, work outside the range and work on
 * another project. Each change is an ordinary attribution amendment (adopted:
 * a `work_period_attribution_edit` receipt per work period); the legacy period
 * and its canonical project allocation always agree afterwards.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: null as Instant | null,
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});

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
								id: `t901-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import("@/lib/authorization/principal-loader");
	return {
		...original,
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});

vi.mock("@/lib/enterprise-identity/session-sso-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/enterprise-identity/session-sso-store")>()),
	canAccessOrganizationWithSso: async () => true,
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);

const { clockIn, clockOut } = await import("../../time-tracking/actions/clocking");
const { updateWorkPeriodBillability } = await import("../../time-tracking/actions");
const { applyBulkBillability, previewBulkBillability } = await import("./bulk-billability-actions");

const ids = {
	organization: "t901-bulk-org",
	foreignOrganization: "t901-foreign-org",
	ownerUser: "t901-owner-user",
	adminUser: "t901-admin-user",
	employeeUser: "t901-employee-user",
	secondUser: "t901-second-user",
	managerUser: "t901-manager-user",
	projectManagerUser: "t901-project-manager-user",
	employee: "e9011000-0000-4000-8000-000000000001",
	second: "e9011000-0000-4000-8000-000000000002",
	owner: "e9011000-0000-4000-8000-000000000003",
	manager: "e9011000-0000-4000-8000-000000000004",
	projectManager: "e9011000-0000-4000-8000-000000000005",
	customer: "e9011000-0000-4000-8000-000000000010",
	foreignCustomer: "e9011000-0000-4000-8000-000000000011",
	/** The customer's project the bulk change runs on. */
	project: "e9011000-0000-4000-8000-000000000021",
	/** Another customer project: its work is never touched. */
	otherProject: "e9011000-0000-4000-8000-000000000022",
	/** An internal project without a customer. */
	internalProject: "e9011000-0000-4000-8000-000000000023",
	foreignProject: "e9011000-0000-4000-8000-000000000024",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.employeeUser,
	ids.secondUser,
	ids.managerUser,
	ids.projectManagerUser,
];

const range = { projectId: ids.project, fromDay: "2026-07-02", toDay: "2026-07-12" } as const;

type Attribution = {
	id: string;
	project_id: string | null;
	is_billable: boolean;
	canonical_record_id: string | null;
	allocations: { projectId: string; isBillable: boolean }[] | null;
};

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

function expectSuccess<T>(result: { success: boolean; data?: T; error?: string }): T {
	expect(result).toMatchObject({ success: true });
	return (result as { data: T }).data;
}

describe("bulk billability change on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function attributionOf(periodId: string): Promise<Attribution> {
		const { rows } = await admin.query<Attribution>(
			`select wp.id, wp.project_id, wp.is_billable, wp.canonical_record_id,
			        (select json_agg(json_build_object('projectId', a.project_id, 'isBillable', a.is_billable)
			                         order by a.id)
			           from time_record_allocation a
			          where a.record_id = wp.canonical_record_id and a.allocation_kind = 'project') as allocations
			   from work_period wp
			  where wp.organization_id = $1 and wp.id = $2`,
			[ids.organization, periodId],
		);
		return only(rows);
	}

	/** The period and its canonical project allocation agree on the expected billability. */
	async function expectBillable(periodId: string, billable: boolean) {
		const period = await attributionOf(periodId);
		expect(period.is_billable).toBe(billable);
		expect(period.canonical_record_id).not.toBeNull();
		expect(period.allocations).toEqual([{ projectId: period.project_id, isBillable: billable }]);
	}

	async function workState() {
		const { rows } = await admin.query(
			`select id, project_id, is_billable, graph_revision, deleted_at,
			        (select json_agg(row_to_json(a) order by a.id) from time_record_allocation a
			          where a.record_id = wp.canonical_record_id) as allocations
			   from work_period wp where organization_id = $1 order by id`,
			[ids.organization],
		);
		return rows;
	}

	async function bulkReceipts() {
		const { rows } = await admin.query<{
			kind: string;
			writer: string;
			actor_user_id: string;
			work_period_id: string;
			result: { authority: string; changes: Record<string, boolean> };
		}>(
			`select kind, writer, actor_user_id, work_period_id, result
			   from completed_work_operation
			  where organization_id = $1 and command -> 'request' ? 'bulkBillabilityPreview'
			  order by work_period_id`,
			[ids.organization],
		);
		return rows;
	}

	/** Real clock-in and clock-out of the user's own work; returns the closed period. */
	async function record(
		userId: string,
		employeeId: string,
		projectId: string | null,
		start: string,
		end: string,
		browserTimezone = "UTC",
	): Promise<string> {
		actAs(userId);
		harness.now = parseInstant(end).add({ hours: 1 });
		expect(await clockIn("office", { instant: parseInstant(start), browserTimezone })).toEqual(
			expect.objectContaining({ success: true }),
		);
		const { rows } = await admin.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and end_time is null and deleted_at is null",
			[employeeId],
		);
		const periodId = only(rows).id;
		await expect(
			clockOut(projectId, undefined, {
				submissionId: randomUUID(),
				instant: parseInstant(end),
				browserTimezone,
			}),
		).resolves.toMatchObject({ success: true });
		return periodId;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.foreignOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-06-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, billable_time_enabled, created_at)
			 values ($1, 'T901 bulk', $1, 'UTC', true, true, $3), ($2, 'T901 foreign', $2, 'UTC', true, true, $3)`,
			[ids.organization, ids.foreignOrganization, timestamp],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'EUR')`,
			[ids.organization, ids.foreignOrganization],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2),
			        ($1, 'manual_time_submission', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 'm-' || user_id, $1, user_id, role, 'approved', $4
			   from unnest($2::text[], $3::text[]) as t(user_id, role)`,
			[
				ids.organization,
				users,
				["owner", "admin", "member", "member", "member", "member"],
				timestamp,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 select employee_id, user_id, $4, role::role, $5
			   from unnest($1::uuid[], $2::text[], $3::text[]) as t(employee_id, user_id, role)`,
			[
				[ids.owner, ids.employee, ids.second, ids.manager, ids.projectManager],
				[ids.ownerUser, ids.employeeUser, ids.secondUser, ids.managerUser, ids.projectManagerUser],
				["admin", "employee", "employee", "manager", "manager"],
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
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.employee, ids.manager, ids.ownerUser],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at)
			 values ($1, $3, 'Acme', $5, $6), ($2, $4, 'Foreign', $5, $6)`,
			[
				ids.customer,
				ids.foreignCustomer,
				ids.organization,
				ids.foreignOrganization,
				ids.ownerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, customer_id, billable_default, created_by, updated_at) values
			 ($1, $5, 'Customer project', 'active', true, $6, false, $8, $9),
			 ($2, $5, 'Other customer project', 'active', true, $6, false, $8, $9),
			 ($3, $5, 'Internal', 'active', true, null, false, $8, $9),
			 ($4, $10, 'Foreign project', 'active', true, $7, false, $8, $9)`,
			[
				ids.project,
				ids.otherProject,
				ids.internalProject,
				ids.foreignProject,
				ids.organization,
				ids.customer,
				ids.foreignCustomer,
				ids.ownerUser,
				timestamp,
				ids.foreignOrganization,
			],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 select gen_random_uuid(), project_id, $2, 'employee', employee_id, $3
			   from unnest($1::uuid[]) as project_id, unnest($4::uuid[]) as employee_id`,
			[
				[ids.project, ids.otherProject, ids.internalProject],
				ids.organization,
				ids.ownerUser,
				[ids.employee, ids.second],
			],
		);
		await admin.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[ids.project, ids.projectManager, ids.ownerUser],
		);
	}

	/**
	 * The mixed range: two periods that change (two employees), one already
	 * billable, one held back (pending submission), one deleted, one outside the
	 * range, one on another project, and one whose employee-local start day
	 * (Berlin, +02:00) falls after the range although its UTC day does not.
	 */
	async function seedMixedRange() {
		// Recorded in time order: live work may not start before recorded work.
		const outsideRange = await record(
			ids.employeeUser,
			ids.employee,
			ids.project,
			"2026-07-01T08:00:00Z",
			"2026-07-01T09:00:00Z",
		);
		const work = {
			outsideRange,
			changes: await record(
				ids.employeeUser,
				ids.employee,
				ids.project,
				"2026-07-06T08:00:00Z",
				"2026-07-06T12:00:00Z",
			),
			alreadyBillable: await record(
				ids.employeeUser,
				ids.employee,
				ids.project,
				"2026-07-07T08:00:00Z",
				"2026-07-07T10:00:00Z",
			),
			heldBack: await record(
				ids.employeeUser,
				ids.employee,
				ids.project,
				"2026-07-08T08:00:00Z",
				"2026-07-08T09:00:00Z",
			),
			deleted: await record(
				ids.employeeUser,
				ids.employee,
				ids.project,
				"2026-07-09T08:00:00Z",
				"2026-07-09T11:00:00Z",
			),
			otherProject: await record(
				ids.employeeUser,
				ids.employee,
				ids.otherProject,
				"2026-07-10T08:00:00Z",
				"2026-07-10T09:00:00Z",
			),
			invoiced: await record(
				ids.employeeUser,
				ids.employee,
				ids.project,
				"2026-07-11T08:00:00Z",
				"2026-07-11T10:00:00Z",
			),
			secondEmployee: await record(
				ids.secondUser,
				ids.second,
				ids.project,
				"2026-07-06T13:00:00Z",
				"2026-07-06T14:30:00Z",
			),
			nextLocalDay: await record(
				ids.secondUser,
				ids.second,
				ids.project,
				"2026-07-12T22:30:00Z",
				"2026-07-12T23:30:00Z",
				"Europe/Berlin",
			),
		};
		actAs(ids.adminUser);
		await expect(updateWorkPeriodBillability(work.alreadyBillable, true)).resolves.toMatchObject({
			success: true,
		});
		await admin.query(
			"update work_period set approval_status = 'pending' where organization_id = $1 and id = $2",
			[ids.organization, work.heldBack],
		);
		await admin.query(
			`update work_period set deleted_at = $3, deletion_reason = 't901 deleted'
			  where organization_id = $1 and id = $2`,
			[ids.organization, work.deleted, new Date("2026-07-20T00:00:00Z")],
		);
		await invoice(work.invoiced);
		return work;
	}

	/** Puts a work period into an invoice draft (#903): it is invoiced work from now on. */
	async function invoice(periodId: string) {
		const { rows } = await admin.query<{ draft_id: string }>(
			`with connection as (
			   insert into accounting_connection
			     (organization_id, provider_kind, status, account_ref, default_tax_treatment, default_tax_rate)
			   values ($1, 'lexware_office', 'active', 't901-account', 'domestic_standard', 19)
			   returning id
			 )
			 insert into invoice_draft
			   (organization_id, connection_id, provider_kind, customer_id, status, idempotency_key, contact_id,
			    contact_name, currency, tax_treatment, tax_rate, period_from, period_to, title, net_total,
			    external_id, confirmed_at)
			 select $1, connection.id, 'lexware_office', $2, 'created', gen_random_uuid()::text, 'c-1',
			        'Acme', 'EUR', 'domestic_standard', 19, '2026-07-01', '2026-07-31', 'Invoice', 200.00,
			        'draft-1', now()
			   from connection
			 returning id as draft_id`,
			[ids.organization, ids.customer],
		);
		await admin.query(
			`insert into invoiced_work
			   (organization_id, invoice_draft_id, work_period_id, employee_id, project_id, started_at, ended_at,
			    start_offset_minutes, duration_minutes, shares)
			 select organization_id, $3, id, employee_id, project_id, start_time, end_time, 0, duration_minutes,
			        '[{"line":0,"durationMs":7200000,"rate":"100.00"}]'::jsonb
			   from work_period where organization_id = $1 and id = $2`,
			[ids.organization, periodId, only(rows).draft_id],
		);
	}

	beforeEach(async () => {
		harness.now = parseInstant("2026-07-20T12:00:00Z");
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it("previews a mixed range and applies exactly the previewed counts", async () => {
			const work = await seedMixedRange();

			actAs(ids.adminUser);
			const preview = expectSuccess(await previewBulkBillability({ ...range, billable: true }));
			const expectedSummary = {
				billable: true,
				change: { count: 2, minutes: 240 + 90 },
				alreadyInTarget: { count: 1, minutes: 120 },
				// Invoiced work is never changed in bulk (#903).
				skipped: { invoiced: { count: 1, minutes: 120 }, held_back: { count: 1, minutes: 60 } },
			};
			expect(preview.summary).toEqual(expectedSummary);

			const applied = expectSuccess(
				await applyBulkBillability({ ...range, billable: true, fingerprint: preview.fingerprint }),
			);
			expect(applied).toEqual({
				status: "applied",
				summary: expectedSummary,
				failed: { count: 0, minutes: 0 },
			});

			await expectBillable(work.changes, true);
			await expectBillable(work.secondEmployee, true);
			await expectBillable(work.alreadyBillable, true);
			await expectBillable(work.heldBack, false);
			await expectBillable(work.deleted, false);
			await expectBillable(work.otherProject, false);
			await expectBillable(work.invoiced, false);
			const { rows: invoicedRows } = await admin.query(
				`select changed_after_invoicing_at, released_at from invoiced_work
				  where organization_id = $1 and work_period_id = $2`,
				[ids.organization, work.invoiced],
			);
			expect(invoicedRows).toEqual([{ changed_after_invoicing_at: null, released_at: null }]);
			await expectBillable(work.outsideRange, false);
			await expectBillable(work.nextLocalDay, false);

			const receipts = await bulkReceipts();
			if (admission === "append") {
				expect(receipts).toEqual(
					[work.changes, work.secondEmployee].sort().map((workPeriodId) => ({
						kind: "amend_completed_work",
						writer: "work_period_attribution_edit",
						actor_user_id: ids.adminUser,
						work_period_id: workPeriodId,
						result: expect.objectContaining({
							authority: "organization_admin",
							changes: expect.objectContaining({ billable: true, project: false }),
						}),
					})),
				);
			} else {
				expect(receipts).toEqual([]);
			}

			// Re-running with the same input changes nothing more.
			const before = await workState();
			const retried = expectSuccess(
				await applyBulkBillability({ ...range, billable: true, fingerprint: preview.fingerprint }),
			);
			if (admission === "append") {
				// The committed receipts replay: the retry reports the same result.
				expect(retried).toEqual(applied);
			} else {
				expect(retried).toMatchObject({
					status: "stale",
					preview: { summary: { change: { count: 0, minutes: 0 } } },
				});
			}
			expect(await workState()).toEqual(before);
			expect(await bulkReceipts()).toHaveLength(receipts.length);

			const again = expectSuccess(await previewBulkBillability({ ...range, billable: true }));
			expect(again.summary).toEqual({
				billable: true,
				change: { count: 0, minutes: 0 },
				alreadyInTarget: { count: 3, minutes: 240 + 90 + 120 },
				skipped: { invoiced: { count: 1, minutes: 120 }, held_back: { count: 1, minutes: 60 } },
			});
		});

		it("refuses to apply a preview the work no longer matches and writes nothing", async () => {
			const work = await seedMixedRange();
			actAs(ids.adminUser);
			const preview = expectSuccess(await previewBulkBillability({ ...range, billable: true }));

			await expect(updateWorkPeriodBillability(work.changes, true)).resolves.toMatchObject({
				success: true,
			});
			const before = await workState();

			const stale = expectSuccess(
				await applyBulkBillability({ ...range, billable: true, fingerprint: preview.fingerprint }),
			);
			expect(stale).toMatchObject({
				status: "stale",
				preview: { summary: { change: { count: 1, minutes: 90 } } },
			});
			expect(await workState()).toEqual(before);
			await expectBillable(work.secondEmployee, false);
		});

		it("marks work non-billable", async () => {
			const work = await seedMixedRange();
			actAs(ids.adminUser);
			const preview = expectSuccess(await previewBulkBillability({ ...range, billable: false }));
			expect(preview.summary).toEqual({
				billable: false,
				change: { count: 1, minutes: 120 },
				// The invoiced work is non-billable already: nothing to change.
				alreadyInTarget: { count: 4, minutes: 240 + 60 + 90 + 120 },
				skipped: { invoiced: { count: 0, minutes: 0 }, held_back: { count: 0, minutes: 0 } },
			});
			const applied = expectSuccess(
				await applyBulkBillability({ ...range, billable: false, fingerprint: preview.fingerprint }),
			);
			expect(applied).toMatchObject({ status: "applied", summary: preview.summary });
			await expectBillable(work.alreadyBillable, false);
		});
	});

	describe("append admission", () => {
		beforeEach(async () => {
			await setAdmission("active");
		});

		it("selects work by the employee-local day of its start", async () => {
			const work = await seedMixedRange();
			actAs(ids.adminUser);
			const preview = expectSuccess(
				await previewBulkBillability({
					projectId: ids.project,
					fromDay: "2026-07-13",
					toDay: "2026-07-13",
					billable: true,
				}),
			);
			expect(preview.summary.change).toEqual({ count: 1, minutes: 60 });
			const applied = expectSuccess(
				await applyBulkBillability({
					projectId: ids.project,
					fromDay: "2026-07-13",
					toDay: "2026-07-13",
					billable: true,
					fingerprint: preview.fingerprint,
				}),
			);
			expect(applied).toMatchObject({ status: "applied" });
			await expectBillable(work.nextLocalDay, true);
		});

		it("lets the organization owner run it", async () => {
			await seedMixedRange();
			actAs(ids.ownerUser);
			const preview = expectSuccess(await previewBulkBillability({ ...range, billable: true }));
			expect(preview.summary.change.count).toBe(2);
		});

		it.each([
			["an employee", ids.employeeUser],
			["the employee's manager", ids.managerUser],
			["the project's project manager", ids.projectManagerUser],
		])("refuses %s and writes nothing", async (_who, userId) => {
			await seedMixedRange();
			actAs(ids.adminUser);
			const preview = expectSuccess(await previewBulkBillability({ ...range, billable: true }));
			const before = await workState();

			actAs(userId);
			await expect(previewBulkBillability({ ...range, billable: true })).resolves.toMatchObject({
				success: false,
			});
			await expect(
				applyBulkBillability({ ...range, billable: true, fingerprint: preview.fingerprint }),
			).resolves.toMatchObject({ success: false });
			expect(await workState()).toEqual(before);
		});

		it("never reaches another organization's project", async () => {
			actAs(ids.adminUser);
			await expect(
				previewBulkBillability({ ...range, projectId: ids.foreignProject, billable: true }),
			).resolves.toMatchObject({ success: false });
		});

		it("refuses billable work on a project without a customer", async () => {
			actAs(ids.adminUser);
			await expect(
				previewBulkBillability({ ...range, projectId: ids.internalProject, billable: true }),
			).resolves.toMatchObject({ success: false });
		});

		it("refuses while Billable Time is switched off", async () => {
			await admin.query("update organization set billable_time_enabled = false where id = $1", [
				ids.organization,
			]);
			actAs(ids.adminUser);
			await expect(previewBulkBillability({ ...range, billable: true })).resolves.toMatchObject({
				success: false,
			});
		});
	});
});
