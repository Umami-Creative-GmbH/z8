/**
 * #904: the real Lexware Office connector behind the real accounting settings
 * actions, on PostgreSQL. Lexware itself is the scripted stand-in replaying
 * recorded Public API fixtures; the organization secret store is an in-memory
 * map and the logger records every call, so the suite can prove where the API
 * key goes. Only the request/session, SSO session store and Next cache are
 * replaced besides.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountingProviderRegistry } from "@/lib/billable-time/accounting/registry";
import { integrationAdminPool } from "@/test/integration-database";
import {
	ACME_CONTACT_ID,
	acmeContact,
	contactsPage,
	LEXWARE_ORGANIZATION_ID,
	profileResponse,
	unauthorizedResponse,
} from "./__fixtures__/lexware-public-api";
import { type ScriptedLexware, scriptedLexware } from "./__fixtures__/scripted-lexware";

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
		if (!harness.registry) throw new Error("No registry");
		return harness.registry;
	},
}));

const { connectAccountingTool, linkCustomerContact, searchContacts } = await import(
	"@/app/[locale]/(app)/settings/billable-time/accounting/actions"
);
const { createAccountingProviderRegistry } = await import(
	"@/lib/billable-time/accounting/registry"
);
const { createLexwareOfficeConnector } = await import("./connector");

const LEXWARE_KEY = "lx-SECRET-904-7f6e5d4c3b2a";

const ids = {
	organization: "t904-org",
	chfOrganization: "t904-chf-org",
	adminUser: "t904-admin-user",
	chfAdminUser: "t904-chf-admin-user",
	acme: "90400000-0000-4000-8000-000000000001",
} as const;
const users = [ids.adminUser, ids.chfAdminUser];

const standard = { kind: "domestic_standard", rate: "19" } as const;

describe("Lexware Office connection on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let lexware: ScriptedLexware;

	function actAs(userId: string, organizationId: string) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.chfOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	/** Every table whose rows contain `needle` as text, except the secret store. */
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
		lexware = scriptedLexware();
		harness.registry = createAccountingProviderRegistry([
			createLexwareOfficeConnector({
				fetch: lexware.fetch,
				sleep: lexware.time.sleep,
				monotonicNow: lexware.time.now,
			}),
		]);

		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, projects_enabled, billable_time_enabled, created_at) values
			 ($1, 'T904', $1, true, true, $3), ($2, 'T904 CHF', $2, true, true, $3)`,
			[ids.organization, ids.chfOrganization, timestamp],
		);
		await admin.query(
			`insert into billable_time_settings (organization_id, billable_currency) values ($1, 'EUR'), ($2, 'CHF')`,
			[ids.organization, ids.chfOrganization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t904-m-admin', $1, $3, 'admin', 'approved', $5),
			 ('t904-m-chf-admin', $2, $4, 'admin', 'approved', $5)`,
			[ids.organization, ids.chfOrganization, ids.adminUser, ids.chfAdminUser, timestamp],
		);
		await admin.query(
			`insert into customer (id, organization_id, name, created_by, updated_at) values
			 ($1, $2, 'Acme', $3, $4)`,
			[ids.acme, ids.organization, ids.adminUser, timestamp],
		);
		actAs(ids.adminUser, ids.organization);
	});

	afterAll(cleanup);

	it("connects Lexware Office: the account from the profile, the key only in the secret store", async () => {
		lexware.on("GET", "/v1/profile", { status: 200, body: profileResponse });

		const result = await connectAccountingTool({
			providerKind: "lexware_office",
			apiKey: LEXWARE_KEY,
			defaultTaxTreatment: standard,
		});
		expect(result).toMatchObject({
			success: true,
			data: {
				providerKind: "lexware_office",
				accountLabel: "Musterfirma Beratung GmbH",
				apiKeyStored: true,
				capabilities: { maxDraftLines: 300, supportedCurrencies: ["EUR"] },
			},
		});
		if (!result.success) throw new Error(result.error);

		const { rows } = await admin.query<{ account_ref: string }>(
			"select account_ref from accounting_connection where organization_id = $1",
			[ids.organization],
		);
		expect(rows).toEqual([{ account_ref: LEXWARE_ORGANIZATION_ID }]);
		expect(harness.secrets).toEqual(
			new Map([[`${ids.organization}|accounting/${result.data.id}/api_key`, LEXWARE_KEY]]),
		);
		expect(lexware.requests().map((request) => request.headers.authorization)).toEqual([
			`Bearer ${LEXWARE_KEY}`,
		]);
	});

	it("searches and links a Lexware contact with the stored key; the key reaches no row or log", async () => {
		lexware.on("GET", "/v1/profile", { status: 200, body: profileResponse });
		lexware.on("GET", `/v1/contacts/${ACME_CONTACT_ID}`, { status: 200, body: acmeContact });
		lexware.on("GET", "/v1/contacts", { status: 200, body: contactsPage([acmeContact]) });
		await connectAccountingTool({
			providerKind: "lexware_office",
			apiKey: LEXWARE_KEY,
			defaultTaxTreatment: standard,
		});

		await expect(searchContacts({ query: "acme" })).resolves.toMatchObject({
			success: true,
			data: {
				contacts: [
					{ id: ACME_CONTACT_ID, customerNumber: "10307", name: "Acme Consulting & Partner GmbH" },
				],
				truncated: false,
			},
		});
		await expect(
			linkCustomerContact({ customerId: ids.acme, contactId: ACME_CONTACT_ID }),
		).resolves.toMatchObject({ success: true });

		const { rows } = await admin.query<{ contact_id: string; contact_number: string }>(
			"select contact_id, contact_number from accounting_contact_link where organization_id = $1",
			[ids.organization],
		);
		expect(rows).toEqual([{ contact_id: ACME_CONTACT_ID, contact_number: "10307" }]);
		expect(
			lexware
				.requests()
				.every((request) => request.headers.authorization === `Bearer ${LEXWARE_KEY}`),
		).toBe(true);
		expect(await databaseRowsContaining(LEXWARE_KEY)).toEqual([]);
		expect(harness.logs.some((line) => line.includes(LEXWARE_KEY))).toBe(false);
		// Positive control: the scan finds what is there.
		expect(await databaseRowsContaining(LEXWARE_ORGANIZATION_ID)).toContain(
			"accounting_connection",
		);
	});

	it("refuses to connect an organization whose billable currency is not EUR, storing nothing", async () => {
		actAs(ids.chfAdminUser, ids.chfOrganization);

		await expect(
			connectAccountingTool({
				providerKind: "lexware_office",
				apiKey: LEXWARE_KEY,
				defaultTaxTreatment: standard,
			}),
		).resolves.toMatchObject({ success: false, error: expect.stringContaining("EUR") });
		expect(harness.secrets.size).toBe(0);
		expect(lexware.requests()).toHaveLength(0);
		const { rows } = await admin.query(
			"select id from accounting_connection where organization_id = $1",
			[ids.chfOrganization],
		);
		expect(rows).toEqual([]);
	});

	it("refuses a key Lexware rejects, storing nothing", async () => {
		lexware.on("GET", "/v1/profile", { status: 401, body: unauthorizedResponse });

		await expect(
			connectAccountingTool({
				providerKind: "lexware_office",
				apiKey: LEXWARE_KEY,
				defaultTaxTreatment: standard,
			}),
		).resolves.toMatchObject({ success: false, error: "The accounting tool refused this API key" });
		expect(harness.secrets.size).toBe(0);
		expect(await databaseRowsContaining(LEXWARE_KEY)).toEqual([]);
	});
});
