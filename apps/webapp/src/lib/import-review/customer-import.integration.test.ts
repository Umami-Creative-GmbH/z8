/**
 * #906: importing customers from the accounting connection, on PostgreSQL.
 *
 * The real start action, reviewed-import worker (scan and commit), review
 * decision and commit actions, stores, constraints and audit trail run against
 * a disposable database. The accounting tool is the real Lexware Office
 * connector against the scripted stand-in replaying recorded Public API
 * fixtures, or the in-memory fake for edge cases. Replaced besides: the
 * request/session, SSO session store, Next cache, the organization secret
 * store (in-memory map) and the import queue (jobs are run in-line).
 */

import type { Job } from "bullmq";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ACME_CONTACT_ID,
	acmeContact,
	archivedContact,
	contactsPage,
	LEXWARE_ORGANIZATION_ID,
	PERSON_CONTACT_ID,
	personContact,
	profileResponse,
} from "@/lib/billable-time/accounting/lexware/__fixtures__/lexware-public-api";
import {
	type ScriptedLexware,
	scriptedLexware,
} from "@/lib/billable-time/accounting/lexware/__fixtures__/scripted-lexware";
import type { AccountingContact } from "@/lib/billable-time/accounting/provider";
import type { AccountingProviderRegistry } from "@/lib/billable-time/accounting/registry";
import { integrationAdminPool } from "@/test/integration-database";
import type {
	AccountingCustomerScanJobData,
	ImportCommitJobData,
	ImportScanJobData,
} from "./types";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	secrets: new Map<string, string>(),
	registry: null as AccountingProviderRegistry | null,
	scanJobs: [] as unknown[],
	commitJobs: [] as unknown[],
	failScanQueue: false,
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
								id: `t906-session-${harness.userId}`,
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
		if (!harness.registry) throw new Error("No registry");
		return harness.registry;
	},
}));

vi.mock("@/lib/import-review/queue", () => ({
	enqueueImportScanJob: async (data: unknown) => {
		if (harness.failScanQueue) throw new Error("Redis connection refused");
		harness.scanJobs.push(data);
	},
	enqueueImportCommitJob: async (data: unknown) => {
		harness.commitJobs.push(data);
	},
}));

const { connectAccountingTool, startCustomerImport } = await import(
	"@/app/[locale]/(app)/settings/billable-time/accounting/actions"
);
const { applyImportDecisionAction, startImportCommitAction } = await import(
	"@/app/[locale]/(app)/settings/import/review-actions"
);
const { processImportReviewJob } = await import("./worker");
const { createAccountingProviderRegistry } = await import(
	"@/lib/billable-time/accounting/registry"
);
const { createLexwareOfficeConnector } = await import(
	"@/lib/billable-time/accounting/lexware/connector"
);
const { createFakeAccountingTool } = await import("@/lib/billable-time/accounting/fake-provider");

const ids = {
	organization: "t906-org",
	otherOrganization: "t906-other-org",
	adminUser: "t906-admin-user",
	memberUser: "t906-member-user",
	otherAdminUser: "t906-other-admin-user",
	erika: "90600000-0000-4000-8000-000000000001",
	foreignCustomer: "90600000-0000-4000-8000-000000000002",
	acmeOld: "90600000-0000-4000-8000-000000000003",
} as const;
const users = [ids.adminUser, ids.memberUser, ids.otherAdminUser];
const standard = { kind: "domestic_standard", rate: "19" } as const;
const KEY = "lx-SECRET-906-0a1b2c3d";

type Row = {
	id: string;
	provider_source_id: string;
	row_status: string;
	issue_severity: string;
	match_target: Record<string, unknown> | null;
	commit_hold: Record<string, unknown> | null;
	commit_target_id: string | null;
};

