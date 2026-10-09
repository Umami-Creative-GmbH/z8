/**
 * #903 pass B runtime evidence: correcting invoiced work is never blocked
 * (Billable Time ADR 0002) and marks it as changed after invoicing.
 *
 * The real web clock-in/out, admin time edit, project change, billability
 * change and split actions run against PostgreSQL in both admissions (legacy
 * and adopted append). The work is handed off first through the real hand-off
 * store with the in-memory accounting tool. After each correction the work is
 * still invoiced in the same draft and carries the mark of what changed; the
 * split-off half of invoiced work stays invoiced too, so it is never handed off
 * twice.
 */

import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
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
							user: { id: harness.userId, role: "user", name: "Actor", email: "a@example.test" },
							session: {
								id: `t903b-session-${harness.userId}`,
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
		isOrgAdminCasl: async () => true,
		canApproveFor: async () => true,
		getPrincipalContext: async () =>
			harness.userId && harness.organizationId
				? loadOrganizationPrincipalContext(db, {
						userId: harness.userId,
						organizationId: harness.organizationId,
					})
				: null,
	};
});
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/notifications/triggers", async (importOriginal) =>
	(await import("@/test/integration-harness")).notificationTriggers(importOriginal),
);
vi.mock("./policy-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./policy-helpers")>()),
	getEditCapabilityForPeriod: async () => ({ type: "direct", reason: "no_policy" }),
}));

const { clockIn, clockOut } = await import("./clocking");
const { updateWorkPeriodTimes } = await import("./work-period-time-edit");
const { splitWorkPeriod, updateWorkPeriodBillability, updateWorkPeriodProject } = await import(
	"../actions"
);
const { db } = await import("@/db");
const { createFakeAccountingTool, fakeAccountingProviderRegistry } = await import(
	"@/lib/billable-time/accounting/fake-provider"
);
const { confirmHandOff, previewHandOff } = await import(
	"@/lib/billable-time/hand-off/hand-off-store"
);

