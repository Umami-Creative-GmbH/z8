/**
 * #903 pass B: the hand-off on PostgreSQL. The real server actions, stores,
 * constraints, trigger and audit trail run against a disposable database; the
 * accounting tool is the in-memory fake (registered under Lexware's kind), the
 * organization secret store an in-memory map. Only the request/session, SSO
 * store, billing guard and logger are replaced besides.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeAccountingTool } from "@/lib/billable-time/accounting/fake-provider";
import type { AccountingProviderRegistry } from "@/lib/billable-time/accounting/registry";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	secrets: new Map<string, string>(),
	registry: null as AccountingProviderRegistry | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
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
								id: `t903b-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock(
	"@/lib/organization-mfa/organization-access",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("@/lib/organization-mfa/organization-access")
		>()),
		canAccessOrganization: async () => true,
	}),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/logger", () => {
	const noop = () => {};
	const logger = {
		error: noop,
		warn: noop,
		info: noop,
		debug: noop,
		trace: noop,
		fatal: noop,
	};
	return { createLogger: () => ({ ...logger, child: () => logger }), logger };
});
vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	storeOrgSecret: async (
		organizationId: string,
		key: string,
		value: string,
	) => {
		harness.secrets.set(`${organizationId}|${key}`, value);
	},
	getOrgSecret: async (organizationId: string, key: string) =>
		harness.secrets.get(`${organizationId}|${key}`) ?? null,
	deleteOrgSecret: async (organizationId: string, key: string) => {
		harness.secrets.delete(`${organizationId}|${key}`);
	},
}));
vi.mock("@/lib/billable-time/accounting/registry", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/billable-time/accounting/registry")
	>()),
	getAccountingProviderRegistry: () => {
		if (!harness.registry) throw new Error("No fake registry");
		return harness.registry;
	},
}));

const {
	checkInvoiceDraftStatusAction,
	confirmHandOffAction,
	getHandOffOverview,
	getInvoiceDraftAction,
	previewHandOffAction,
	releaseInvoiceDraftAction,
	resolveChangedAfterInvoicingAction,
	retryHandOffAction,
} = await import("./actions");
const { getProjectDetailedReport } = await import(
	"@/app/[locale]/(app)/reports/projects/actions"
);
const projectSettings = await import(
	"@/app/[locale]/(app)/settings/projects/actions"
);
const customerSettings = await import(
	"@/app/[locale]/(app)/settings/customers/actions"
);
const { createFakeAccountingTool, fakeAccountingProviderRegistry } =
	await import("@/lib/billable-time/accounting/fake-provider");

const ids = {
	organization: "t903b-org",
	otherOrganization: "t903b-other-org",
	ownerUser: "t903b-owner-user",
	adminUser: "t903b-admin-user",
	memberUser: "t903b-member-user",
	otherUser: "t903b-other-user",
	owner: "90310000-0000-4000-8000-000000000001",
	worker: "90310000-0000-4000-8000-000000000002",
	other: "90310000-0000-4000-8000-000000000003",
	acme: "90310000-0000-4000-8000-0000000000c1",
	beta: "90310000-0000-4000-8000-0000000000c2",
	foreignCustomer: "90310000-0000-4000-8000-0000000000c3",
	website: "90310000-0000-4000-8000-0000000000a1",
	app: "90310000-0000-4000-8000-0000000000a2",
	internal: "90310000-0000-4000-8000-0000000000a3",
	unpriced: "90310000-0000-4000-8000-0000000000a4",
	foreignProject: "90310000-0000-4000-8000-0000000000a5",
	connection: "90310000-0000-4000-8000-0000000000f1",
} as const;
const users = [ids.ownerUser, ids.adminUser, ids.memberUser, ids.otherUser];
const API_KEY = "lx-SECRET-903b";

const acmeContact = {
	id: "c-acme",
	customerNumber: "10001",
	name: "Acme GmbH",
	address: null,
	vatId: null,
};

function actAs(userId: string, organizationId: string = ids.organization) {
	harness.userId = userId;
	harness.organizationId = organizationId;
}

async function unwrap<T>(
	result: Promise<
		{ success: true; data: T } | { success: false; error: string }
	>,
): Promise<T> {
	const settled = await result;
	if (!settled.success) throw new Error(settled.error);
	return settled.data;
}

const september = {
	customerId: ids.acme,
	periodFrom: "2026-09-01",
	periodTo: "2026-09-30",
	projectIds: null,
	includeTimesheet: false,
	locale: "en",
};

describe("hand-off on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let tool: FakeAccountingTool;
	const work: Record<string, string> = {};

	async function cleanup() {
		for (const organizationId of [ids.organization, ids.otherOrganization]) {
			await admin.query(
				"delete from approval_request where organization_id = $1",
				[organizationId],
			);
			await admin.query(
				"delete from invoiced_work where organization_id = $1",
				[organizationId],
			);
			await admin.query("delete from work_period where organization_id = $1", [
				organizationId,
			]);
			await admin.query("delete from time_entry where organization_id = $1", [
				organizationId,
			]);
		}
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function addWork(options: {
		projectId: string;
		start: string;
		end?: string;
		minutes?: number;
		billable?: boolean;
		deleted?: boolean;
		pending?: boolean;
		employeeId?: string;
		organizationId?: string;
		/** The UTC offset both entries record (default 0). */
		offsetMinutes?: number;
	}) {
		const organizationId = options.organizationId ?? ids.organization;
		const employeeId = options.employeeId ?? ids.worker;
		const clockInId = randomUUID();
		const clockOutId = options.end ? randomUUID() : null;
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", options.start],
			...(clockOutId ? [[clockOutId, "clock_out", options.end]] : []),
		]) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, $8, 'Etc/UTC', 'user_setting', $6, $7)`,
				[
					entryId,
					employeeId,
					organizationId,
					type,
					timestamp,
					`hash-${entryId}`,
					ids.ownerUser,
					options.offsetMinutes ?? 0,
				],
			);
		}
		const id = randomUUID();
		await withCanonicalRecords(admin, (client) =>
			client.query(
				`insert into work_period
				 (id, employee_id, organization_id, clock_in_id, clock_out_id, project_id, is_billable, start_time,
				  end_time, duration_minutes, is_active, approval_status, deleted_at, deleted_by, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())`,
				[
					id,
					employeeId,
					organizationId,
					clockInId,
					clockOutId,
					options.projectId,
					options.billable ?? true,
					options.start,
					options.end ?? null,
					options.minutes ?? null,
					!options.end,
					options.pending ? "pending" : "approved",
					options.deleted ? "2026-09-20T00:00:00Z" : null,
					options.deleted ? ids.ownerUser : null,
				],
			),
		);
		return id;
	}

	async function drafts() {
		const { rows } = await admin.query<{
			id: string;
			status: string;
			external_id: string | null;
			net_total: string;
			outcome_unknown: boolean;
			attempt_count: number;
		}>(
			`select id, status, external_id, net_total, outcome_unknown, attempt_count
			 from invoice_draft where organization_id = $1 order by created_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function invoiced() {
		const { rows } = await admin.query<{
			work_period_id: string;
			invoice_draft_id: string;
			released_at: Date | null;
			changed_fields: string[];
			changed_after_invoicing_at: Date | null;
		}>(
			`select work_period_id, invoice_draft_id, released_at, changed_fields, changed_after_invoicing_at
			 from invoiced_work where organization_id = $1 order by started_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function auditActions() {
		const { rows } = await admin.query<{
			action: string;
			entity_type: string;
			changes: string;
		}>(
			`select action, entity_type, changes from audit_log
			 where organization_id = $1 and action like 'billable_time.invoice%' order by timestamp, id`,
			[ids.organization],
		);
		return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
	}

	async function waitForRowLockWaiter() {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query<{ waiting: number }>(
				"select count(*)::int as waiting from pg_locks where not granted",
			);
			if ((rows[0]?.waiting ?? 0) > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error("Nothing waited for the parked transaction");
	}

	async function preview(input: Partial<typeof september> = {}) {
		return unwrap(previewHandOffAction({ ...september, ...input }));
	}

	async function confirm(
		input: Partial<typeof september> & {
			idempotencyKey?: string;
			fingerprint?: string;
		} = {},
	) {
		const shown = await preview(input);
		return confirmHandOffAction({
			...september,
			...input,
			idempotencyKey: input.idempotencyKey ?? randomUUID(),
			fingerprint: input.fingerprint ?? shown.fingerprint,
		});
	}

	beforeEach(async () => {
		await cleanup();
		harness.secrets.clear();
		tool = createFakeAccountingTool({
			apiKey: API_KEY,
			contacts: [acmeContact],
		});
		harness.registry = fakeAccountingProviderRegistry(tool);

		await admin.query(
			`insert into organization (id, name, slug, timezone, projects_enabled, billable_time_enabled, created_at)
			 values ($1, 'T903b', $1, 'UTC', true, true, now()), ($2, 'T903b other', $2, 'UTC', true, true, now())`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'EUR')`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t903b-m-owner', $1, $2, 'owner', 'approved', now()),
			 ('t903b-m-admin', $1, $3, 'admin', 'approved', now()),
			 ('t903b-m-member', $1, $4, 'member', 'approved', now()),
			 ('t903b-m-other', $5, $6, 'owner', 'approved', now())`,
			[
				ids.organization,
				ids.ownerUser,
				ids.adminUser,
				ids.memberUser,
				ids.otherOrganization,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'admin', now()), ($3, $4, $7, 'employee', now()), ($5, $6, $8, 'admin', now())`,
			[
				ids.owner,
				ids.ownerUser,
				ids.worker,
				ids.memberUser,
				ids.other,
				ids.otherUser,
				ids.organization,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $4, 'Acme', $5, now()), ($2, $4, 'Beta', $5, now()), ($3, $6, 'Foreign', $7, now())`,
			[
				ids.acme,
				ids.beta,
				ids.foreignCustomer,
				ids.organization,
				ids.ownerUser,
				ids.otherOrganization,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, customer_id, billable_default, created_by, updated_at) values
			 ($1, $6, 'Website', 'active', $7, true, $8, now()),
			 ($2, $6, 'App', 'active', $7, true, $8, now()),
			 ($3, $6, 'Internal', 'active', null, false, $8, now()),
			 ($4, $6, 'Unpriced', 'active', $7, true, $8, now()),
			 ($5, $9, 'Foreign', 'active', $10, true, $11, now())`,
			[
				ids.website,
				ids.app,
				ids.internal,
				ids.unpriced,
				ids.foreignProject,
				ids.organization,
				ids.acme,
				ids.ownerUser,
				ids.otherOrganization,
				ids.foreignCustomer,
				ids.otherUser,
			],
		);
		await admin.query(
			`insert into billable_rate (organization_id, level, project_id, hourly_rate, effective_from) values
			 ($1, 'project', $2, 100.00, '2026-01-01'), ($1, 'project', $3, 85.50, '2026-01-01')`,
			[ids.organization, ids.website, ids.app],
		);
		await admin.query(
			`insert into accounting_connection
			 (id, organization_id, provider_kind, status, account_ref, account_label, default_tax_treatment, default_tax_rate, connected_by)
			 values ($1, $2, 'lexware_office', 'active', 'fake-account', 'Fake tool', 'domestic_standard', 19, $3)`,
			[ids.connection, ids.organization, ids.ownerUser],
		);
		harness.secrets.set(
			`${ids.organization}|accounting/${ids.connection}/api_key`,
			API_KEY,
		);
		await admin.query(
			`insert into accounting_contact_link
			 (organization_id, customer_id, provider_kind, account_ref, contact_id, contact_name, contact_number, linked_by)
			 values ($1, $2, 'lexware_office', 'fake-account', 'c-acme', 'Acme GmbH', '10001', $3)`,
			[ids.organization, ids.acme, ids.ownerUser],
		);

		work.website = await addWork({
			projectId: ids.website,
			start: "2026-09-02T08:00:00Z",
			end: "2026-09-02T09:30:00Z",
			minutes: 90,
		});
		work.app = await addWork({
			projectId: ids.app,
			start: "2026-09-03T08:00:00Z",
			end: "2026-09-03T09:01:00Z",
			minutes: 61,
		});
		work.held = await addWork({
			projectId: ids.website,
			start: "2026-09-04T08:00:00Z",
			end: "2026-09-04T09:00:00Z",
			minutes: 60,
			pending: true,
		});
		work.deleted = await addWork({
			projectId: ids.website,
			start: "2026-09-05T08:00:00Z",
			end: "2026-09-05T09:00:00Z",
			minutes: 60,
			deleted: true,
		});
		work.live = await addWork({
			projectId: ids.website,
			start: "2026-09-29T08:00:00Z",
		});
		work.nonBillable = await addWork({
			projectId: ids.website,
			start: "2026-09-06T08:00:00Z",
			end: "2026-09-06T08:45:00Z",
			minutes: 45,
			billable: false,
		});
		work.withoutCustomer = await addWork({
			projectId: ids.internal,
			start: "2026-09-07T08:00:00Z",
			end: "2026-09-07T08:30:00Z",
			minutes: 30,
		});
		work.october = await addWork({
			projectId: ids.website,
			start: "2026-10-01T08:00:00Z",
			end: "2026-10-01T09:00:00Z",
			minutes: 60,
		});
		work.foreign = await addWork({
			organizationId: ids.otherOrganization,
			employeeId: ids.other,
			projectId: ids.foreignProject,
			start: "2026-09-02T08:00:00Z",
			end: "2026-09-02T18:00:00Z",
			minutes: 600,
		});
		actAs(ids.adminUser);
	});

	afterAll(cleanup);

	it("previews lines per project and rate, and confirm creates exactly one draft that sums to it", async () => {
		const shown = await preview();

		expect(shown.blockers).toEqual([]);
		expect(shown.lines).toEqual([
			{
				position: 0,
				kind: "work",
				projectId: ids.app,
				projectName: "App",
				text: "App, 2026-09-01 – 2026-09-30: 1.02 h",
				hours: "1.02",
				rate: "85.50",
				amount: "87.21",
			},
			{
				position: 1,
				kind: "work",
				projectId: ids.website,
				projectName: "Website",
				text: "Website, 2026-09-01 – 2026-09-30: 1.50 h",
				hours: "1.50",
				rate: "100.00",
				amount: "150.00",
			},
		]);
		expect(shown.netTotal).toBe("237.21");
		expect(shown.included.map((item) => item.workPeriodId)).toEqual([
			work.website,
			work.app,
		]);
		expect(shown.heldBack.map((item) => item.workPeriodId)).toEqual([
			work.held,
		]);
		expect(shown.nonBillable).toEqual({ count: 1, hours: "0.75" });
		expect(shown.withoutCustomer).toEqual({
			count: 1,
			hours: "0.50",
			projects: ["Internal"],
		});
		expect(shown.contact).toMatchObject({ contactId: "c-acme" });
		expect(shown.taxTreatment).toMatchObject({
			kind: "domestic_standard",
			rate: "19.00",
		});

		const confirmed = await unwrap(
			confirmHandOffAction({
				...september,
				idempotencyKey: randomUUID(),
				fingerprint: shown.fingerprint,
			}),
		);

		expect(tool.drafts()).toHaveLength(1);
		const [created] = tool.drafts();
		expect(created?.draft.contactId).toBe("c-acme");
		const toolTotal = created?.draft.lines.reduce(
			(sum, line) => sum + (line.kind === "work" ? line.amount : BigInt(0)),
			BigInt(0),
		);
		expect(toolTotal).toBe(BigInt(23_721));
		expect(await drafts()).toEqual([
			expect.objectContaining({
				id: confirmed.draftId,
				status: "created",
				external_id: "fake-draft-1",
				net_total: "237.21",
			}),
		]);
		// Held-back, deleted, live, non-billable, customerless and out-of-period work never lands in it.
		expect((await invoiced()).map((row) => row.work_period_id)).toEqual([
			work.website,
			work.app,
		]);
		const audit = await auditActions();
		expect(audit).toEqual([
			expect.objectContaining({
				action: "billable_time.invoice_draft_started",
				entity_type: "invoice_draft",
				changes: expect.objectContaining({ netTotal: "237.21", workCount: 2 }),
			}),
			expect.objectContaining({
				action: "billable_time.invoice_draft_created",
				entity_type: "invoice_draft",
				changes: expect.objectContaining({ netTotal: "237.21", workCount: 2 }),
			}),
		]);
		// No key or secret in the audit trail.
		expect(JSON.stringify(audit)).not.toContain(API_KEY);
		expect(JSON.stringify(audit)).not.toMatch(/idempotency/i);

		const again = await preview();
		expect(again.alreadyInvoiced.map((item) => item.workPeriodId)).toEqual([
			work.website,
			work.app,
		]);
		expect(again.blockers).toEqual([{ kind: "nothing_to_hand_off" }]);
	});

	it("blocks confirmation while billable work is unpriced, with a clear message", async () => {
		const unpriced = await addWork({
			projectId: ids.unpriced,
			start: "2026-09-08T08:00:00Z",
			end: "2026-09-08T09:00:00Z",
			minutes: 60,
		});

		const shown = await preview();
		expect(shown.unpriced.map((item) => item.workPeriodId)).toEqual([unpriced]);
		expect(shown.blockers).toEqual([{ kind: "unpriced_work", count: 1 }]);

		await expect(confirm()).resolves.toEqual({
			success: false,
			error:
				"1 work periods have no billable rate. Add a rate for them before handing off",
			code: "ValidationError",
		});
		expect(tool.createCalls()).toBe(0);
		expect(await drafts()).toEqual([]);
		expect(await invoiced()).toEqual([]);

		// Handing off only the priced projects works.
		await expect(
			confirm({ projectIds: [ids.website, ids.app] }),
		).resolves.toMatchObject({
			success: true,
		});
	});

	it("retries after a timeout into one draft and one set of invoiced work", async () => {
		const key = randomUUID();
		tool.simulateTimeout();

		const first = await unwrap(confirm({ idempotencyKey: key }));
		expect(tool.drafts()).toHaveLength(1);
		const [pending] = await drafts();
		expect(first).toEqual({
			draftId: pending?.id,
			status: "pending",
			replayed: false,
			pendingReason: "outcome_unknown",
		});
		expect(pending).toMatchObject({
			status: "pending",
			outcome_unknown: true,
			attempt_count: 1,
		});
		// The work is reserved: another hand-off cannot take it meanwhile.
		expect((await preview()).alreadyInvoiced).toHaveLength(2);

		const retried = await unwrap(
			retryHandOffAction({ draftId: pending?.id ?? "" }),
		);
		expect(retried).toEqual({
			draftId: pending?.id,
			status: "created",
			replayed: false,
			pendingReason: null,
		});
		const replayed = await unwrap(
			confirmHandOffAction({
				...september,
				idempotencyKey: key,
				fingerprint: "stale",
			}),
		);
		expect(replayed).toMatchObject({
			draftId: pending?.id,
			status: "created",
			replayed: true,
		});

		expect(tool.drafts()).toHaveLength(1);
		expect(await drafts()).toEqual([
			expect.objectContaining({
				status: "created",
				external_id: "fake-draft-1",
				attempt_count: 2,
			}),
		]);
		expect(await invoiced()).toHaveLength(2);
	});

	it("lets one call per draft reach the tool: a concurrent retry or same-key confirm is told it is in progress", async () => {
		const key = randomUUID();
		const held = tool.holdNextCreate();
		const first = confirm({ idempotencyKey: key });
		await held.reached;
		const [pending] = await drafts();

		await expect(
			retryHandOffAction({ draftId: pending?.id ?? "" }),
		).resolves.toMatchObject({
			success: false,
			code: "ConflictError",
			error: expect.stringContaining("is being sent to the accounting tool"),
		});
		await expect(
			confirmHandOffAction({
				...september,
				idempotencyKey: key,
				fingerprint: "stale",
			}),
		).resolves.toMatchObject({ success: false, code: "ConflictError" });
		expect(tool.createCalls()).toBe(1);

		held.release();
		await expect(unwrap(first)).resolves.toMatchObject({ status: "created" });
		expect(tool.createCalls()).toBe(1);
		expect(tool.drafts()).toHaveLength(1);
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "created", attempt_count: 1 }),
		]);
	});

	it("takes over a call whose claim ran out, and treats its outcome as unknown", async () => {
		const held = tool.holdNextCreate();
		const first = confirm();
		await held.reached;
		await admin.query(
			"update invoice_draft set call_claimed_until = now() - interval '1 second' where organization_id = $1",
			[ids.organization],
		);
		tool.failNext("createInvoiceDraft", "rejected");

		const [pending] = await drafts();
		// The first call may still create the draft: a refusal now must not fail it.
		await expect(
			unwrap(retryHandOffAction({ draftId: pending?.id ?? "" })),
		).resolves.toMatchObject({ status: "pending" });
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "pending", outcome_unknown: true }),
		]);
		expect((await invoiced()).every((row) => row.released_at === null)).toBe(
			true,
		);

		held.release();
		await expect(unwrap(first)).resolves.toMatchObject({ status: "created" });
		expect(tool.drafts()).toHaveLength(1);
	});

	it("never fails a draft once a call may have created it, also when recording the creation failed", async () => {
		await admin.query(
			`create or replace function trf_refuse_created() returns trigger language plpgsql as $$
			 begin if new.status = 'created' then raise exception 'simulated crash'; end if; return new; end $$`,
		);
		await admin.query(
			"create trigger trf_refuse_created before update on invoice_draft for each row execute function trf_refuse_created()",
		);
		try {
			await expect(confirm()).resolves.toMatchObject({ success: false });
		} finally {
			await admin.query(
				"drop trigger if exists trf_refuse_created on invoice_draft",
			);
			await admin.query("drop function if exists trf_refuse_created()");
		}
		expect(tool.drafts()).toHaveLength(1);
		const [pending] = await drafts();
		expect(pending).toMatchObject({ status: "pending" });

		tool.failNext("createInvoiceDraft", "rejected");
		await expect(
			unwrap(retryHandOffAction({ draftId: pending?.id ?? "" })),
		).resolves.toMatchObject({ status: "pending" });
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "pending", outcome_unknown: true }),
		]);
		expect((await invoiced()).every((row) => row.released_at === null)).toBe(
			true,
		);

		// The next retry finds the draft the first call created.
		await expect(
			unwrap(retryHandOffAction({ draftId: pending?.id ?? "" })),
		).resolves.toMatchObject({ status: "created" });
		expect(tool.drafts()).toHaveLength(1);
	});

	it("refuses a confirm without the preview's fingerprint", async () => {
		await expect(
			confirmHandOffAction({
				...september,
				idempotencyKey: randomUUID(),
				fingerprint: "",
			}),
		).resolves.toMatchObject({
			success: false,
			error: "Preview the hand-off before confirming it",
		});
		expect(tool.createCalls()).toBe(0);
		expect(await drafts()).toEqual([]);
	});

	it("says a pending draft no longer fits the tool instead of blaming the connection", async () => {
		tool.simulateTimeout();
		const first = await unwrap(confirm());
		tool = createFakeAccountingTool({
			apiKey: API_KEY,
			contacts: [acmeContact],
			capabilities: { maxDraftLines: 1 },
		});
		harness.registry = fakeAccountingProviderRegistry(tool);

		await expect(
			retryHandOffAction({ draftId: first.draftId }),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error:
				"The accounting tool no longer takes this draft (2 lines; it takes at most 1). Release it and hand off again",
		});
		expect(tool.createCalls()).toBe(0);
	});

	it("fails a refused draft and returns its work", async () => {
		tool.failNext("createInvoiceDraft", "rejected");

		const refused = await confirm();
		expect(refused).toMatchObject({ success: false, code: "ValidationError" });
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "failed" }),
		]);
		expect((await invoiced()).every((row) => row.released_at !== null)).toBe(
			true,
		);
		expect((await preview()).included).toHaveLength(2);
		expect((await auditActions()).map((row) => row.action)).toEqual([
			"billable_time.invoice_draft_started",
			"billable_time.invoice_draft_failed",
		]);
	});

	it("refuses a confirm whose preview is outdated", async () => {
		const shown = await preview();
		await admin.query(
			"update work_period set duration_minutes = 80 where id = $1",
			[work.website],
		);

		await expect(
			confirmHandOffAction({
				...september,
				idempotencyKey: randomUUID(),
				fingerprint: shown.fingerprint,
			}),
		).resolves.toMatchObject({ success: false, code: "ConflictError" });
		expect(tool.createCalls()).toBe(0);
	});

	it("suggests a release for a draft gone from the tool, and a release makes the work available again", async () => {
		const { draftId } = await unwrap(confirm());
		const [created] = tool.drafts();
		tool.deleteDraft(created?.externalId ?? "");

		await expect(
			unwrap(checkInvoiceDraftStatusAction({ draftId })),
		).resolves.toEqual({
			kind: "gone",
		});
		// Never released automatically.
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "created" }),
		]);

		await expect(
			unwrap(
				releaseInvoiceDraftAction({ draftId, reason: "Deleted in Lexware" }),
			),
		).resolves.toEqual({ workReturned: 2 });
		expect((await auditActions()).at(-1)).toMatchObject({
			action: "billable_time.invoice_draft_released",
			changes: {
				workReturned: 2,
				reason: "Deleted in Lexware",
				toolStatus: "gone",
			},
		});
		expect((await preview()).included).toHaveLength(2);
		await expect(confirm()).resolves.toMatchObject({ success: true });
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "released" }),
			expect.objectContaining({
				status: "created",
				external_id: "fake-draft-2",
			}),
		]);
	});

	it("adds the timesheet as text lines and provides it for download", async () => {
		const { draftId } = await unwrap(confirm({ includeTimesheet: true }));

		const texts = tool
			.drafts()[0]
			?.draft.lines.flatMap((line) =>
				line.kind === "text" ? [line.text] : [],
			);
		expect(texts).toEqual([
			"Timesheet",
			"2026-09-02 · t903b-member-user · Website · 1.50 h",
			"2026-09-03 · t903b-member-user · App · 1.02 h",
		]);
		const detail = await unwrap(getInvoiceDraftAction({ draftId }));
		expect(detail.timesheet).toEqual([
			{
				day: "2026-09-02",
				employeeName: "t903b-member-user",
				projectName: "Website",
				start: "08:00",
				end: "09:30",
				hours: "1.50",
			},
			{
				day: "2026-09-03",
				employeeName: "t903b-member-user",
				projectName: "App",
				start: "08:00",
				end: "09:01",
				hours: "1.02",
			},
		]);
		expect(detail.lines.filter((line) => line.kind === "text")).toHaveLength(3);
	});

	it("marks invoiced work changed by any write and lets an admin resolve the mark, audited", async () => {
		const { draftId } = await unwrap(confirm());

		// Writes that do not touch times, project or billability leave no mark.
		await admin.query(
			"update work_period set work_location_type = 'home' where id = $1",
			[work.website],
		);
		expect(
			(await invoiced()).every(
				(row) => row.changed_after_invoicing_at === null,
			),
		).toBe(true);

		await admin.query(
			"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1",
			[work.website],
		);
		await admin.query(
			"update work_period set is_billable = false where id = $1",
			[work.app],
		);
		const marked = await invoiced();
		expect(marked.map((row) => row.changed_fields)).toEqual([
			["times"],
			["billability"],
		]);

		const overview = await unwrap(getHandOffOverview());
		expect(
			overview.changedAfterInvoicing.map((row) => row.workPeriodId),
		).toEqual([work.website, work.app]);
		const detail = await unwrap(getInvoiceDraftAction({ draftId }));
		expect(detail.changedCount).toBe(2);

		const [first] = overview.changedAfterInvoicing;
		await expect(
			unwrap(
				resolveChangedAfterInvoicingAction({
					items: [
						{
							invoicedWorkId: first?.invoicedWorkId ?? "",
							markVersion: first?.markVersion ?? "",
						},
					],
					explanation: "Credit note for the extra quarter hour",
				}),
			),
		).resolves.toEqual({ status: "resolved", resolved: 1 });
		expect((await invoiced()).map((row) => row.changed_fields)).toEqual([
			[],
			["billability"],
		]);
		const { rows } = await admin.query<{ entity_id: string; changes: string }>(
			`select entity_id, changes from audit_log where organization_id = $1
			 and action = 'billable_time.invoiced_work_mark_resolved'`,
			[ids.organization],
		);
		expect(rows).toEqual([
			{ entity_id: work.website, changes: expect.stringContaining('"times"') },
		]);
	});

	it("marks invoiced work with customer when any project writer moves its project to another customer or none (#1500)", async () => {
		const { draftId } = await unwrap(confirm());
		const fields = async () =>
			Object.fromEntries(
				(await invoiced()).map((row) => [
					row.work_period_id,
					row.changed_after_invoicing_at === null ? null : row.changed_fields,
				]),
			);
		actAs(ids.ownerUser);

		// The project settings edit: never refused because its work is invoiced.
		await unwrap(
			projectSettings.updateProject(ids.website, { customerId: ids.beta }),
		);
		expect(await fields()).toEqual({
			[work.website]: ["customer"],
			[work.app]: null,
		});

		// Setting it back to the draft's customer keeps the mark.
		await unwrap(
			projectSettings.updateProject(ids.website, { customerId: ids.acme }),
		);
		expect(await fields()).toEqual({
			[work.website]: ["customer"],
			[work.app]: null,
		});

		// A customer created for a project moves the project to it.
		await unwrap(
			customerSettings.createCustomer({
				organizationId: ids.organization,
				name: "Gamma",
				projectId: ids.app,
			}),
		);
		expect(await fields()).toEqual({
			[work.website]: ["customer"],
			[work.app]: ["customer"],
		});

		// Deactivating a customer changes no project's customer: nothing is marked.
		await admin.query(
			"update invoiced_work set changed_fields = '{}', changed_after_invoicing_at = null where organization_id = $1",
			[ids.organization],
		);
		await unwrap(customerSettings.deleteCustomer(ids.acme));
		expect(await fields()).toEqual({
			[work.website]: null,
			[work.app]: null,
		});

		// Removing the project's customer marks it the same way.
		await unwrap(
			projectSettings.updateProject(ids.website, { customerId: null }),
		);
		expect(await fields()).toEqual({
			[work.website]: ["customer"],
			[work.app]: null,
		});

		// The known-field filter keeps it for the marked-work views.
		actAs(ids.adminUser);
		const overview = await unwrap(getHandOffOverview());
		expect(
			overview.changedAfterInvoicing.map((row) => [
				row.workPeriodId,
				row.changedFields,
			]),
		).toEqual([[work.website, ["customer"]]]);
		const detail = await unwrap(getInvoiceDraftAction({ draftId }));
		expect(
			detail.work.find((row) => row.workPeriodId === work.website)
				?.changedFields,
		).toEqual(["customer"]);
	});

	it("holds the included projects' customers while it reserves their work, so a customer change is never missed (#1500)", async () => {
		const shown = await preview({ projectIds: [ids.website] });
		const moving = await admin.connect();
		try {
			await moving.query("begin");
			await moving.query("update project set customer_id = $1 where id = $2", [
				ids.beta,
				ids.website,
			]);
			const confirming = confirmHandOffAction({
				...september,
				projectIds: [ids.website],
				idempotencyKey: randomUUID(),
				fingerprint: shown.fingerprint,
			});
			await waitForRowLockWaiter();
			await moving.query("commit");

			await expect(confirming).resolves.toMatchObject({
				success: false,
				error:
					"The work changed since the preview. Review the new preview before handing off",
			});
		} finally {
			await moving.query("rollback").catch(() => undefined);
			moving.release();
		}
		expect(await invoiced()).toEqual([]);
	});

	describe("resolving changed-after-invoicing marks (#1499)", () => {
		async function markedItems() {
			return (await unwrap(getHandOffOverview())).changedAfterInvoicing;
		}

		function itemOf(
			items: Awaited<ReturnType<typeof markedItems>>,
			workPeriodId: string,
		) {
			const found = items.find((item) => item.workPeriodId === workPeriodId);
			if (!found) throw new Error(`No marked item for ${workPeriodId}`);
			return {
				invoicedWorkId: found.invoicedWorkId,
				markVersion: found.markVersion,
			};
		}

		async function resolutions() {
			const { rows } = await admin.query<{
				invoiced_work_id: string;
				invoice_draft_id: string;
				resolved_by: string | null;
				resolved_at: Date;
				explanation: string;
				accounting_reference: string | null;
				resolved_fields: string[];
				snapshot: {
					pieces: {
						workPeriodId: string;
						removed: boolean;
						startedAt: string;
						endedAt: string | null;
						startOffsetMinutes: number | null;
						durationMinutes: number | null;
						projectName: string | null;
						customerName: string | null;
						billable: boolean;
					}[];
				};
			}>(
				`select invoiced_work_id, invoice_draft_id, resolved_by, resolved_at, explanation,
				 accounting_reference, resolved_fields, snapshot
				 from invoiced_work_resolution where organization_id = $1 order by resolved_at, id`,
				[ids.organization],
			);
			return rows;
		}

		async function frozen() {
			const { rows } = await admin.query(
				`select d.net_total, d.status,
				 (select json_agg(l order by l.position) from invoice_draft_line l where l.invoice_draft_id = d.id) as lines,
				 (select json_agg(json_build_array(w.id, w.work_period_id, w.project_id, w.started_at, w.ended_at,
				   w.start_offset_minutes, w.duration_minutes, w.shares, w.carried_from_work_period_id, w.released_at)
				   order by w.id) from invoiced_work w where w.invoice_draft_id = d.id) as work
				 from invoice_draft d where d.organization_id = $1 order by d.id`,
				[ids.organization],
			);
			return rows;
		}

		async function waitForLockWaiters(count: number) {
			for (let attempt = 0; attempt < 200; attempt += 1) {
				const { rows } = await admin.query<{ waiting: number }>(
					"select count(*)::int as waiting from pg_locks where not granted",
				);
				if ((rows[0]?.waiting ?? 0) >= count) return;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(`Expected ${count} lock waiters`);
		}

		it("records one resolution per item with actor, explanation, reference, fields and the reviewed values, audited", async () => {
			await unwrap(confirm());
			const before = await frozen();
			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1",
				[work.website],
			);
			await admin.query(
				"update work_period set project_id = $2 where id = $1",
				[work.app, ids.website],
			);
			const items = await markedItems();

			await expect(
				unwrap(
					resolveChangedAfterInvoicingAction({
						items: [itemOf(items, work.website), itemOf(items, work.app)],
						explanation: "  Credit note CN-7 covers both  ",
						accountingReference: "CN-7",
					}),
				),
			).resolves.toEqual({ status: "resolved", resolved: 2 });

			const recorded = await resolutions();
			expect(recorded).toEqual([
				expect.objectContaining({
					resolved_by: ids.adminUser,
					explanation: "Credit note CN-7 covers both",
					accounting_reference: "CN-7",
				}),
				expect.objectContaining({
					resolved_by: ids.adminUser,
					explanation: "Credit note CN-7 covers both",
					accounting_reference: "CN-7",
				}),
			]);
			const byPeriod = new Map(
				recorded.map((row) => [row.snapshot.pieces[0]?.workPeriodId, row]),
			);
			expect(byPeriod.get(work.website)).toMatchObject({
				resolved_fields: ["times"],
				snapshot: {
					pieces: [
						{
							workPeriodId: work.website,
							removed: false,
							startedAt: "2026-09-02T08:00:00.000Z",
							endedAt: "2026-09-02T09:45:00.000Z",
							startOffsetMinutes: 0,
							durationMinutes: 105,
							projectName: "Website",
							customerName: "Acme",
							billable: true,
						},
					],
				},
			});
			expect(byPeriod.get(work.app)).toMatchObject({
				resolved_fields: ["project"],
				snapshot: { pieces: [{ projectName: "Website" }] },
			});

			const { rows: audits } = await admin.query<{ changes: string }>(
				`select changes from audit_log where organization_id = $1
				 and action = 'billable_time.invoiced_work_mark_resolved' order by entity_id`,
				[ids.organization],
			);
			expect(audits).toHaveLength(2);
			expect(JSON.parse(audits[0]?.changes ?? "{}")).toMatchObject({
				explanation: "Credit note CN-7 covers both",
				accountingReference: "CN-7",
			});

			expect(await markedItems()).toEqual([]);
			expect(await frozen()).toEqual(before);
		});

		it("marks a resolved item again on a further correction, with only the new fields", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set duration_minutes = 80 where id = $1",
				[work.website],
			);
			await unwrap(
				resolveChangedAfterInvoicingAction({
					items: [itemOf(await markedItems(), work.website)],
					explanation: "Handled",
				}),
			);

			await admin.query(
				"update work_period set is_billable = false where id = $1",
				[work.website],
			);
			const [again] = await markedItems();
			expect(again).toMatchObject({
				workPeriodId: work.website,
				changedFields: ["billability"],
				history: [
					expect.objectContaining({
						kind: "resolution",
						explanation: "Handled",
						actorName: ids.adminUser,
						resolvedFields: ["times"],
					}),
				],
			});
		});

		it("refuses a missing or over-long explanation and an over-long reference, resolving nothing", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set duration_minutes = 80 where id = $1",
				[work.website],
			);
			const item = itemOf(await markedItems(), work.website);

			for (const [input, refusal] of [
				[{ explanation: "   " }, "explanation.required"],
				[{ explanation: "x".repeat(2001) }, "explanation.too_long"],
				[
					{ explanation: "ok", accountingReference: "R".repeat(201) },
					"accountingReference.too_long",
				],
			] as const) {
				await expect(
					resolveChangedAfterInvoicingAction({ items: [item], ...input }),
				).resolves.toMatchObject({
					success: false,
					code: "ValidationError",
					refusal,
				});
			}
			expect(await resolutions()).toEqual([]);
		});

		it("refuses the whole batch when a correction landed after loading, naming the changed item", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set duration_minutes = 80 where id = $1",
				[work.website],
			);
			await admin.query(
				"update work_period set is_billable = false where id = $1",
				[work.app],
			);
			const items = await markedItems();
			await admin.query(
				"update work_period set duration_minutes = 85 where id = $1",
				[work.website],
			);

			const website = itemOf(items, work.website);
			await expect(
				unwrap(
					resolveChangedAfterInvoicingAction({
						items: [website, itemOf(items, work.app)],
						explanation: "Handled",
					}),
				),
			).resolves.toEqual({
				status: "stale",
				invoicedWorkIds: [website.invoicedWorkId],
			});
			expect(await resolutions()).toEqual([]);
			expect((await invoiced()).map((row) => row.changed_fields)).toEqual([
				["times"],
				["billability"],
			]);
		});

		it("refuses the batch when the project's customer changed after loading, even when already marked with customer (#1500)", async () => {
			await unwrap(confirm());
			await admin.query("update project set customer_id = $1 where id = $2", [
				ids.beta,
				ids.website,
			]);
			await admin.query(
				"update work_period set is_billable = false where id = $1",
				[work.app],
			);
			const items = await markedItems();
			const markVersion = async () => {
				const { rows } = await admin.query<{ mark_version: number }>(
					"select mark_version from invoiced_work where organization_id = $1 and work_period_id = $2",
					[ids.organization, work.website],
				);
				return rows[0]?.mark_version;
			};
			const loaded = await markVersion();
			// Moving it back to the draft's customer keeps the mark and writes the row
			// again, although its fields stay the same.
			await admin.query("update project set customer_id = $1 where id = $2", [
				ids.acme,
				ids.website,
			]);
			expect(await markVersion()).toBe((loaded ?? 0) + 1);

			const website = itemOf(items, work.website);
			await expect(
				unwrap(
					resolveChangedAfterInvoicingAction({
						items: [website, itemOf(items, work.app)],
						explanation: "Handled",
					}),
				),
			).resolves.toEqual({
				status: "stale",
				invoicedWorkIds: [website.invoicedWorkId],
			});
			expect(await resolutions()).toEqual([]);
			expect((await invoiced()).map((row) => row.changed_fields)).toEqual([
				["customer"],
				["billability"],
			]);
		});

		it("refuses the batch when a correction commits while the resolution waits for it", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set duration_minutes = 80 where id = $1",
				[work.website],
			);
			const website = itemOf(await markedItems(), work.website);

			const correcting = await admin.connect();
			try {
				await correcting.query("begin");
				// The trigger marks the invoiced work and holds its row until commit.
				await correcting.query(
					"update work_period set project_id = $2 where id = $1",
					[work.website, ids.app],
				);
				const resolving = resolveChangedAfterInvoicingAction({
					items: [website],
					explanation: "Handled",
				});
				await waitForLockWaiters(1);
				await correcting.query("commit");

				await expect(unwrap(resolving)).resolves.toEqual({
					status: "stale",
					invoicedWorkIds: [website.invoicedWorkId],
				});
			} finally {
				correcting.release();
			}
			expect(await resolutions()).toEqual([]);
			expect((await invoiced())[0]?.changed_fields).toEqual(["project", "times"]);
		});

		it("lets only one of two concurrent resolutions of the same item through", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set duration_minutes = 80 where id = $1",
				[work.website],
			);
			const website = itemOf(await markedItems(), work.website);

			const holding = await admin.connect();
			try {
				await holding.query("begin");
				await holding.query(
					"select pg_advisory_xact_lock(hashtextextended($1, 0))",
					[`billable_time_hand_off:${ids.organization}`],
				);
				const first = resolveChangedAfterInvoicingAction({
					items: [website],
					explanation: "First",
				});
				const second = resolveChangedAfterInvoicingAction({
					items: [website],
					explanation: "Second",
				});
				await waitForLockWaiters(2);
				await holding.query("commit");

				const outcomes = await Promise.all([unwrap(first), unwrap(second)]);
				expect(outcomes).toEqual(
					expect.arrayContaining([
						{ status: "resolved", resolved: 1 },
						{ status: "stale", invoicedWorkIds: [website.invoicedWorkId] },
					]),
				);
			} finally {
				holding.release();
			}
			expect(await resolutions()).toHaveLength(1);
		});

		it("resolves a split item with its piece, and a change to the piece makes it stale", async () => {
			const { db } = await import("@/db");
			const { carryInvoicedWorkToSplit } = await import(
				"@/lib/billable-time/hand-off/invoiced-work"
			);
			await unwrap(confirm());
			// Split 08:00–09:30 at 09:00: the source keeps 60 minutes, the piece takes 30.
			await admin.query(
				"update work_period set end_time = '2026-09-02T09:00:00Z', duration_minutes = 60 where id = $1",
				[work.website],
			);
			const piece = await addWork({
				projectId: ids.website,
				start: "2026-09-02T09:00:00Z",
				end: "2026-09-02T09:30:00Z",
				minutes: 30,
			});
			await carryInvoicedWorkToSplit(db, {
				organizationId: ids.organization,
				sourceWorkPeriodId: work.website,
				newWorkPeriodId: piece,
			});

			const items = await markedItems();
			expect(items).toHaveLength(1);
			expect(items[0]).toMatchObject({
				workPeriodId: work.website,
				changedFields: ["split", "times"],
			});
			const loaded = itemOf(items, work.website);

			await admin.query(
				"update work_period set duration_minutes = 25 where id = $1",
				[piece],
			);
			await expect(
				unwrap(
					resolveChangedAfterInvoicingAction({
						items: [loaded],
						explanation: "Handled",
					}),
				),
			).resolves.toMatchObject({ status: "stale" });

			await expect(
				unwrap(
					resolveChangedAfterInvoicingAction({
						items: [itemOf(await markedItems(), work.website)],
						explanation: "Handled",
					}),
				),
			).resolves.toEqual({ status: "resolved", resolved: 1 });
			const [resolution] = await resolutions();
			expect(resolution?.snapshot.pieces.map((p) => p.workPeriodId)).toEqual([
				work.website,
				piece,
			]);
			expect(
				(await invoiced()).every((row) => row.changed_after_invoicing_at === null),
			).toBe(true);
		});

		it("shows marks cleared before resolutions existed in the draft's history", async () => {
			const { draftId } = await unwrap(confirm());
			await admin.query(
				`update invoiced_work set mark_cleared_at = '2026-10-01T10:00:00Z', mark_cleared_by = $2
				 where work_period_id = $1`,
				[work.app, ids.ownerUser],
			);

			const detail = await unwrap(getInvoiceDraftAction({ draftId }));
			expect(detail.resolutionHistory).toEqual([
				{
					kind: "cleared_before_resolutions",
					invoicedWorkId: expect.any(String),
					at: "2026-10-01T10:00:00.000Z",
					actorName: ids.ownerUser,
				},
			]);
		});

		it("keeps resolutions append-only, apart from the actor's deletion", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set duration_minutes = 80 where id = $1",
				[work.website],
			);
			await unwrap(
				resolveChangedAfterInvoicingAction({
					items: [itemOf(await markedItems(), work.website)],
					explanation: "Handled",
				}),
			);

			await expect(
				admin.query("update invoiced_work_resolution set explanation = 'Edited'"),
			).rejects.toThrow(/append-only/);
			await expect(
				admin.query("delete from invoiced_work_resolution"),
			).rejects.toThrow(/append-only/);
			// The audit trail and membership keep the user; only then can it go.
			await admin.query("delete from audit_log where performed_by = $1", [
				ids.adminUser,
			]);
			await admin.query("delete from member where user_id = $1", [
				ids.adminUser,
			]);
			await admin.query('delete from "user" where id = $1', [ids.adminUser]);
			expect(await resolutions()).toEqual([
				expect.objectContaining({ resolved_by: null, explanation: "Handled" }),
			]);
		});

		it("refuses other organizations' work, resolving nothing", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set duration_minutes = 80 where id = $1",
				[work.website],
			);
			const website = itemOf(await markedItems(), work.website);

			actAs(ids.otherUser, ids.otherOrganization);
			await expect(
				resolveChangedAfterInvoicingAction({
					items: [website],
					explanation: "Handled",
				}),
			).resolves.toMatchObject({ success: false, code: "NotFoundError" });
			expect(await resolutions()).toEqual([]);
		});
	});

	describe("comparing invoiced work with its hand-off values (#1501)", () => {
		async function markedItems() {
			return (await unwrap(getHandOffOverview())).changedAfterInvoicing;
		}

		async function comparisonOf(workPeriodId: string) {
			const found = (await markedItems()).find(
				(item) => item.workPeriodId === workPeriodId,
			);
			if (!found) throw new Error(`No marked item for ${workPeriodId}`);
			return found;
		}

		it("compares a times, a project and a billability correction with the hand-off, in the recorded offset", async () => {
			// 00:30–01:30 at UTC+02:00: the work's own day is 9 September.
			work.late = await addWork({
				projectId: ids.website,
				start: "2026-09-08T22:30:00Z",
				end: "2026-09-08T23:30:00Z",
				minutes: 60,
				offsetMinutes: 120,
			});
			const { draftId } = await unwrap(confirm());
			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1",
				[work.website],
			);
			await admin.query(
				"update work_period set project_id = $2 where id = $1",
				[work.app, ids.website],
			);
			await admin.query(
				"update work_period set is_billable = false where id = $1",
				[work.late],
			);

			expect((await comparisonOf(work.website)).comparison).toMatchObject({
				handOff: {
					end: { at: "2026-09-02T09:30:00.000Z", offsetMinutes: 0 },
					hours: "1.50",
				},
				lastResolved: null,
				current: {
					end: { at: "2026-09-02T09:45:00.000Z", offsetMinutes: 0 },
					hours: "1.75",
					changedFromHandOff: ["end", "hours"],
					changedSinceResolution: null,
				},
			});
			expect((await comparisonOf(work.app)).comparison).toMatchObject({
				handOff: {
					projects: [{ id: ids.app, name: "App" }],
					customers: [{ id: ids.acme, name: "Acme" }],
				},
				current: {
					projects: [{ id: ids.website, name: "Website" }],
					customers: [{ id: ids.acme, name: "Acme" }],
					changedFromHandOff: ["project"],
				},
			});
			const late = await comparisonOf(work.late);
			expect(late.comparison).toMatchObject({
				handOff: {
					day: "2026-09-09",
					start: { at: "2026-09-08T22:30:00.000Z", offsetMinutes: 120 },
					billability: "billable",
				},
				current: {
					day: "2026-09-09",
					start: { at: "2026-09-08T22:30:00.000Z", offsetMinutes: 120 },
					end: { at: "2026-09-08T23:30:00.000Z", offsetMinutes: 120 },
					billability: "non_billable",
					changedFromHandOff: ["billability"],
				},
			});

			const detail = await unwrap(getInvoiceDraftAction({ draftId }));
			expect(
				detail.marked.find((item) => item.workPeriodId === work.late)?.comparison,
			).toEqual(late.comparison);

			actAs(ids.otherUser, ids.otherOrganization);
			expect(await markedItems()).toEqual([]);
		});

		it("shows a deleted work period as removed", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set deleted_at = now(), deleted_by = $2 where id = $1",
				[work.website, ids.ownerUser],
			);

			expect((await comparisonOf(work.website)).comparison.current).toMatchObject({
				removed: true,
				pieceCount: 1,
				removedPieceCount: 1,
				changedFromHandOff: ["removed"],
			});
		});

		it("shows hand-off, last resolved and current values after a resolution and a further correction", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1",
				[work.website],
			);
			const loaded = await comparisonOf(work.website);
			await unwrap(
				resolveChangedAfterInvoicingAction({
					items: [
						{ invoicedWorkId: loaded.invoicedWorkId, markVersion: loaded.markVersion },
					],
					explanation: "Credit note CN-7",
				}),
			);
			await admin.query(
				"update work_period set is_billable = false where id = $1",
				[work.website],
			);

			const again = await comparisonOf(work.website);
			expect(again.changedFields).toEqual(["billability"]);
			expect(again.comparison).toMatchObject({
				handOff: { hours: "1.50", billability: "billable" },
				lastResolved: {
					resolvedAt: expect.any(String),
					hours: "1.75",
					billability: "billable",
					changedFromHandOff: ["end", "hours"],
				},
				current: {
					hours: "1.75",
					billability: "non_billable",
					changedFromHandOff: ["end", "hours", "billability"],
					changedSinceResolution: ["billability"],
				},
			});
		});

		it("compares a manual split and an automatic-break split as one item each, summing all pieces", async () => {
			const { db } = await import("@/db");
			const { carryInvoicedWorkToSplit } = await import(
				"@/lib/billable-time/hand-off/invoiced-work"
			);
			await unwrap(confirm());
			// Manual split of 08:00–09:30 at 09:00: 60 + 30 minutes, nothing else changes.
			await admin.query(
				"update work_period set end_time = '2026-09-02T09:00:00Z', duration_minutes = 60 where id = $1",
				[work.website],
			);
			const websitePiece = await addWork({
				projectId: ids.website,
				start: "2026-09-02T09:00:00Z",
				end: "2026-09-02T09:30:00Z",
				minutes: 30,
			});
			// An owed break 08:30–08:45 divides 08:00–09:01: 30 + 16 minutes.
			await admin.query(
				"update work_period set end_time = '2026-09-03T08:30:00Z', duration_minutes = 30 where id = $1",
				[work.app],
			);
			const appPiece = await addWork({
				projectId: ids.app,
				start: "2026-09-03T08:45:00Z",
				end: "2026-09-03T09:01:00Z",
				minutes: 16,
			});
			for (const [source, piece] of [
				[work.website, websitePiece],
				[work.app, appPiece],
			] as const) {
				await carryInvoicedWorkToSplit(db, {
					organizationId: ids.organization,
					sourceWorkPeriodId: source,
					newWorkPeriodId: piece,
				});
			}

			const items = await markedItems();
			expect(items.map((item) => item.workPeriodId).sort()).toEqual(
				[work.website, work.app].sort(),
			);
			expect((await comparisonOf(work.website)).comparison.current).toMatchObject({
				pieceCount: 2,
				start: { at: "2026-09-02T08:00:00.000Z" },
				end: { at: "2026-09-02T09:30:00.000Z" },
				durationMinutes: 90,
				changedFromHandOff: [],
			});
			const app = await comparisonOf(work.app);
			expect(app.comparison.current).toMatchObject({
				pieceCount: 2,
				end: { at: "2026-09-03T09:01:00.000Z" },
				durationMinutes: 46,
				hours: "0.77",
				changedFromHandOff: ["hours"],
			});

			// Correcting the piece makes the loaded item stale; resolving it resolves every piece.
			await admin.query(
				"update work_period set duration_minutes = 15 where id = $1",
				[appPiece],
			);
			await expect(
				unwrap(
					resolveChangedAfterInvoicingAction({
						items: [{ invoicedWorkId: app.invoicedWorkId, markVersion: app.markVersion }],
						explanation: "Handled",
					}),
				),
			).resolves.toEqual({ status: "stale", invoicedWorkIds: [app.invoicedWorkId] });
			const fresh = await comparisonOf(work.app);
			expect(fresh.comparison.current.durationMinutes).toBe(45);
			await unwrap(
				resolveChangedAfterInvoicingAction({
					items: [{ invoicedWorkId: fresh.invoicedWorkId, markVersion: fresh.markVersion }],
					explanation: "Handled",
				}),
			);
			const { rows } = await admin.query<{ marked: number }>(
				`select count(*)::int as marked from invoiced_work
				 where organization_id = $1 and work_period_id = any($2::uuid[])
				 and changed_after_invoicing_at is not null`,
				[ids.organization, [work.app, appPiece]],
			);
			expect(rows[0]?.marked).toBe(0);
		});
	});

	describe("amount differences at the frozen rate (#1502)", () => {
		async function differenceOf(workPeriodId: string) {
			const found = (await unwrap(getHandOffOverview())).changedAfterInvoicing.find(
				(item) => item.workPeriodId === workPeriodId,
			);
			if (!found) throw new Error(`No marked item for ${workPeriodId}`);
			return found.comparison.amountDifference;
		}

		async function frozenState(draftId: string) {
			const [lines, totals, shares] = await Promise.all([
				admin.query(
					"select position, quantity_hundredths, unit_price, amount from invoice_draft_line where invoice_draft_id = $1 order by position",
					[draftId],
				),
				admin.query("select net_total from invoice_draft where id = $1", [draftId]),
				admin.query(
					"select id, shares from invoiced_work where invoice_draft_id = $1 order by id",
					[draftId],
				),
			]);
			return { lines: lines.rows, totals: totals.rows, shares: shares.rows };
		}

		it("prices corrected times at the frozen rate; a backdated rate edit and reading change nothing", async () => {
			const { draftId } = await unwrap(confirm());
			const before = await frozenState(draftId);
			// Website 90 → 105 minutes at 100.00; App 61 → 71 minutes at 85.50.
			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1",
				[work.website],
			);
			await admin.query(
				"update work_period set end_time = end_time + interval '10 minutes', duration_minutes = 71 where id = $1",
				[work.app],
			);
			await admin.query(
				"update billable_rate set hourly_rate = 200.00 where organization_id = $1",
				[ids.organization],
			);

			expect(await differenceOf(work.website)).toEqual({
				currency: "EUR",
				fromHandOff: {
					kind: "known",
					amount: "25.00",
					reason: "frozen_rate",
					roundingCaveat: true,
				},
				sinceResolution: null,
				notOnHandOffForNewCustomer: false,
			});
			expect((await differenceOf(work.app)).fromHandOff).toMatchObject({ amount: "14.25" });
			expect(await frozenState(draftId)).toEqual(before);
		});

		it("can't price corrected times the hand-off split across a rate change", async () => {
			const { draftId } = await unwrap(confirm());
			// As handed off across a rate change: 60 minutes at 100.00, 30 at 120.00.
			await admin.query(
				`update invoiced_work set shares = $2::jsonb where invoice_draft_id = $1 and work_period_id = $3`,
				[
					draftId,
					JSON.stringify([
						{ line: 1, durationMs: 3_600_000, rate: "100.00", amount: "100.00" },
						{ line: 3, durationMs: 1_800_000, rate: "120.00", amount: "60.00" },
					]),
					work.website,
				],
			);
			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1",
				[work.website],
			);

			expect((await differenceOf(work.website)).fromHandOff).toEqual({
				kind: "unknown",
				reason: "several_rates",
			});
		});

		it("reverses removed and non-billable work in full, and can't price a move to another project of the customer", async () => {
			await unwrap(confirm());
			await admin.query(
				"update work_period set deleted_at = now(), deleted_by = $2 where id = $1",
				[work.website, ids.ownerUser],
			);
			// App's 61 minutes were one line: 1.02 h × 85.50 = 87.21.
			await admin.query("update work_period set is_billable = false where id = $1", [
				work.app,
			]);

			expect((await differenceOf(work.website)).fromHandOff).toEqual({
				kind: "known",
				amount: "-150.00",
				reason: "removed",
				roundingCaveat: false,
			});
			expect((await differenceOf(work.app)).fromHandOff).toEqual({
				kind: "known",
				amount: "-87.21",
				reason: "non_billable",
				roundingCaveat: false,
			});

			await admin.query(
				"update work_period set is_billable = true, project_id = $2 where id = $1",
				[work.app, ids.website],
			);
			expect((await differenceOf(work.app)).fromHandOff).toEqual({
				kind: "unknown",
				reason: "other_project",
			});
		});

		it("reverses work whose project moved to another customer and warns it is on no hand-off for it", async () => {
			await unwrap(confirm());
			await admin.query("update project set customer_id = $2 where id = $1", [
				ids.app,
				ids.beta,
			]);

			expect(await differenceOf(work.app)).toMatchObject({
				fromHandOff: { kind: "known", amount: "-87.21", reason: "customer" },
				notOnHandOffForNewCustomer: true,
			});
		});

		it("estimates a reversal for shares handed off without a stored amount", async () => {
			const { draftId } = await unwrap(confirm());
			await admin.query(
				`update invoiced_work
				 set shares = (select jsonb_agg(share - 'amount') from jsonb_array_elements(shares) share)
				 where invoice_draft_id = $1 and work_period_id = $2`,
				[draftId, work.website],
			);
			await admin.query(
				"update work_period set deleted_at = now(), deleted_by = $2 where id = $1",
				[work.website, ids.ownerUser],
			);

			expect((await differenceOf(work.website)).fromHandOff).toEqual({
				kind: "estimated",
				amount: "-150.00",
				reason: "removed",
				roundingCaveat: false,
			});
		});

		it("shows the difference from the hand-off and since the last resolution after resolve and correct", async () => {
			const { draftId } = await unwrap(confirm());
			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1",
				[work.website],
			);
			const loaded = (await unwrap(getHandOffOverview())).changedAfterInvoicing.find(
				(item) => item.workPeriodId === work.website,
			);
			if (!loaded) throw new Error("Not marked");
			await unwrap(
				resolveChangedAfterInvoicingAction({
					items: [{ invoicedWorkId: loaded.invoicedWorkId, markVersion: loaded.markVersion }],
					explanation: "Credit note CN-7",
				}),
			);
			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 120 where id = $1",
				[work.website],
			);

			const difference = await differenceOf(work.website);
			expect(difference.fromHandOff).toMatchObject({ kind: "known", amount: "50.00" });
			expect(difference.sinceResolution).toMatchObject({ kind: "known", amount: "25.00" });
			const detail = await unwrap(getInvoiceDraftAction({ draftId }));
			expect(
				detail.marked.find((item) => item.workPeriodId === work.website)?.comparison
					.amountDifference,
			).toEqual(difference);
		});
	});

	describe("reconciliation history on released drafts (#1503)", () => {
		async function detailOf(draftId: string) {
			return unwrap(getInvoiceDraftAction({ draftId }));
		}

		function markedOf(
			detail: Awaited<ReturnType<typeof detailOf>>,
			workPeriodId: string,
		) {
			const found = detail.marked.find(
				(item) => item.workPeriodId === workPeriodId,
			);
			if (!found) throw new Error(`No marked item for ${workPeriodId}`);
			return found;
		}

		async function recorded() {
			const { rows } = await admin.query<{
				resolutions: number;
				audits: number;
			}>(
				`select
				 (select count(*)::int from invoiced_work_resolution where organization_id = $1) as resolutions,
				 (select count(*)::int from audit_log where organization_id = $1
				  and action = 'billable_time.invoiced_work_mark_resolved') as audits`,
				[ids.organization],
			);
			return rows[0];
		}

		async function marks(draftId: string) {
			const { rows } = await admin.query(
				`select id, changed_fields, changed_after_invoicing_at, mark_version, released_at
				 from invoiced_work where organization_id = $1 and invoice_draft_id = $2 order by id`,
				[ids.organization, draftId],
			);
			return rows;
		}

		/** Hands off September, corrects both items and resolves the App one. */
		async function releasedWithHistory() {
			const { draftId } = await unwrap(confirm());
			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1",
				[work.website],
			);
			await admin.query(
				"update work_period set project_id = $2 where id = $1",
				[work.app, ids.website],
			);
			const app = markedOf(await detailOf(draftId), work.app);
			await unwrap(
				resolveChangedAfterInvoicingAction({
					items: [
						{ invoicedWorkId: app.invoicedWorkId, markVersion: app.markVersion },
					],
					explanation: "Credit note CN-1",
				}),
			);
			const beforeRelease = await detailOf(draftId);
			await unwrap(releaseInvoiceDraftAction({ draftId, reason: "Redo" }));
			return { draftId, beforeRelease };
		}

		it("keeps showing the comparisons and history its items had, with open marks as open when released", async () => {
			const { draftId, beforeRelease } = await releasedWithHistory();
			const before = markedOf(beforeRelease, work.website);
			expect(before.openWhenReleased).toBe(false);

			const released = await detailOf(draftId);
			expect(released.status).toBe("released");
			expect(released.resolutionHistory).toEqual(
				beforeRelease.resolutionHistory,
			);
			expect(released.resolutionHistory).toEqual([
				expect.objectContaining({
					kind: "resolution",
					explanation: "Credit note CN-1",
					resolvedFields: ["project"],
				}),
			]);
			expect(released.marked).toEqual([
				{ ...before, openWhenReleased: true },
			]);
			expect(released.marked[0]?.comparison).toMatchObject({
				handOff: { hours: "1.50" },
				current: { hours: "1.75", changedFromHandOff: ["end", "hours"] },
			});
		});

		it("refuses resolving work of a released draft, recording nothing", async () => {
			const { draftId, beforeRelease } = await releasedWithHistory();
			const loadedBefore = markedOf(beforeRelease, work.website);
			const loadedAfter = markedOf(await detailOf(draftId), work.website);
			const countsBefore = await recorded();
			const marksBefore = await marks(draftId);

			for (const loaded of [loadedBefore, loadedAfter]) {
				await expect(
					unwrap(
						resolveChangedAfterInvoicingAction({
							items: [
								{
									invoicedWorkId: loaded.invoicedWorkId,
									markVersion: loaded.markVersion,
								},
							],
							explanation: "Handled",
						}),
					),
				).resolves.toEqual({
					status: "released",
					invoicedWorkIds: [loaded.invoicedWorkId],
				});
			}
			expect(await recorded()).toEqual(countsBefore);
			expect(await marks(draftId)).toEqual(marksBefore);

			// The whole batch is refused when it also holds resolvable work of another draft.
			const { draftId: secondDraftId } = await unwrap(confirm());
			await admin.query(
				"update work_period set duration_minutes = 50 where id = $1",
				[work.app],
			);
			const open = markedOf(await detailOf(secondDraftId), work.app);
			await expect(
				unwrap(
					resolveChangedAfterInvoicingAction({
						items: [
							{
								invoicedWorkId: open.invoicedWorkId,
								markVersion: open.markVersion,
							},
							{
								invoicedWorkId: loadedAfter.invoicedWorkId,
								markVersion: loadedAfter.markVersion,
							},
						],
						explanation: "Handled",
					}),
				),
			).resolves.toEqual({
				status: "released",
				invoicedWorkIds: [loadedAfter.invoicedWorkId],
			});
			expect(await recorded()).toEqual(countsBefore);
		});

		it("starts a new draft's comparisons from its own hand-off and leaves the released draft's history as it was", async () => {
			const { draftId } = await releasedWithHistory();
			const oldDetail = await detailOf(draftId);
			const oldMarks = await marks(draftId);

			const { draftId: newDraftId } = await unwrap(confirm());
			expect(newDraftId).not.toBe(draftId);
			const fresh = await detailOf(newDraftId);
			expect(fresh.marked).toEqual([]);
			expect(fresh.resolutionHistory).toEqual([]);

			await admin.query(
				"update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 120 where id = $1",
				[work.website],
			);
			const corrected = markedOf(await detailOf(newDraftId), work.website);
			expect(corrected).toMatchObject({
				openWhenReleased: false,
				changedFields: ["times"],
				history: [],
				comparison: {
					handOff: {
						end: { at: "2026-09-02T09:45:00.000Z", offsetMinutes: 0 },
						hours: "1.75",
					},
					lastResolved: null,
					current: {
						end: { at: "2026-09-02T10:00:00.000Z", offsetMinutes: 0 },
						hours: "2.00",
						changedFromHandOff: ["end", "hours"],
					},
				},
			});

			// The released draft's marks and history stay as they were.
			const oldAgain = await detailOf(draftId);
			expect(await marks(draftId)).toEqual(oldMarks);
			expect(oldAgain.resolutionHistory).toEqual(oldDetail.resolutionHistory);
			expect(markedOf(oldAgain, work.website)).toMatchObject({
				openWhenReleased: true,
				changedFields: ["times"],
				markVersion: markedOf(oldDetail, work.website).markVersion,
			});

			// Resolving in the new draft leaves the released draft's history alone.
			await unwrap(
				resolveChangedAfterInvoicingAction({
					items: [
						{
							invoicedWorkId: corrected.invoicedWorkId,
							markVersion: corrected.markVersion,
						},
					],
					explanation: "Handled in the new draft",
				}),
			);
			expect((await detailOf(draftId)).resolutionHistory).toEqual(
				oldDetail.resolutionHistory,
			);
			expect((await detailOf(newDraftId)).resolutionHistory).toEqual([
				expect.objectContaining({ explanation: "Handled in the new draft" }),
			]);
		});

		it("refuses non-admins and other organizations, on reads and on resolving", async () => {
			const { draftId } = await releasedWithHistory();
			const loaded = markedOf(await detailOf(draftId), work.website);
			const resolving = () =>
				resolveChangedAfterInvoicingAction({
					items: [
						{
							invoicedWorkId: loaded.invoicedWorkId,
							markVersion: loaded.markVersion,
						},
					],
					explanation: "Handled",
				});

			actAs(ids.memberUser);
			await expect(getInvoiceDraftAction({ draftId })).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
			await expect(resolving()).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});

			actAs(ids.otherUser, ids.otherOrganization);
			await expect(getInvoiceDraftAction({ draftId })).resolves.toMatchObject({
				success: false,
				code: "NotFoundError",
			});
			await expect(resolving()).resolves.toMatchObject({
				success: false,
				code: "NotFoundError",
			});
		});
	});

	it("reports invoiced and un-invoiced hours and revenue at the frozen rates", async () => {
		await unwrap(confirm({ projectIds: [ids.website] }));
		await addWork({
			projectId: ids.website,
			start: "2026-09-10T08:00:00Z",
			end: "2026-09-10T09:00:00Z",
			minutes: 60,
		});
		// A later backdated rate change never reprices invoiced work (ADR 0001).
		await admin.query(
			"update billable_rate set hourly_rate = 200.00 where organization_id = $1 and project_id = $2",
			[ids.organization, ids.website],
		);

		actAs(ids.ownerUser);
		const report = await unwrap(
			getProjectDetailedReport(ids.website, "2026-09-01", "2026-09-30"),
		);
		// Un-invoiced: the new hour and the held-back hour, at the new rate.
		expect(report.summary.billable).toMatchObject({
			revenue: "550.00",
			invoicing: {
				invoicedMinutes: 90,
				invoicedRevenue: "150.00",
				uninvoicedMinutes: 120,
				uninvoicedRevenue: "400.00",
				changedAfterInvoicingCount: 0,
			},
		});
	});

	it("reports invoiced revenue equal to the draft's frozen line amounts", async () => {
		// 61 minutes at 85.50: the draft line states 1.02 h = 87.21 (exact time would be 86.93).
		const { draftId } = await unwrap(confirm({ projectIds: [ids.app] }));
		const detail = await unwrap(getInvoiceDraftAction({ draftId }));
		expect(detail.netTotal).toBe("87.21");

		actAs(ids.ownerUser);
		const report = await unwrap(
			getProjectDetailedReport(ids.app, "2026-09-01", "2026-09-30"),
		);
		expect(report.summary.billable).toMatchObject({
			revenue: "87.21",
			invoicing: { invoicedRevenue: "87.21", uninvoicedRevenue: "0.00" },
		});
	});

	it("lets only owners and admins hand off, within their own organization", async () => {
		const { draftId } = await unwrap(confirm());

		actAs(ids.memberUser);
		for (const result of [
			getHandOffOverview(),
			previewHandOffAction(september),
			confirmHandOffAction({
				...september,
				idempotencyKey: randomUUID(),
				fingerprint: "",
			}),
			retryHandOffAction({ draftId }),
			getInvoiceDraftAction({ draftId }),
			checkInvoiceDraftStatusAction({ draftId }),
			releaseInvoiceDraftAction({ draftId }),
			resolveChangedAfterInvoicingAction({
				items: [{ invoicedWorkId: randomUUID(), markVersion: "x" }],
				explanation: "Handled",
			}),
		]) {
			await expect(result).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
		}

		actAs(ids.otherUser, ids.otherOrganization);
		await expect(getInvoiceDraftAction({ draftId })).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		await expect(releaseInvoiceDraftAction({ draftId })).resolves.toMatchObject(
			{
				success: false,
				code: "NotFoundError",
			},
		);
		await expect(previewHandOffAction(september)).resolves.toMatchObject({
			success: false,
		});

		actAs(ids.ownerUser);
		await expect(
			previewHandOffAction({ ...september, customerId: ids.foreignCustomer }),
		).resolves.toMatchObject({ success: false, error: "Choose a customer" });
		await expect(
			previewHandOffAction({ ...september, projectIds: [ids.foreignProject] }),
		).resolves.toMatchObject({
			success: false,
			error: "Choose projects of this customer",
		});
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "created" }),
		]);
	});

	it("treats a deleted customer's billable work as without customer, never handed off", async () => {
		await admin.query("update customer set is_active = false where id = $1", [
			ids.acme,
		]);

		await expect(previewHandOffAction(september)).resolves.toMatchObject({
			success: false,
			error: "Choose a customer",
		});
		await expect(
			confirmHandOffAction({
				...september,
				idempotencyKey: randomUUID(),
				fingerprint: "x",
			}),
		).resolves.toMatchObject({ success: false, error: "Choose a customer" });
		const other = await preview({ customerId: ids.beta });
		// Website 1.50 h + held 1.00 h, App 1.02 h (61 min), Internal 0.50 h: no active customer.
		expect(other.withoutCustomer).toEqual({
			count: 4,
			hours: "4.02",
			projects: ["App", "Internal", "Website"],
		});
		expect(tool.createCalls()).toBe(0);
	});

	it("refuses a customer without a contact link", async () => {
		const shown = await preview({ customerId: ids.beta });
		expect(shown.blockers).toContainEqual({ kind: "no_contact_link" });
		await expect(confirm({ customerId: ids.beta })).resolves.toMatchObject({
			success: false,
			error: "Link this customer to a contact in the accounting tool first",
		});
	});
});
