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
								id: `t903b-session-${harness.userId}`,
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
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/logger", () => {
	const noop = () => {};
	const logger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop, fatal: noop };
	return { createLogger: () => ({ ...logger, child: () => logger }), logger };
});
vi.mock("@/lib/vault", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/vault")>()),
	storeOrgSecret: async (organizationId: string, key: string, value: string) => {
		harness.secrets.set(`${organizationId}|${key}`, value);
	},
	getOrgSecret: async (organizationId: string, key: string) =>
		harness.secrets.get(`${organizationId}|${key}`) ?? null,
	deleteOrgSecret: async (organizationId: string, key: string) => {
		harness.secrets.delete(`${organizationId}|${key}`);
	},
}));
vi.mock("@/lib/billable-time/accounting/registry", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billable-time/accounting/registry")>()),
	getAccountingProviderRegistry: () => {
		if (!harness.registry) throw new Error("No fake registry");
		return harness.registry;
	},
}));

const {
	checkInvoiceDraftStatusAction,
	clearChangedAfterInvoicingAction,
	confirmHandOffAction,
	getHandOffOverview,
	getInvoiceDraftAction,
	previewHandOffAction,
	releaseInvoiceDraftAction,
	retryHandOffAction,
} = await import("./actions");
const { getProjectDetailedReport } = await import("@/app/[locale]/(app)/reports/projects/actions");
const { createFakeAccountingTool, fakeAccountingProviderRegistry } = await import(
	"@/lib/billable-time/accounting/fake-provider"
);

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
	result: Promise<{ success: true; data: T } | { success: false; error: string }>,
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
			await admin.query("delete from approval_request where organization_id = $1", [
				organizationId,
			]);
			await admin.query("delete from invoiced_work where organization_id = $1", [organizationId]);
			await admin.query("delete from work_period where organization_id = $1", [organizationId]);
			await admin.query("delete from time_entry where organization_id = $1", [organizationId]);
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
				 values ($1, $2, $3, $4, $5, 0, 'Etc/UTC', 'user_setting', $6, $7)`,
				[entryId, employeeId, organizationId, type, timestamp, `hash-${entryId}`, ids.ownerUser],
			);
		}
		const id = randomUUID();
		await admin.query(
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
		const { rows } = await admin.query<{ action: string; entity_type: string; changes: string }>(
			`select action, entity_type, changes from audit_log
			 where organization_id = $1 and action like 'billable_time.invoice%' order by timestamp, id`,
			[ids.organization],
		);
		return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
	}

	async function preview(input: Partial<typeof september> = {}) {
		return unwrap(previewHandOffAction({ ...september, ...input }));
	}

	async function confirm(
		input: Partial<typeof september> & { idempotencyKey?: string; fingerprint?: string } = {},
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
		tool = createFakeAccountingTool({ apiKey: API_KEY, contacts: [acmeContact] });
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
		harness.secrets.set(`${ids.organization}|accounting/${ids.connection}/api_key`, API_KEY);
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
		work.live = await addWork({ projectId: ids.website, start: "2026-09-29T08:00:00Z" });
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
		expect(shown.included.map((item) => item.workPeriodId)).toEqual([work.website, work.app]);
		expect(shown.heldBack.map((item) => item.workPeriodId)).toEqual([work.held]);
		expect(shown.nonBillable).toEqual({ count: 1, hours: "0.75" });
		expect(shown.withoutCustomer).toEqual({ count: 1, hours: "0.50", projects: ["Internal"] });
		expect(shown.contact).toMatchObject({ contactId: "c-acme" });
		expect(shown.taxTreatment).toMatchObject({ kind: "domestic_standard", rate: "19.00" });

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
		expect((await invoiced()).map((row) => row.work_period_id)).toEqual([work.website, work.app]);
		expect(await auditActions()).toEqual([
			expect.objectContaining({
				action: "billable_time.invoice_draft_created",
				entity_type: "invoice_draft",
				changes: expect.objectContaining({ netTotal: "237.21", workCount: 2 }),
			}),
		]);

		const again = await preview();
		expect(again.alreadyInvoiced.map((item) => item.workPeriodId)).toEqual([work.website, work.app]);
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
			error: "1 work periods have no billable rate. Add a rate for them before handing off",
			code: "ValidationError",
		});
		expect(tool.createCalls()).toBe(0);
		expect(await drafts()).toEqual([]);
		expect(await invoiced()).toEqual([]);

		// Handing off only the priced projects works.
		await expect(confirm({ projectIds: [ids.website, ids.app] })).resolves.toMatchObject({
			success: true,
		});
	});

	it("retries after a timeout into one draft and one set of invoiced work", async () => {
		const key = randomUUID();
		tool.simulateTimeout();

		const first = await confirm({ idempotencyKey: key });
		expect(first).toMatchObject({ success: false, code: "ConflictError" });
		expect(first.success ? "" : first.error).toContain("did not answer");
		expect(tool.drafts()).toHaveLength(1);
		const [pending] = await drafts();
		expect(pending).toMatchObject({ status: "pending", outcome_unknown: true, attempt_count: 1 });
		// The work is reserved: another hand-off cannot take it meanwhile.
		expect((await preview()).alreadyInvoiced).toHaveLength(2);

		const retried = await unwrap(retryHandOffAction({ draftId: pending?.id ?? "" }));
		expect(retried).toEqual({ draftId: pending?.id, replayed: false });
		const replayed = await unwrap(
			confirmHandOffAction({ ...september, idempotencyKey: key, fingerprint: "stale" }),
		);
		expect(replayed).toEqual({ draftId: pending?.id, replayed: true });

		expect(tool.drafts()).toHaveLength(1);
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "created", external_id: "fake-draft-1", attempt_count: 2 }),
		]);
		expect(await invoiced()).toHaveLength(2);
	});

	it("fails a refused draft and returns its work", async () => {
		tool.failNext("createInvoiceDraft", "rejected");

		const refused = await confirm();
		expect(refused).toMatchObject({ success: false, code: "ValidationError" });
		expect(await drafts()).toEqual([expect.objectContaining({ status: "failed" })]);
		expect((await invoiced()).every((row) => row.released_at !== null)).toBe(true);
		expect((await preview()).included).toHaveLength(2);
		expect((await auditActions()).map((row) => row.action)).toEqual([
			"billable_time.invoice_draft_failed",
		]);
	});

	it("refuses a confirm whose preview is outdated", async () => {
		const shown = await preview();
		await admin.query("update work_period set duration_minutes = 80 where id = $1", [work.website]);

		await expect(
			confirmHandOffAction({ ...september, idempotencyKey: randomUUID(), fingerprint: shown.fingerprint }),
		).resolves.toMatchObject({ success: false, code: "ConflictError" });
		expect(tool.createCalls()).toBe(0);
	});

	it("suggests a release for a draft gone from the tool, and a release makes the work available again", async () => {
		const { draftId } = await unwrap(confirm());
		const [created] = tool.drafts();
		tool.deleteDraft(created?.externalId ?? "");

		await expect(unwrap(checkInvoiceDraftStatusAction({ draftId }))).resolves.toEqual({
			kind: "gone",
		});
		// Never released automatically.
		expect(await drafts()).toEqual([expect.objectContaining({ status: "created" })]);

		await expect(
			unwrap(releaseInvoiceDraftAction({ draftId, reason: "Deleted in Lexware" })),
		).resolves.toEqual({ workReturned: 2 });
		expect((await auditActions()).at(-1)).toMatchObject({
			action: "billable_time.invoice_draft_released",
			changes: { workReturned: 2, reason: "Deleted in Lexware", toolStatus: "gone" },
		});
		expect((await preview()).included).toHaveLength(2);
		await expect(confirm()).resolves.toMatchObject({ success: true });
		expect(await drafts()).toEqual([
			expect.objectContaining({ status: "released" }),
			expect.objectContaining({ status: "created", external_id: "fake-draft-2" }),
		]);
	});

	it("adds the timesheet as text lines and provides it for download", async () => {
		const { draftId } = await unwrap(confirm({ includeTimesheet: true }));

		const texts = tool
			.drafts()[0]
			?.draft.lines.flatMap((line) => (line.kind === "text" ? [line.text] : []));
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

	it("marks invoiced work changed by any write and lets an admin clear the mark, audited", async () => {
		const { draftId } = await unwrap(confirm());

		// Writes that do not touch times, project or billability leave no mark.
		await admin.query("update work_period set work_location_type = 'home' where id = $1", [
			work.website,
		]);
		expect((await invoiced()).every((row) => row.changed_after_invoicing_at === null)).toBe(true);

		await admin.query("update work_period set end_time = end_time + interval '15 minutes', duration_minutes = 105 where id = $1", [
			work.website,
		]);
		await admin.query("update work_period set is_billable = false where id = $1", [work.app]);
		const marked = await invoiced();
		expect(marked.map((row) => row.changed_fields)).toEqual([["times"], ["billability"]]);

		const overview = await unwrap(getHandOffOverview());
		expect(overview.changedAfterInvoicing.map((row) => row.workPeriodId)).toEqual([
			work.website,
			work.app,
		]);
		const detail = await unwrap(getInvoiceDraftAction({ draftId }));
		expect(detail.changedCount).toBe(2);

		await expect(
			unwrap(
				clearChangedAfterInvoicingAction({
					invoicedWorkIds: [overview.changedAfterInvoicing[0]?.invoicedWorkId ?? ""],
				}),
			),
		).resolves.toEqual({ cleared: 1 });
		expect((await invoiced()).map((row) => row.changed_fields)).toEqual([[], ["billability"]]);
		const { rows } = await admin.query<{ entity_id: string; changes: string }>(
			`select entity_id, changes from audit_log where organization_id = $1
			 and action = 'billable_time.invoiced_work_mark_cleared'`,
			[ids.organization],
		);
		expect(rows).toEqual([{ entity_id: work.website, changes: expect.stringContaining('"times"') }]);
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
			getProjectDetailedReport(ids.website, new Date("2026-09-01"), new Date("2026-09-30")),
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

	it("lets only owners and admins hand off, within their own organization", async () => {
		const { draftId } = await unwrap(confirm());

		actAs(ids.memberUser);
		for (const result of [
			getHandOffOverview(),
			previewHandOffAction(september),
			confirmHandOffAction({ ...september, idempotencyKey: randomUUID(), fingerprint: "" }),
			retryHandOffAction({ draftId }),
			getInvoiceDraftAction({ draftId }),
			checkInvoiceDraftStatusAction({ draftId }),
			releaseInvoiceDraftAction({ draftId }),
			clearChangedAfterInvoicingAction({ invoicedWorkIds: [randomUUID()] }),
		]) {
			await expect(result).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		}

		actAs(ids.otherUser, ids.otherOrganization);
		await expect(getInvoiceDraftAction({ draftId })).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		await expect(releaseInvoiceDraftAction({ draftId })).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		await expect(previewHandOffAction(september)).resolves.toMatchObject({ success: false });

		actAs(ids.ownerUser);
		await expect(
			previewHandOffAction({ ...september, customerId: ids.foreignCustomer }),
		).resolves.toMatchObject({ success: false, error: "Choose a customer" });
		await expect(
			previewHandOffAction({ ...september, projectIds: [ids.foreignProject] }),
		).resolves.toMatchObject({ success: false, error: "Choose projects of this customer" });
		expect(await drafts()).toEqual([expect.objectContaining({ status: "created" })]);
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
