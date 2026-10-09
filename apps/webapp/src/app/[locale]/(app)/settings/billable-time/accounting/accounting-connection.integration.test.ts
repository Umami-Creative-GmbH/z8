/**
 * #903 pass A: accounting connection, contact links and tax treatment on
 * PostgreSQL.
 *
 * The real server actions, stores, constraints and audit trail run against a
 * disposable database. The accounting tools are in-memory fakes registered
 * under the real provider kinds; the organization secret store is an in-memory
 * map; the logger records every call so the suite can prove the API key never
 * reaches a log. Only the request/session, SSO session store and Next cache are
 * replaced besides.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeAccountingTool } from "@/lib/billable-time/accounting/fake-provider";

import type { AccountingProviderRegistry } from "@/lib/billable-time/accounting/registry";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	secrets: new Map<string, string>(),
	logs: [] as string[],
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

vi.mock("@/lib/logger", () => {
	const record =
		(level: string) =>
		(...args: unknown[]) => {
			harness.logs.push(
				`${level} ${JSON.stringify(args, (_key, value) =>
					typeof value === "bigint"
						? value.toString()
						: value instanceof Error
							? String(value)
							: value,
				)}`,
			);
		};
	const logger = {
		error: record("error"),
		warn: record("warn"),
		info: record("info"),
		debug: record("debug"),
		trace: record("trace"),
		fatal: record("fatal"),
	};
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
	connectAccountingTool,
	getAccountingSettings,
	getCustomerAccounting,
	linkCustomerContact,
	removeAccountingTool,
	searchContacts,
	setCustomerTaxTreatment,
	unlinkCustomerContact,
	updateAccountingDefaults,
} = await import("./actions");
const { createFakeAccountingTool, fakeAccountingProviderRegistry } = await import(
	"@/lib/billable-time/accounting/fake-provider"
);
const { getCustomerContactLink, getEffectiveCustomerTaxTreatment } = await import(
	"@/lib/billable-time/accounting/customer-accounting"
);
const { openAccountingProvider, defaultAccountingDependencies } = await import(
	"@/lib/billable-time/accounting/connection-store"
);
const { db } = await import("@/db");

const LEXWARE_KEY = "lx-SECRET-1f2e3d4c5b6a";
const LEXWARE_KEY_ROTATED = "lx-SECRET-rotated-9a8b7c";
const SEVDESK_KEY = "sd-SECRET-0123456789abcdef";

const ids = {
	organization: "t903a-org",
	otherOrganization: "t903a-other-org",
	ownerUser: "t903a-owner-user",
	adminUser: "t903a-admin-user",
	memberUser: "t903a-member-user",
	otherOwnerUser: "t903a-other-owner-user",
	acme: "90300000-0000-4000-8000-000000000001",
	beta: "90300000-0000-4000-8000-000000000002",
	foreignCustomer: "90300000-0000-4000-8000-000000000003",
} as const;
const users = [ids.ownerUser, ids.adminUser, ids.memberUser, ids.otherOwnerUser];

const lexwareContacts = [
	{
		id: "lx-c-1",
		customerNumber: "10001",
		name: "Acme GmbH",
		address: "Hauptstr. 1\n10115 Berlin",
		vatId: "DE123456789",
	},
	{ id: "lx-c-2", customerNumber: "10002", name: "Acme Holding AG", address: null, vatId: null },
];

const standard = { kind: "domestic_standard", rate: "19" } as const;

describe("accounting connection on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let lexware: FakeAccountingTool;
	let sevdesk: FakeAccountingTool;

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

	async function auditEntries(entityType?: string) {
		const { rows } = await admin.query<{
			action: string;
			performed_by: string;
			entity_type: string;
			entity_id: string;
			changes: string;
		}>(
			`select action, performed_by, entity_type, entity_id, changes from audit_log
			 where organization_id = $1 and ($2::text is null or entity_type = $2)
			 order by timestamp, id`,
			[ids.organization, entityType ?? null],
		);
		return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
	}

	async function connections() {
		const { rows } = await admin.query<{
			id: string;
			provider_kind: string;
			status: string;
			account_ref: string;
			default_tax_treatment: string;
			default_tax_rate: string;
		}>(
			`select id, provider_kind, status, account_ref, default_tax_treatment, default_tax_rate
			 from accounting_connection where organization_id = $1 order by connected_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function connectLexware(apiKey = LEXWARE_KEY) {
		const result = await connectAccountingTool({
			providerKind: "lexware_office",
			apiKey,
			defaultTaxTreatment: standard,
		});
		if (!result.success) throw new Error(result.error);
		return result.data;
	}

	/** Every table and column in the database whose text contains `needle`, except the secret store. */
	async function databaseRowsContaining(needle: string) {
		const { rows: tables } = await admin.query<{ table_name: string }>(
			`select table_name from information_schema.tables
			 where table_schema = 'public' and table_type = 'BASE TABLE'
			 and table_name not in ('organization_secret', 'organization_secret_key')`,
		);
		const hits: string[] = [];
		for (const { table_name } of tables) {
			const { rows } = await admin.query<{ count: string }>(
				`select count(*)::text as count from "${table_name}" t where t::text like $1`,
				[`%${needle}%`],
			);
			if (rows[0]?.count !== "0") hits.push(table_name);
		}
		return hits;
	}

	beforeEach(async () => {
		await cleanup();
		harness.secrets.clear();
		harness.logs.length = 0;
		lexware = createFakeAccountingTool({
			kind: "lexware_office",
			contacts: lexwareContacts,
			accountRef: "lexware-org-1",
			accountLabel: "Acme Agency (Lexware)",
			capabilities: { supportedCurrencies: ["EUR"], maxDraftLines: 300 },
		});
		sevdesk = createFakeAccountingTool({
			kind: "sevdesk",
			apiKey: SEVDESK_KEY,
			contacts: [
				{ id: "4711", customerNumber: "K-1", name: "Acme GmbH", address: null, vatId: null },
			],
			accountRef: "sevdesk-client-1",
			accountLabel: null,
		});
		harness.registry = fakeAccountingProviderRegistry(lexware, sevdesk);

		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, projects_enabled, billable_time_enabled, created_at) values
			 ($1, 'T903a', $1, true, true, $3), ($2, 'T903a other', $2, true, true, $3)`,
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
			 ('t903a-m-owner', $1, $3, 'owner', 'approved', $7),
			 ('t903a-m-admin', $1, $4, 'admin', 'approved', $7),
			 ('t903a-m-member', $1, $5, 'member', 'approved', $7),
			 ('t903a-m-other-owner', $2, $6, 'owner', 'approved', $7)`,
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
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $4, 'Acme', $6, $7), ($2, $4, 'Beta', $6, $7), ($3, $5, 'Foreign', $6, $7)`,
			[
				ids.acme,
				ids.beta,
				ids.foreignCustomer,
				ids.organization,
				ids.otherOrganization,
				ids.ownerUser,
				timestamp,
			],
		);
		actAs(ids.adminUser);
	});

	afterAll(cleanup);

	describe("connecting", () => {
		it("connects a tool with the API key only in the organization secret store", async () => {
			const view = await connectLexware();

			expect(view).toMatchObject({
				providerKind: "lexware_office",
				accountLabel: "Acme Agency (Lexware)",
				defaultTaxTreatment: { kind: "domestic_standard", rate: "19.00" },
				apiKeyStored: true,
				providerAvailable: true,
				capabilities: { maxDraftLines: 300, supportedCurrencies: ["EUR"] },
			});
			expect(harness.secrets).toEqual(
				new Map([[`${ids.organization}|accounting/${view.id}/api_key`, LEXWARE_KEY]]),
			);
			expect(await connections()).toEqual([
				expect.objectContaining({
					id: view.id,
					provider_kind: "lexware_office",
					status: "active",
					account_ref: "lexware-org-1",
					default_tax_treatment: "domestic_standard",
					default_tax_rate: "19.00",
				}),
			]);
			expect(await auditEntries("accounting_connection")).toEqual([
				expect.objectContaining({
					action: "billable_time.accounting_connection_created",
					performed_by: ids.adminUser,
					entity_id: view.id,
					changes: expect.objectContaining({
						providerKind: { from: null, to: "lexware_office" },
						defaultTaxTreatment: { from: null, to: { kind: "domestic_standard", rate: "19.00" } },
					}),
				}),
			]);

			const settings = await getAccountingSettings();
			expect(settings).toMatchObject({
				success: true,
				data: {
					currency: "EUR",
					connection: { id: view.id, apiKeyStored: true },
					providers: [
						{ kind: "lexware_office", available: true },
						{ kind: "sevdesk", available: true },
					],
					customers: [
						{ customerId: ids.acme, name: "Acme", contactLink: null, taxOverride: null },
						{ customerId: ids.beta, name: "Beta", contactLink: null, taxOverride: null },
					],
				},
			});
		});

		it("opens the provider with the stored key for later hand-offs", async () => {
			await connectLexware();
			const opened = await openAccountingProvider(
				db,
				defaultAccountingDependencies(),
				ids.organization,
			);
			expect(opened).toMatchObject({ ok: true, connection: { providerKind: "lexware_office" } });
			expect(lexware.openedWithKeys()).toEqual([LEXWARE_KEY]);
		});

		it("lets the connector refuse a connection, storing nothing", async () => {
			actAs(ids.otherOwnerUser, ids.otherOrganization);
			await expect(
				connectAccountingTool({
					providerKind: "lexware_office",
					apiKey: LEXWARE_KEY,
					defaultTaxTreatment: standard,
				}),
			).resolves.toEqual({
				success: false,
				error: "This accounting tool cannot take drafts in CHF",
				code: "ValidationError",
			});
			expect(harness.secrets.size).toBe(0);
			const { rows } = await admin.query(
				"select id from accounting_connection where organization_id = $1",
				[ids.otherOrganization],
			);
			expect(rows).toEqual([]);
		});

		it("refuses a key the tool rejects, and invalid input, storing nothing", async () => {
			await expect(
				connectAccountingTool({
					providerKind: "sevdesk",
					apiKey: "wrong",
					defaultTaxTreatment: standard,
				}),
			).resolves.toMatchObject({
				success: false,
				error: "The accounting tool refused this API key",
			});
			await expect(
				connectAccountingTool({
					providerKind: "sevdesk",
					apiKey: "  ",
					defaultTaxTreatment: standard,
				}),
			).resolves.toMatchObject({ success: false, error: "Enter the API key" });
			await expect(
				connectAccountingTool({
					providerKind: "sevdesk",
					apiKey: SEVDESK_KEY,
					defaultTaxTreatment: { kind: "eu_reverse_charge", rate: "19" },
				}),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
			await expect(
				connectAccountingTool({
					providerKind: "datev",
					apiKey: SEVDESK_KEY,
					defaultTaxTreatment: standard,
				}),
			).resolves.toMatchObject({ success: false, error: "Choose an accounting tool" });
			expect(harness.secrets.size).toBe(0);
			expect(await connections()).toEqual([]);
			expect(await auditEntries()).toEqual([]);
		});

		it("refuses a tool without a connector in this installation", async () => {
			harness.registry = fakeAccountingProviderRegistry(sevdesk);
			await expect(connectLexware()).rejects.toThrow("This accounting tool can't be connected yet");
			await expect(getAccountingSettings()).resolves.toMatchObject({
				success: true,
				data: {
					providers: [
						{ kind: "lexware_office", available: false, capabilities: null },
						{ kind: "sevdesk", available: true },
					],
				},
			});
		});

		it("replaces the connection: one active, the old key deleted, audited from and to", async () => {
			const first = await connectLexware();
			const second = await connectAccountingTool({
				providerKind: "sevdesk",
				apiKey: SEVDESK_KEY,
				defaultTaxTreatment: { kind: "domestic_reduced", rate: "7" },
			});
			if (!second.success) throw new Error(second.error);

			expect((await connections()).map((row) => [row.id, row.provider_kind, row.status])).toEqual([
				[first.id, "lexware_office", "replaced"],
				[second.data.id, "sevdesk", "active"],
			]);
			expect([...harness.secrets.entries()]).toEqual([
				[`${ids.organization}|accounting/${second.data.id}/api_key`, SEVDESK_KEY],
			]);
			expect((await auditEntries("accounting_connection")).at(-1)).toMatchObject({
				action: "billable_time.accounting_connection_replaced",
				entity_id: second.data.id,
				changes: {
					providerKind: { from: "lexware_office", to: "sevdesk" },
					defaultTaxTreatment: {
						from: { kind: "domestic_standard", rate: "19.00" },
						to: { kind: "domestic_reduced", rate: "7.00" },
					},
				},
			});
		});

		it("lets the database hold at most one active connection per organization", async () => {
			await connectLexware();
			await expect(
				admin.query(
					`insert into accounting_connection (organization_id, provider_kind, account_ref, default_tax_treatment, default_tax_rate)
					 values ($1, 'sevdesk', 'x', 'vat_free', 0)`,
					[ids.organization],
				),
			).rejects.toMatchObject({ code: "23505" });
			await expect(
				admin.query(
					`insert into accounting_connection (organization_id, provider_kind, account_ref, default_tax_treatment, default_tax_rate)
					 values ($1, 'sevdesk', 'x', 'eu_reverse_charge', 19)`,
					[ids.otherOrganization],
				),
			).rejects.toMatchObject({ code: "23514" });
		});

		it("changes the default tax treatment, audited only when it changes", async () => {
			const view = await connectLexware();
			await expect(
				updateAccountingDefaults({
					connectionId: view.id,
					defaultTaxTreatment: { kind: "domestic_standard", rate: "19.00" },
				}),
			).resolves.toMatchObject({ success: true });
			await expect(
				updateAccountingDefaults({
					connectionId: view.id,
					defaultTaxTreatment: { kind: "third_country_service", rate: "" },
				}),
			).resolves.toMatchObject({
				success: true,
				data: { defaultTaxTreatment: { kind: "third_country_service", rate: "0.00" } },
			});
			const updates = (await auditEntries("accounting_connection")).filter(
				(entry) => entry.action === "billable_time.accounting_connection_updated",
			);
			expect(updates).toEqual([
				expect.objectContaining({
					changes: {
						defaultTaxTreatment: {
							from: { kind: "domestic_standard", rate: "19.00" },
							to: { kind: "third_country_service", rate: "0.00" },
						},
					},
				}),
			]);
		});

		it("removes the connection, deletes its key and audits it", async () => {
			const view = await connectLexware();
			await expect(removeAccountingTool({ connectionId: view.id })).resolves.toEqual({
				success: true,
				data: { removed: true },
			});
			expect(harness.secrets.size).toBe(0);
			expect((await connections()).map((row) => row.status)).toEqual(["removed"]);
			expect((await auditEntries("accounting_connection")).at(-1)).toMatchObject({
				action: "billable_time.accounting_connection_removed",
				entity_id: view.id,
			});
			await expect(getAccountingSettings()).resolves.toMatchObject({
				success: true,
				data: { connection: null },
			});
			await expect(searchContacts({ query: "acme" })).resolves.toMatchObject({
				success: false,
				error: "Connect an accounting tool first",
			});
			await expect(removeAccountingTool({ connectionId: view.id })).resolves.toMatchObject({
				success: false,
			});
		});
	});

	describe("contact links", () => {
		it("searches the tool's contacts through the port", async () => {
			await connectLexware();
			await expect(searchContacts({ query: " acme " })).resolves.toEqual({
				success: true,
				data: { contacts: lexwareContacts, truncated: false },
			});
			await expect(searchContacts({ query: "ac" })).resolves.toMatchObject({
				success: false,
				error: "Enter at least 3 characters",
			});
			lexware.failNext("searchContacts", "not_performed");
			await expect(searchContacts({ query: "acme" })).resolves.toMatchObject({
				success: false,
				error: expect.stringContaining("The accounting tool could not be reached"),
			});
		});

		it("links a customer to an existing contact and audits every change of the link", async () => {
			await connectLexware();
			await expect(
				linkCustomerContact({ customerId: ids.acme, contactId: "lx-c-1" }),
			).resolves.toMatchObject({
				success: true,
				data: {
					customer: {
						customerId: ids.acme,
						contactLink: { contactId: "lx-c-1", contactName: "Acme GmbH", contactNumber: "10001" },
					},
					connection: { providerKind: "lexware_office" },
				},
			});
			// The same contact again changes nothing.
			await linkCustomerContact({ customerId: ids.acme, contactId: "lx-c-1" });
			await linkCustomerContact({ customerId: ids.acme, contactId: "lx-c-2" });
			await expect(unlinkCustomerContact({ customerId: ids.acme })).resolves.toMatchObject({
				success: true,
				data: { customer: { contactLink: null } },
			});

			expect(
				(await auditEntries("accounting_contact_link")).map((entry) => ({
					action: entry.action,
					entity: entry.entity_id,
					contact: entry.changes.contact,
				})),
			).toEqual([
				{
					action: "billable_time.contact_link_set",
					entity: ids.acme,
					contact: { from: null, to: { contactId: "lx-c-1", name: "Acme GmbH", number: "10001" } },
				},
				{
					action: "billable_time.contact_link_set",
					entity: ids.acme,
					contact: {
						from: { contactId: "lx-c-1", name: "Acme GmbH", number: "10001" },
						to: { contactId: "lx-c-2", name: "Acme Holding AG", number: "10002" },
					},
				},
				{
					action: "billable_time.contact_link_removed",
					entity: ids.acme,
					contact: {
						from: { contactId: "lx-c-2", name: "Acme Holding AG", number: "10002" },
						to: null,
					},
				},
			]);
			// Z8 never creates contacts in the tool.
			expect(lexware.drafts()).toEqual([]);
		});

		it("refuses a contact the tool does not know and a customer of another organization", async () => {
			await connectLexware();
			await expect(
				linkCustomerContact({ customerId: ids.acme, contactId: "lx-c-404" }),
			).resolves.toMatchObject({
				success: false,
				error: "The contact was not found in the accounting tool",
				code: "NotFoundError",
			});
			await expect(
				linkCustomerContact({ customerId: ids.foreignCustomer, contactId: "lx-c-1" }),
			).resolves.toMatchObject({ success: false, code: "NotFoundError" });
			await expect(
				getCustomerAccounting({ customerId: ids.foreignCustomer }),
			).resolves.toMatchObject({ success: false, code: "NotFoundError" });
			await expect(
				admin.query(
					`insert into accounting_contact_link (organization_id, customer_id, provider_kind, account_ref, contact_id, contact_name)
					 values ($1, $2, 'lexware_office', 'x', 'c', 'n')`,
					[ids.organization, ids.foreignCustomer],
				),
			).rejects.toMatchObject({ code: "23503" });
			expect(await auditEntries("accounting_contact_link")).toEqual([]);
		});

		it("keeps links for the same tool account and hides them for another account", async () => {
			await connectLexware();
			await linkCustomerContact({ customerId: ids.acme, contactId: "lx-c-1" });

			// A rotated key of the same Lexware account keeps the link.
			await connectLexware(LEXWARE_KEY_ROTATED);
			await expect(getCustomerContactLink(db, ids.organization, ids.acme)).resolves.toMatchObject({
				contactId: "lx-c-1",
			});

			// sevdesk contact ids mean nothing to Lexware and vice versa.
			await connectAccountingTool({
				providerKind: "sevdesk",
				apiKey: SEVDESK_KEY,
				defaultTaxTreatment: standard,
			});
			await expect(getCustomerContactLink(db, ids.organization, ids.acme)).resolves.toBeNull();

			await connectLexware();
			await expect(getCustomerContactLink(db, ids.organization, ids.acme)).resolves.toMatchObject({
				contactId: "lx-c-1",
			});
		});
	});

	describe("tax treatment", () => {
		it("uses the connection default unless the customer overrides it, audited", async () => {
			await connectLexware();
			await expect(
				getEffectiveCustomerTaxTreatment(db, ids.organization, ids.acme),
			).resolves.toEqual({
				kind: "domestic_standard",
				rateBasisPoints: 1900,
				source: "connection",
			});

			await expect(
				setCustomerTaxTreatment({
					customerId: ids.acme,
					taxTreatment: { kind: "eu_reverse_charge", rate: "0" },
				}),
			).resolves.toMatchObject({
				success: true,
				data: { customer: { taxOverride: { kind: "eu_reverse_charge", rate: "0.00" } } },
			});
			await expect(
				getEffectiveCustomerTaxTreatment(db, ids.organization, ids.acme),
			).resolves.toEqual({
				kind: "eu_reverse_charge",
				rateBasisPoints: 0,
				source: "customer",
			});
			await expect(
				getEffectiveCustomerTaxTreatment(db, ids.organization, ids.beta),
			).resolves.toMatchObject({ source: "connection" });

			await setCustomerTaxTreatment({ customerId: ids.acme, taxTreatment: null });
			await setCustomerTaxTreatment({ customerId: ids.acme, taxTreatment: null });
			await expect(
				getEffectiveCustomerTaxTreatment(db, ids.organization, ids.acme),
			).resolves.toMatchObject({ source: "connection" });

			expect(
				(await auditEntries("customer_tax_treatment")).map((entry) => [
					entry.action,
					entry.changes,
				]),
			).toEqual([
				[
					"billable_time.customer_tax_treatment_set",
					{ customerId: ids.acme, from: null, to: { kind: "eu_reverse_charge", rate: "0.00" } },
				],
				[
					"billable_time.customer_tax_treatment_cleared",
					{ customerId: ids.acme, from: { kind: "eu_reverse_charge", rate: "0.00" }, to: null },
				],
			]);
		});

		it("refuses an inconsistent override", async () => {
			await expect(
				setCustomerTaxTreatment({
					customerId: ids.acme,
					taxTreatment: { kind: "vat_free", rate: "19" },
				}),
			).resolves.toMatchObject({ success: false, code: "ValidationError" });
			await expect(
				admin.query(
					`insert into customer_tax_treatment (customer_id, organization_id, tax_treatment, tax_rate) values ($1, $2, 'domestic_standard', 0)`,
					[ids.acme, ids.organization],
				),
			).rejects.toMatchObject({ code: "23514" });
		});
	});

	describe("access", () => {
		it("lets only owners and admins use the connection, contact link and tax actions", async () => {
			actAs(ids.ownerUser);
			const view = await connectLexware();

			actAs(ids.memberUser);
			const refused = { success: false, code: "AuthorizationError" };
			await expect(getAccountingSettings()).resolves.toMatchObject(refused);
			await expect(
				connectAccountingTool({
					providerKind: "lexware_office",
					apiKey: LEXWARE_KEY,
					defaultTaxTreatment: standard,
				}),
			).resolves.toMatchObject(refused);
			await expect(
				updateAccountingDefaults({ connectionId: view.id, defaultTaxTreatment: standard }),
			).resolves.toMatchObject(refused);
			await expect(removeAccountingTool({ connectionId: view.id })).resolves.toMatchObject(refused);
			await expect(searchContacts({ query: "acme" })).resolves.toMatchObject(refused);
			await expect(getCustomerAccounting({ customerId: ids.acme })).resolves.toMatchObject(refused);
			await expect(
				linkCustomerContact({ customerId: ids.acme, contactId: "lx-c-1" }),
			).resolves.toMatchObject(refused);
			await expect(unlinkCustomerContact({ customerId: ids.acme })).resolves.toMatchObject(refused);
			await expect(
				setCustomerTaxTreatment({ customerId: ids.acme, taxTreatment: null }),
			).resolves.toMatchObject(refused);
		});

		it("acts on the active organization only", async () => {
			const view = await connectLexware();
			actAs(ids.otherOwnerUser, ids.otherOrganization);
			await expect(getAccountingSettings()).resolves.toMatchObject({
				success: true,
				data: { connection: null, customers: [{ customerId: ids.foreignCustomer }] },
			});
			await expect(removeAccountingTool({ connectionId: view.id })).resolves.toMatchObject({
				success: false,
			});
			await expect(
				setCustomerTaxTreatment({ customerId: ids.acme, taxTreatment: null }),
			).resolves.toMatchObject({ success: false, code: "NotFoundError" });
			expect((await connections()).map((row) => row.status)).toEqual(["active"]);
		});

		it("refuses everything while the module is off", async () => {
			await admin.query("update organization set billable_time_enabled = false where id = $1", [
				ids.organization,
			]);
			const off = { success: false, error: "Billable Time is switched off" };
			await expect(getAccountingSettings()).resolves.toMatchObject(off);
			await expect(
				connectAccountingTool({
					providerKind: "lexware_office",
					apiKey: LEXWARE_KEY,
					defaultTaxTreatment: standard,
				}),
			).resolves.toMatchObject(off);
			await expect(
				setCustomerTaxTreatment({ customerId: ids.acme, taxTreatment: null }),
			).resolves.toMatchObject(off);
			expect(harness.secrets.size).toBe(0);
		});
	});

	it("never puts an API key into a database row outside the secret store, a log or an audit entry", async () => {
		const first = await connectLexware();
		await linkCustomerContact({ customerId: ids.acme, contactId: "lx-c-1" });
		await setCustomerTaxTreatment({
			customerId: ids.beta,
			taxTreatment: { kind: "vat_free", rate: "" },
		});
		await updateAccountingDefaults({
			connectionId: first.id,
			defaultTaxTreatment: { kind: "domestic_reduced", rate: "7" },
		});
		await connectLexware(LEXWARE_KEY_ROTATED);
		await connectAccountingTool({
			providerKind: "sevdesk",
			apiKey: "sd-SECRET-wrong",
			defaultTaxTreatment: standard,
		});
		const sevdeskView = await connectAccountingTool({
			providerKind: "sevdesk",
			apiKey: SEVDESK_KEY,
			defaultTaxTreatment: standard,
		});
		if (!sevdeskView.success) throw new Error(sevdeskView.error);
		await removeAccountingTool({ connectionId: sevdeskView.data.id });

		// Positive controls: the scanners do find what is stored and logged.
		expect(await databaseRowsContaining("lexware-org-1")).toEqual(
			expect.arrayContaining(["accounting_connection", "accounting_contact_link", "audit_log"]),
		);
		expect(harness.logs.some((line) => line.includes(sevdeskView.data.id))).toBe(true);
		for (const key of [LEXWARE_KEY, LEXWARE_KEY_ROTATED, SEVDESK_KEY, "sd-SECRET-wrong"]) {
			expect(await databaseRowsContaining(key)).toEqual([]);
			expect(harness.logs.filter((line) => line.includes(key))).toEqual([]);
		}
		expect(await databaseRowsContaining("SECRET")).toEqual([]);
	});
});