describe("Customer import from the accounting connection on PostgreSQL (#906)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let lexware: ScriptedLexware;

	function actAs(userId: string, organizationId: string) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	function useLexware() {
		lexware = scriptedLexware();
		harness.registry = createAccountingProviderRegistry([
			createLexwareOfficeConnector({
				fetch: lexware.fetch,
				sleep: lexware.time.sleep,
				monotonicNow: lexware.time.now,
			}),
		]);
	}

	beforeEach(async () => {
		await cleanup();
		harness.secrets.clear();
		harness.scanJobs.length = 0;
		harness.commitJobs.length = 0;
		harness.failScanQueue = false;
		useLexware();

		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, projects_enabled, billable_time_enabled, created_at) values
			 ($1, 'T906', $1, true, true, $3), ($2, 'T906 other', $2, true, true, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'EUR')`,
			[ids.organization, ids.otherOrganization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t906-m-admin', $1, $3, 'admin', 'approved', $6),
			 ('t906-m-member', $1, $4, 'member', 'approved', $6),
			 ('t906-m-other-admin', $2, $5, 'admin', 'approved', $6)`,
			[
				ids.organization,
				ids.otherOrganization,
				ids.adminUser,
				ids.memberUser,
				ids.otherAdminUser,
				timestamp,
			],
		);
		// A Z8 customer named like the Lexware person contact, in another case.
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $2, 'ERIKA ACMEIER', $4, $5), ($3, $6, 'Acme Consulting & Partner GmbH', $7, $5)`,
			[
				ids.erika,
				ids.organization,
				ids.foreignCustomer,
				ids.adminUser,
				timestamp,
				ids.otherOrganization,
				ids.otherAdminUser,
			],
		);
		actAs(ids.adminUser, ids.organization);
	});

	afterAll(cleanup);

	async function connect() {
		const result = await connectAccountingTool({
			providerKind: "lexware_office",
			apiKey: KEY,
			defaultTaxTreatment: standard,
		});
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	function asJob<T>(data: T) {
		return { data, opts: { attempts: 1 }, attemptsMade: 0 } as unknown as Job<
			ImportScanJobData | AccountingCustomerScanJobData | ImportCommitJobData
		>;
	}

	/** Starts the import as the current actor and runs its scan job. */
	async function importCustomers() {
		const started = await startCustomerImport();
		if (!started.success) throw new Error(started.error);
		const job = harness.scanJobs.pop();
		await processImportReviewJob(asJob(job));
		return started.data.batchId;
	}

	async function commit(batchId: string) {
		const started = await startImportCommitAction({
			organizationId: ids.organization,
			batchId,
		});
		if (!started.success) throw new Error(started.error);
		while (harness.commitJobs.length > 0) {
			await processImportReviewJob(asJob(harness.commitJobs.shift())).catch(() => undefined);
		}
	}

	async function rows(batchId: string) {
		const result = await admin.query<Row>(
			`select id, provider_source_id, row_status, issue_severity, match_target, commit_hold, commit_target_id
			 from import_staged_row where batch_id = $1 order by provider_source_id`,
			[batchId],
		);
		return result.rows;
	}

	async function decide(
		batchId: string,
		rowId: string,
		decision: "accepted" | "rejected",
		choice?: { kind: "link"; targetId: string },
	) {
		const result = await applyImportDecisionAction({
			organizationId: ids.organization,
			batchId,
			rowIds: [rowId],
			decision,
			choice,
		});
		if (!result.success) throw new Error(result.error);
	}

	async function customers() {
		const result = await admin.query<{
			id: string;
			name: string;
			vat_id: string | null;
			email: string | null;
			address: string | null;
		}>(
			"select id, name, vat_id, email, address from customer where organization_id = $1 order by name",
			[ids.organization],
		);
		return result.rows;
	}

	async function links() {
		const result = await admin.query<{
			customer_id: string;
			provider_kind: string;
			account_ref: string;
			contact_id: string;
			contact_number: string | null;
		}>(
			`select customer_id, provider_kind, account_ref, contact_id, contact_number
			 from accounting_contact_link where organization_id = $1 order by contact_number`,
			[ids.organization],
		);
		return result.rows;
	}

	function lexwareContacts(...contacts: unknown[]) {
		lexware.on("GET", "/v1/contacts", {
			status: 200,
			body: contactsPage(contacts, { size: 250 }),
		});
	}

	it("imports Lexware customers: creates linked customers and links a suggested existing one", async () => {
		lexware.on("GET", "/v1/profile", { status: 200, body: profileResponse });
		lexwareContacts(acmeContact, personContact, archivedContact);
		await connect();

		const batchId = await importCustomers();
		const staged = await rows(batchId);
		expect(staged.map((row) => [row.provider_source_id, row.row_status])).toEqual([
			[PERSON_CONTACT_ID, "staged"],
			[ACME_CONTACT_ID, "staged"],
		]);
		const [person, acme] = staged;
		expect(person.match_target).toMatchObject({
			suggestion: { customerId: ids.erika, reason: "name" },
		});
		expect(acme.match_target).toMatchObject({ suggestion: null, nameTakenBy: null });

		await decide(batchId, acme.id, "accepted");
		await decide(batchId, person.id, "accepted", { kind: "link", targetId: ids.erika });
		await commit(batchId);

		const created = (await customers()).find((entry) => entry.name !== "ERIKA ACMEIER");
		expect(await customers()).toHaveLength(2);
		expect(created).toMatchObject({
			name: "Acme Consulting & Partner GmbH",
			vat_id: "DE123456789",
			email: "info@acme.example",
			address: "Gebäude 10\nMusterstraße 42\n79112 Freiburg",
		});
		expect(await links()).toEqual([
			{
				customer_id: created?.id,
				provider_kind: "lexware_office",
				account_ref: LEXWARE_ORGANIZATION_ID,
				contact_id: ACME_CONTACT_ID,
				contact_number: "10307",
			},
			{
				customer_id: ids.erika,
				provider_kind: "lexware_office",
				account_ref: LEXWARE_ORGANIZATION_ID,
				contact_id: PERSON_CONTACT_ID,
				contact_number: "10308",
			},
		]);
		expect((await rows(batchId)).map((row) => [row.row_status, row.commit_target_id])).toEqual([
			["committed", ids.erika],
			["committed", created?.id],
		]);
		const { rows: batch } = await admin.query("select status from import_batch where id = $1", [
			batchId,
		]);
		expect(batch).toEqual([{ status: "completed" }]);
		const { rows: audit } = await admin.query<{ action: string; entity_id: string }>(
			`select action, entity_id from audit_log where organization_id = $1 order by action, entity_id`,
			[ids.organization],
		);
		expect(audit.map((entry) => entry.action)).toEqual(
			expect.arrayContaining([
				"billable_time.contact_link_set",
				"billable_time.contact_link_set",
				"customer.created",
			]),
		);
		// Z8 never writes back to the tool.
		expect(lexware.requests().every((request) => request.method === "GET")).toBe(true);
		expect(
			lexware
				.requests()
				.filter((request) => request.path === "/v1/contacts")
				.map((request) => request.url.search),
		).toEqual(["?customer=true&page=0&size=250"]);

		// Re-running the import offers no contact that is already linked.
		lexwareContacts(acmeContact, personContact, archivedContact);
		const rerun = await importCustomers();
		expect(await rows(rerun)).toEqual([]);
	});

	it("suggests by the customer number of an existing contact link before the name", async () => {
		const tool = createFakeAccountingTool({
			accountRef: "fake-account",
			contacts: [
				{
					id: "f-1",
					customerNumber: "10307",
					name: "Erika Acmeier",
					address: null,
					vatId: null,
				},
			],
		});
		harness.registry = createAccountingProviderRegistry([tool.connector]);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Acme (old books)', $3, now())`,
			[ids.acmeOld, ids.organization, ids.adminUser],
		);
		// A link to another tool account carrying the same customer number.
		await admin.query(
			`insert into accounting_contact_link (organization_id, customer_id, provider_kind, account_ref, contact_id, contact_name, contact_number)
			 values ($1, $2, 'sevdesk', 'old-sevdesk', '17', 'Acme', '10307')`,
			[ids.organization, ids.acmeOld],
		);
		await connect();

		const batchId = await importCustomers();
		expect((await rows(batchId))[0].match_target).toMatchObject({
			suggestion: { customerId: ids.acmeOld, reason: "customer_number" },
			nameTakenBy: { customerId: ids.erika },
		});
	});

	it("never duplicates a customer name: creating over a taken name holds the row without an error", async () => {
		const tool = createFakeAccountingTool({
			contacts: [
				{ id: "f-erika", customerNumber: "1", name: "Erika Acmeier", address: null, vatId: null },
				{ id: "f-late", customerNumber: "2", name: "Late GmbH", address: null, vatId: null },
				{ id: "f-twin-1", customerNumber: "3", name: "Twin AG", address: null, vatId: null },
				{ id: "f-twin-2", customerNumber: "4", name: "TWIN AG", address: null, vatId: null },
			] satisfies AccountingContact[],
		});
		harness.registry = createAccountingProviderRegistry([tool.connector]);
		await connect();
		const batchId = await importCustomers();
		const [erika, late, twin1, twin2] = await rows(batchId);
		expect(twin1.match_target).toMatchObject({ duplicateNameInTool: true });

		// The admin chooses "create new" despite the suggestion; a customer named
		// like another row appears between scan and commit; both twins are created.
		for (const row of [erika, late, twin1, twin2]) await decide(batchId, row.id, "accepted");
		await admin.query(
			`insert into customer (organization_id, name, created_by, updated_at) values ($1, 'late gmbh', $2, now())`,
			[ids.organization, ids.adminUser],
		);
		await commit(batchId);

		const outcome = (row: Row) => [row.row_status, row.commit_hold?.reason];
		const [erikaAfter, lateAfter, ...twins] = await rows(batchId);
		expect(outcome(erikaAfter)).toEqual(["blocked", "customer_name_taken"]);
		expect(outcome(lateAfter)).toEqual(["blocked", "customer_name_taken"]);
		// Whichever twin commits first is created; the other is held.
		expect(twins.map(outcome).sort()).toEqual([
			["blocked", "customer_name_taken"],
			["committed", undefined],
		]);
		const createdTwin = twins.find((row) => row.row_status === "committed");
		const names = (await customers()).map((entry) => entry.name.toLowerCase()).sort();
		expect(names).toEqual(["erika acmeier", "late gmbh", "twin ag"]);
		expect((await links()).map((link) => link.contact_id)).toEqual([
			createdTwin?.provider_source_id,
		]);
	});

	it("holds a link onto a customer that got linked to another contact meanwhile", async () => {
		const tool = createFakeAccountingTool({
			contacts: [
				{ id: "f-erika", customerNumber: "1", name: "Erika Acmeier", address: null, vatId: null },
			],
		});
		harness.registry = createAccountingProviderRegistry([tool.connector]);
		await connect();
		const batchId = await importCustomers();
		const [erika] = await rows(batchId);
		await decide(batchId, erika.id, "accepted", { kind: "link", targetId: ids.erika });
		await admin.query(
			`insert into accounting_contact_link (organization_id, customer_id, provider_kind, account_ref, contact_id, contact_name)
			 values ($1, $2, 'lexware_office', 'fake-account', 'someone-else', 'Someone')`,
			[ids.organization, ids.erika],
		);
		await commit(batchId);

		expect((await rows(batchId))[0]).toMatchObject({
			row_status: "blocked",
			commit_hold: { reason: "customer_already_linked", customerId: ids.erika },
		});
	});

	it("is for org admins and owners of the organization only, and links only its own customers", async () => {
		const tool = createFakeAccountingTool({
			contacts: [{ id: "f-1", customerNumber: null, name: "Solo", address: null, vatId: null }],
		});
		harness.registry = createAccountingProviderRegistry([tool.connector]);
		await connect();
		const batchId = await importCustomers();
		const [row] = await rows(batchId);

		actAs(ids.memberUser, ids.organization);
		await expect(startCustomerImport()).resolves.toMatchObject({ success: false });
		await expect(
			applyImportDecisionAction({
				organizationId: ids.organization,
				batchId,
				rowIds: [row.id],
				decision: "accepted",
			}),
		).resolves.toMatchObject({ success: false });

		// An admin of another organization cannot decide on this batch.
		actAs(ids.otherAdminUser, ids.otherOrganization);
		await expect(
			applyImportDecisionAction({
				organizationId: ids.organization,
				batchId,
				rowIds: [row.id],
				decision: "accepted",
			}),
		).resolves.toMatchObject({ success: false });
		await expect(
			applyImportDecisionAction({
				organizationId: ids.otherOrganization,
				batchId,
				rowIds: [row.id],
				decision: "accepted",
			}),
		).resolves.toMatchObject({ success: false });

		actAs(ids.adminUser, ids.organization);
		await expect(
			applyImportDecisionAction({
				organizationId: ids.organization,
				batchId,
				rowIds: [row.id],
				decision: "accepted",
				choice: { kind: "link", targetId: ids.foreignCustomer },
			}),
		).resolves.toEqual({
			success: false,
			error: "The chosen customer does not exist in this organization",
		});
		expect((await rows(batchId))[0].row_status).toBe("staged");
	});

	it("refuses to start without a connection or with a tool that cannot list customers", async () => {
		await expect(startCustomerImport()).resolves.toMatchObject({
			success: false,
			error: "Connect an accounting tool first",
		});

		const tool = createFakeAccountingTool();
		harness.registry = createAccountingProviderRegistry([
			{
				...tool.connector,
				open: (input) => {
					const { listCustomerContacts: _list, ...provider } = tool.connector.open(input);
					return provider;
				},
			},
		]);
		await connect();
		await expect(startCustomerImport()).resolves.toMatchObject({
			success: false,
			error: "This accounting tool cannot import customers yet",
		});
		const { rows: batches } = await admin.query(
			"select id from import_batch where organization_id = $1",
			[ids.organization],
		);
		expect(batches).toEqual([]);
	});

	async function batchesOf(organizationId: string) {
		const { rows: batches } = await admin.query<{
			status: string;
			error_message: string | null;
			date_range: { startDate: string; endDate: string };
		}>("select status, error_message, date_range from import_batch where organization_id = $1", [
			organizationId,
		]);
		return batches;
	}

	it("records the day the import started in the organization's time zone", async () => {
		await admin.query("update organization set timezone = 'Pacific/Kiritimati' where id = $1", [
			ids.organization,
		]);
		harness.registry = createAccountingProviderRegistry([createFakeAccountingTool().connector]);
		await connect();
		const today = Temporal.Now.zonedDateTimeISO("Pacific/Kiritimati").toPlainDate().toString();

		const started = await startCustomerImport();

		expect(started).toMatchObject({ success: true });
		expect((await batchesOf(ids.organization))[0]?.date_range).toEqual({
			startDate: today,
			endDate: today,
		});
	});

	it("reports a queue failure as such and marks the batch failed", async () => {
		harness.registry = createAccountingProviderRegistry([createFakeAccountingTool().connector]);
		await connect();
		harness.failScanQueue = true;

		const started = await startCustomerImport();

		expect(started).toMatchObject({
			success: false,
			code: "QueueError",
			error: "The customer import could not be started",
		});
		expect(await batchesOf(ids.organization)).toEqual([
			expect.objectContaining({
				status: "scan_failed",
				error_message: "The customer import could not be started",
			}),
		]);
	});
});
