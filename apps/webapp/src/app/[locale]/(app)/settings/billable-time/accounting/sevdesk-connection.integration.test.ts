/**
 * #905: connecting sevdesk on PostgreSQL. The real server actions, connection
 * store and sevdesk connector run against a disposable database; only sevdesk
 * itself is replaced by recorded fixtures (`sevdesk/fixtures.ts`) behind the
 * connector's `fetch`. The organization secret store is an in-memory map and the
 * logger records every call, so the suite can prove the token lives only in the
 * secret store and that unsupported account setups store nothing.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountingProviderRegistry } from "@/lib/billable-time/accounting/registry";
import type { FixtureRoute } from "@/lib/billable-time/accounting/sevdesk/fixtures";
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
		if (!harness.registry) throw new Error("No registry");
		return harness.registry;
	},
}));

const { connectAccountingTool, listAccountingContactPersons } = await import("./actions");
const { createAccountingProviderRegistry } = await import(
	"@/lib/billable-time/accounting/registry"
);
const { createSevdeskConnector } = await import("@/lib/billable-time/accounting/sevdesk/connector");
const fixtures = await import("@/lib/billable-time/accounting/sevdesk/fixtures");
const { openAccountingProvider, defaultAccountingDependencies } = await import(
	"@/lib/billable-time/accounting/connection-store"
);
const { buildInvoiceDraft, workLine } = await import(
	"@/lib/billable-time/accounting/invoice-draft"
);
const { db } = await import("@/db");

const TOKEN = fixtures.TOKEN;

const ids = {
	organization: "t905-org",
	chfOrganization: "t905-chf-org",
	adminUser: "t905-admin-user",
	memberUser: "t905-member-user",
	chfOwnerUser: "t905-chf-owner-user",
} as const;
const users = [ids.adminUser, ids.memberUser, ids.chfOwnerUser];

const standard = { kind: "domestic_standard", rate: "19" } as const;

describe("sevdesk connection on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let http: ReturnType<typeof fixtures.fixtureFetch>;

	function useSevdesk(routes: FixtureRoute[]) {
		http = fixtures.fixtureFetch(routes);
		harness.registry = createAccountingProviderRegistry([
			createSevdeskConnector({
				fetch: http.fetch,
				sleep: async () => undefined,
				clock: { nowInstant: () => Temporal.Instant.from("2026-10-09T08:00:00Z") },
			}),
		]);
	}

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.chfOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function connectionRows(organizationId: string = ids.organization) {
		const { rows } = await admin.query<{
			id: string;
			provider_kind: string;
			status: string;
			account_ref: string;
			account_label: string | null;
			settings: Record<string, unknown>;
		}>(
			`select id, provider_kind, status, account_ref, account_label, settings
			 from accounting_connection where organization_id = $1 order by connected_at, id`,
			[organizationId],
		);
		return rows;
	}

	/** Every table in the database whose rows contain `needle`, except the secret store. */
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
		useSevdesk(fixtures.setupRoutes());

		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, projects_enabled, billable_time_enabled, created_at) values
			 ($1, 'T905', $1, true, true, $3), ($2, 'T905 CHF', $2, true, true, $3)`,
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
			 ('t905-m-admin', $1, $3, 'admin', 'approved', $6),
			 ('t905-m-member', $1, $4, 'member', 'approved', $6),
			 ('t905-m-chf-owner', $2, $5, 'owner', 'approved', $6)`,
			[
				ids.organization,
				ids.chfOrganization,
				ids.adminUser,
				ids.memberUser,
				ids.chfOwnerUser,
				timestamp,
			],
		);
		actAs(ids.adminUser);
	});

	afterAll(cleanup);

	it("connects sevdesk with the token only in the secret store and the setup in the connection", async () => {
		useSevdesk(
			fixtures.setupRoutes({
				users: [
					{ id: "501", fullname: "Anna Buchhaltung" },
					{ id: "502", fullname: "Ben Inhaber" },
				],
			}),
		);

		const persons = await listAccountingContactPersons({ providerKind: "sevdesk", apiKey: TOKEN });
		expect(persons).toEqual({
			success: true,
			data: [
				{ id: "501", name: "Anna Buchhaltung" },
				{ id: "502", name: "Ben Inhaber" },
			],
		});
		expect(harness.secrets.size).toBe(0);

		const result = await connectAccountingTool({
			providerKind: "sevdesk",
			apiKey: TOKEN,
			defaultTaxTreatment: standard,
			settings: { contactPersonId: "502", netPrices: true },
		});
		if (!result.success) throw new Error(result.error);

		expect(result.data).toMatchObject({
			providerKind: "sevdesk",
			apiKeyStored: true,
			providerAvailable: true,
			capabilities: { supportedCurrencies: ["EUR", "CHF", "USD", "GBP"], draftStatusCheck: true },
		});
		expect(harness.secrets).toEqual(
			new Map([[`${ids.organization}|accounting/${result.data.id}/api_key`, TOKEN]]),
		);
		expect(await connectionRows()).toEqual([
			expect.objectContaining({
				provider_kind: "sevdesk",
				status: "active",
				account_ref: fixtures.SEV_CLIENT_ID,
				settings: {
					bookkeepingSystemVersion: "2.0",
					prices: "net",
					contactPersonId: "502",
					contactPersonName: "Ben Inhaber",
					hourUnityId: "9",
				},
			}),
		]);
		expect(await databaseRowsContaining(TOKEN)).toEqual([]);
		expect(harness.logs.join("\n")).not.toContain(TOKEN);
		for (const request of http.requests) expect(request.query.toString()).not.toContain(TOKEN);
	});

	it("creates drafts with the stored contact person and hour unit through the opened provider", async () => {
		const connected = await connectAccountingTool({
			providerKind: "sevdesk",
			apiKey: TOKEN,
			defaultTaxTreatment: standard,
			settings: { netPrices: true },
		});
		if (!connected.success) throw new Error(connected.error);
		useSevdesk([
			{ method: "GET", path: "/Invoice", responses: [{ status: 200, body: { objects: [] } }] },
			{
				method: "POST",
				path: "/Invoice/Factory/saveInvoice",
				responses: [
					(request) => ({
						status: 201,
						body: fixtures.savedInvoice({
							id: "9001",
							customerInternalNote: JSON.parse(request.bodyText ?? "{}").invoice
								.customerInternalNote,
							sumNet: "95",
						}),
					}),
				],
			},
		]);

		const opened = await openAccountingProvider(
			db,
			defaultAccountingDependencies(),
			ids.organization,
		);
		if (!opened.ok) throw new Error(opened.reason);
		const draft = buildInvoiceDraft({
			contactId: "1001",
			currency: "EUR",
			taxTreatment: { kind: "domestic_standard", rateBasisPoints: 1900 },
			servicePeriod: {
				from: Temporal.PlainDate.from("2026-09-01"),
				to: Temporal.PlainDate.from("2026-09-30"),
			},
			title: "Leistungen September 2026",
			introduction: null,
			remark: null,
			lines: [
				workLine({
					projectId: "p-1",
					projectName: "Website",
					text: "Website, 1.00 h",
					durationMs: 3_600_000,
					unitPrice: BigInt(9500),
				}),
			],
		});
		if (!draft.ok) throw new Error(draft.problem);

		await expect(
			opened.provider.createInvoiceDraft(draft.draft, { idempotencyKey: "t905-handoff-1" }),
		).resolves.toEqual({ externalId: "9001", externalUrl: null });
		const [save] = http.to("POST", "/Invoice/Factory/saveInvoice");
		const body = JSON.parse(save.bodyText ?? "{}");
		expect(body.invoice.contactPerson).toEqual({ id: 501, objectName: "SevUser" });
		expect(body.invoicePosSave[0].unity).toEqual({ id: 9, objectName: "Unity" });
		expect(save.headers.authorization).toBe(TOKEN);
	});

	it.each([
		[
			"the old tax system",
			fixtures.setupRoutes({ version: "1.0" }),
			{ netPrices: true },
			"sevdesk-Update 2.0",
		],
		["gross prices", fixtures.setupRoutes(), { netPrices: false }, "net prices"],
		[
			"several users and no choice",
			fixtures.setupRoutes({
				users: [
					{ id: "501", fullname: "Anna Buchhaltung" },
					{ id: "502", fullname: "Ben Inhaber" },
				],
			}),
			{ netPrices: true },
			"contact person",
		],
		["no hour unit", fixtures.setupRoutes({ withHour: false }), { netPrices: true }, "hour unit"],
	] as const)(
		"refuses an account with %s and stores nothing",
		async (_case, routes, settings, message) => {
			useSevdesk([...routes]);

			const result = await connectAccountingTool({
				providerKind: "sevdesk",
				apiKey: TOKEN,
				defaultTaxTreatment: standard,
				settings: { ...settings },
			});

			expect(result).toMatchObject({ success: false, error: expect.stringContaining(message) });
			expect(harness.secrets.size).toBe(0);
			expect(await connectionRows()).toEqual([]);
		},
	);

	it("connects an organization whose billable currency is not EUR (EUR-only is Lexware's rule)", async () => {
		actAs(ids.chfOwnerUser, ids.chfOrganization);

		const result = await connectAccountingTool({
			providerKind: "sevdesk",
			apiKey: TOKEN,
			defaultTaxTreatment: standard,
			settings: { netPrices: true },
		});

		expect(result).toMatchObject({ success: true, data: { providerKind: "sevdesk" } });
		expect(await connectionRows(ids.chfOrganization)).toEqual([
			expect.objectContaining({ provider_kind: "sevdesk", status: "active" }),
		]);
	});

	it("refuses a token sevdesk does not accept", async () => {
		useSevdesk([
			{
				method: "GET",
				path: "/Tools/bookkeepingSystemVersion",
				responses: [{ status: 401, body: fixtures.authenticationRequired }],
			},
			{
				method: "GET",
				path: "/SevUser",
				responses: [{ status: 401, body: fixtures.authenticationRequired }],
			},
		]);

		await expect(
			connectAccountingTool({
				providerKind: "sevdesk",
				apiKey: TOKEN,
				defaultTaxTreatment: standard,
				settings: { netPrices: true },
			}),
		).resolves.toMatchObject({ success: false, error: "The accounting tool refused this API key" });
		await expect(
			listAccountingContactPersons({ providerKind: "sevdesk", apiKey: TOKEN }),
		).resolves.toMatchObject({ success: false, error: "The accounting tool refused this API key" });
		expect(harness.secrets.size).toBe(0);
	});

	it("lets only owners and admins list the sevdesk users", async () => {
		actAs(ids.memberUser);

		await expect(
			listAccountingContactPersons({ providerKind: "sevdesk", apiKey: TOKEN }),
		).resolves.toMatchObject({ success: false });
		expect(http.requests).toHaveLength(0);
	});
});