const ids = {
	organization: "t903b-corrections-org",
	ownerUser: "t903b-corrections-owner-user",
	owner: "e9031000-0000-4000-8000-000000000001",
	customer: "e9031000-0000-4000-8000-000000000010",
	projectA: "e9031000-0000-4000-8000-000000000021",
	projectB: "e9031000-0000-4000-8000-000000000022",
	connection: "e9031000-0000-4000-8000-000000000031",
} as const;
const now = parseInstant("2026-07-23T18:00:00Z");
const API_KEY = "fake-key-903b";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("correcting invoiced work on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const tool = () =>
		createFakeAccountingTool({
			apiKey: API_KEY,
			contacts: [{ id: "c-1", customerNumber: null, name: "Acme", address: null, vatId: null }],
		});
	let accounting: ReturnType<typeof tool>;

	function actAs() {
		harness.userId = ids.ownerUser;
		harness.organizationId = ids.organization;
	}

	const dependencies = () => ({
		registry: fakeAccountingProviderRegistry(accounting),
		secrets: {
			store: async () => {},
			get: async () => API_KEY,
			delete: async () => {},
		},
	});

	const request = {
		customerId: ids.customer,
		period: {
			from: Temporal.PlainDate.from("2026-07-01"),
			to: Temporal.PlainDate.from("2026-07-31"),
		},
		projectIds: null,
		includeTimesheet: false,
		locale: "en" as const,
	};

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.ownerUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, billable_time_enabled, created_at)
			 values ($1, 'T903b corrections', $1, 'UTC', true, true, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR')`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2),
			        ($1, 'manual_time_submission', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'Owner', $1 || '@example.test', $2, $2)`,
			[ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('m-' || $2, $1, $2, 'owner', 'approved', $3)`,
			[ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, 'admin', $4)`,
			[ids.owner, ids.ownerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)`,
			[ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Acme', $3, $4)`,
			[ids.customer, ids.organization, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, customer_id, billable_default, created_by, updated_at) values
			 ($1, $3, 'Website', 'active', true, $4, true, $5, $6),
			 ($2, $3, 'App', 'active', true, $4, true, $5, $6)`,
			[ids.projectA, ids.projectB, ids.organization, ids.customer, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 select gen_random_uuid(), project_id, $2, 'employee', $3, $4 from unnest($1::uuid[]) as project_id`,
			[[ids.projectA, ids.projectB], ids.organization, ids.owner, ids.ownerUser],
		);
		await admin.query(
			`insert into billable_rate (organization_id, level, customer_id, hourly_rate, effective_from)
			 values ($1, 'customer', $2, 100.00, '2026-01-01')`,
			[ids.organization, ids.customer],
		);
		await admin.query(
			`insert into accounting_connection
			 (id, organization_id, provider_kind, status, account_ref, default_tax_treatment, default_tax_rate, connected_by)
			 values ($1, $2, 'lexware_office', 'active', 'fake-account', 'domestic_standard', 19, $3)`,
			[ids.connection, ids.organization, ids.ownerUser],
		);
		await admin.query(
			`insert into accounting_contact_link
			 (organization_id, customer_id, provider_kind, account_ref, contact_id, contact_name, linked_by)
			 values ($1, $2, 'lexware_office', 'fake-account', 'c-1', 'Acme', $3)`,
			[ids.organization, ids.customer, ids.ownerUser],
		);
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** The owner's real clock-in and clock-out on project A, 08:00–12:00. */
	async function recordWork() {
		actAs();
		await expect(
			clockIn("office", {
				instant: parseInstant("2026-07-22T08:00:00Z"),
				browserTimezone: "UTC",
			}),
		).resolves.toMatchObject({ success: true });
		await expect(
			clockOut(ids.projectA, undefined, {
				submissionId: randomUUID(),
				instant: parseInstant("2026-07-22T12:00:00Z"),
				browserTimezone: "UTC",
			}),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string; is_billable: boolean }>(
			"select id, is_billable from work_period where employee_id = $1 and deleted_at is null",
			[ids.owner],
		);
		const period = only(rows);
		expect(period.is_billable).toBe(true);
		return period.id;
	}

	async function handOff() {
		const outcome = await confirmHandOff(db, dependencies(), {
			organizationId: ids.organization,
			actorUserId: ids.ownerUser,
			request,
			idempotencyKey: randomUUID(),
			expectedFingerprint: null,
		});
		expect(outcome).toMatchObject({ ok: true });
		return outcome.ok ? outcome.draftId : "";
	}

	async function invoiced() {
		const { rows } = await admin.query<{
			work_period_id: string;
			invoice_draft_id: string;
			released_at: Date | null;
			changed_fields: string[];
			carried_from_work_period_id: string | null;
			draft_status: string;
		}>(
			`select iw.work_period_id, iw.invoice_draft_id, iw.released_at, iw.changed_fields,
			        iw.carried_from_work_period_id, d.status as draft_status
			   from invoiced_work iw join invoice_draft d on d.id = iw.invoice_draft_id
			  where iw.organization_id = $1 order by iw.started_at, iw.created_at`,
			[ids.organization],
		);
		return rows;
	}

	beforeEach(async () => {
		harness.now = now;
		accounting = tool();
		await seed();
	});

	afterAll(cleanup);

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (_admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it("lets a time correction, a project change and a billability change through and marks each", async () => {
			const periodId = await recordWork();
			const draftId = await handOff();
			expect(await invoiced()).toEqual([
				expect.objectContaining({ work_period_id: periodId, changed_fields: [] }),
			]);

			actAs();
			const corrected = await updateWorkPeriodTimes({
				workPeriodId: periodId,
				submissionId: randomUUID(),
				clockInDate: "2026-07-22",
				clockInTime: "08:00",
				clockOutDate: "2026-07-22",
				clockOutTime: "11:30",
				reason: "Left earlier than recorded",
			});
			expect(corrected).toMatchObject({ success: true, data: { status: "applied" } });
			expect(await invoiced()).toEqual([
				expect.objectContaining({
					work_period_id: periodId,
					invoice_draft_id: draftId,
					released_at: null,
					changed_fields: ["times"],
					draft_status: "created",
				}),
			]);

			await expect(updateWorkPeriodProject(periodId, ids.projectB)).resolves.toMatchObject({
				success: true,
			});
			expect(only(await invoiced()).changed_fields).toEqual(["project", "times"]);

			await expect(updateWorkPeriodBillability(periodId, false)).resolves.toMatchObject({
				success: true,
			});
			expect(only(await invoiced())).toMatchObject({
				released_at: null,
				changed_fields: ["billability", "project", "times"],
				draft_status: "created",
			});
			expect(accounting.drafts()).toHaveLength(1);
		});

		it("keeps both halves of split invoiced work invoiced, so neither is handed off again", async () => {
			const periodId = await recordWork();
			const draftId = await handOff();

			actAs();
			await expect(
				splitWorkPeriod(periodId, "2026-07-22", "10:00", undefined, undefined, undefined, randomUUID()),
			).resolves.toMatchObject({ success: true });

			const rows = await invoiced();
			expect(rows).toHaveLength(2);
			expect(rows[0]).toMatchObject({
				work_period_id: periodId,
				invoice_draft_id: draftId,
				changed_fields: ["times"],
				carried_from_work_period_id: null,
			});
			expect(rows[1]).toMatchObject({
				invoice_draft_id: draftId,
				changed_fields: ["split"],
				carried_from_work_period_id: periodId,
				released_at: null,
			});
			const next = await previewHandOff(db, dependencies(), {
				organizationId: ids.organization,
				request,
			});
			expect(next.ok && next.preview.alreadyInvoiced).toHaveLength(2);
			expect(next.ok && next.preview.blockers).toEqual([{ kind: "nothing_to_hand_off" }]);
		});
	});
});
