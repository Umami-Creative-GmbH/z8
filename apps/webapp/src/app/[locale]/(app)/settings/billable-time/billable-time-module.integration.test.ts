/**
 * #897: the Billable Time module switch and the billable currency on PostgreSQL.
 *
 * The real server actions, the organization feature toggle and the settings
 * reader run against a disposable database. Only the request/session, SSO session
 * store, Next cache and logger boundaries are replaced. The registry of currency
 * lock probes is replaced so a test can stand in for "a billable rate exists"
 * before the rate tables exist (#898, #899).
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	priced: new Set<string>(),
}));

// getRequestSession awaits connection(), which throws outside a Next request scope.
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

vi.mock("@/lib/billable-time/currency-lock-probes", () => ({
	BILLABLE_CURRENCY_LOCK_PROBES: [
		{
			name: "test billable rate",
			hasPricedRows: async (_tx: unknown, organizationId: string) =>
				harness.priced.has(organizationId),
		},
	],
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

const { switchBillableTime, updateBillableCurrency } = await import("./actions");
const { toggleOrganizationFeature } = await import("../organizations/actions");
const { getBillableTimeSettings: readBillableTimeSettings } = await import(
	"@/lib/billable-time/settings"
);
const { db } = await import("@/db");
const getBillableTimeSettings = (organizationId: string) =>
	readBillableTimeSettings(organizationId, db);

const ids = {
	organization: "t897-org",
	otherOrganization: "t897-other-org",
	ownerUser: "t897-owner-user",
	adminUser: "t897-admin-user",
	memberUser: "t897-member-user",
	otherOwnerUser: "t897-other-owner-user",
} as const;
const users = [ids.ownerUser, ids.adminUser, ids.memberUser, ids.otherOwnerUser];

describe("Billable Time module switch on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function setProjects(organizationId: string, enabled: boolean) {
		await admin.query("update organization set projects_enabled = $2 where id = $1", [
			organizationId,
			enabled,
		]);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	beforeEach(async () => {
		await cleanup();
		harness.priced.clear();
		const timestamp = new Date("2026-10-01T08:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, projects_enabled, created_at) values
			 ($1, 'T897', $1, true, $3), ($2, 'T897 other', $2, true, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t897-m-owner', $1, $3, 'owner', 'approved', $7),
			 ('t897-m-admin', $1, $4, 'admin', 'approved', $7),
			 ('t897-m-member', $1, $5, 'member', 'approved', $7),
			 ('t897-m-other-owner', $2, $6, 'owner', 'approved', $7),
			 ('t897-m-owner-in-other', $2, $3, 'member', 'approved', $7)`,
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
		actAs(ids.ownerUser);
	});

	afterAll(cleanup);

	describe("switching the module", () => {
		it("is off by default, with no billable currency", async () => {
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: null,
			});
		});

		it("lets an owner switch it on with a chosen billable currency", async () => {
			await expect(switchBillableTime({ enabled: true, currency: "CHF" })).resolves.toMatchObject({
				success: true,
				data: { enabled: true, currency: "CHF" },
			});
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: true,
				currency: "CHF",
			});
		});

		it("refuses to switch it on while projects are off", async () => {
			await setProjects(ids.organization, false);

			const result = await switchBillableTime({ enabled: true, currency: "EUR" });

			expect(result).toMatchObject({ success: false, code: "ValidationError" });
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: null,
			});
		});

		it("asks for a listed billable currency the first time it is switched on", async () => {
			await expect(switchBillableTime({ enabled: true })).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
			});
			await expect(switchBillableTime({ enabled: true, currency: "JPY" })).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
			});
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: null,
			});
		});

		it("keeps the chosen currency when the module is switched off and on again", async () => {
			await switchBillableTime({ enabled: true, currency: "GBP" });

			await expect(switchBillableTime({ enabled: false })).resolves.toMatchObject({
				success: true,
				data: { enabled: false, currency: "GBP" },
			});
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: "GBP",
			});

			await expect(switchBillableTime({ enabled: true })).resolves.toMatchObject({
				success: true,
				data: { enabled: true, currency: "GBP" },
			});
		});

		it("refuses admins and members: like every module switch, it is the owner's", async () => {
			for (const userId of [ids.adminUser, ids.memberUser]) {
				actAs(userId);
				await expect(switchBillableTime({ enabled: true, currency: "EUR" })).resolves.toMatchObject(
					{ success: false, code: "AuthorizationError" },
				);
			}
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: null,
			});
		});

		it("is not writable through the generic feature toggle, which cannot ask for a currency", async () => {
			await expect(
				toggleOrganizationFeature(ids.organization, "billableTimeEnabled", true),
			).resolves.toMatchObject({ success: false });
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: null,
			});
		});
	});

	describe("projects dependency", () => {
		it("switches Billable Time off with projects and keeps its currency", async () => {
			await switchBillableTime({ enabled: true, currency: "USD" });

			await expect(
				toggleOrganizationFeature(ids.organization, "projectsEnabled", false),
			).resolves.toMatchObject({ success: true });
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: "USD",
			});

			await toggleOrganizationFeature(ids.organization, "projectsEnabled", true);
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: "USD",
			});

			await switchBillableTime({ enabled: true });
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: true,
				currency: "USD",
			});
		});

		it("never reports the module on while projects are off", async () => {
			await switchBillableTime({ enabled: true, currency: "EUR" });
			// A row written outside the toggle, e.g. by an older deployment.
			await admin.query("update organization set projects_enabled = false where id = $1", [
				ids.organization,
			]);

			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: "EUR",
			});
		});
	});

	describe("billable currency", () => {
		beforeEach(async () => {
			await switchBillableTime({ enabled: true, currency: "EUR" });
		});

		it("lets an org admin change it while no rate uses it", async () => {
			actAs(ids.adminUser);

			await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
				success: true,
				data: { enabled: true, currency: "CHF" },
			});
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: true,
				currency: "CHF",
			});
		});

		it("is read-only once a billable rate or cost rate exists", async () => {
			harness.priced.add(ids.organization);

			await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
				success: false,
				code: "ConflictError",
			});
			// Switching the module on again cannot change it either.
			await switchBillableTime({ enabled: false });
			await expect(switchBillableTime({ enabled: true, currency: "CHF" })).resolves.toMatchObject({
				success: false,
				code: "ConflictError",
			});
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: "EUR",
			});
		});

		it("refuses members and an unlisted currency", async () => {
			actAs(ids.memberUser);
			await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});

			actAs(ids.adminUser);
			await expect(updateBillableCurrency({ currency: "XYZ" })).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
			});
			await expect(getBillableTimeSettings(ids.organization)).resolves.toMatchObject({
				currency: "EUR",
			});
		});

		it("cannot be changed while the module is off", async () => {
			await switchBillableTime({ enabled: false });

			await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
			});
		});

		async function connectAccountingTool(organizationId: string, providerKind: string) {
			await admin.query(
				`insert into accounting_connection
				 (organization_id, provider_kind, status, account_ref, default_tax_treatment, default_tax_rate)
				 values ($1, $2, 'active', 't897-account', 'domestic_standard', 19)`,
				[organizationId, providerKind],
			);
		}

		it("refuses a currency the connected accounting tool cannot take (Lexware: EUR only)", async () => {
			await connectAccountingTool(ids.organization, "lexware_office");
			actAs(ids.adminUser);

			await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
				success: false,
				code: "ConflictError",
				error: expect.stringContaining("Lexware Office"),
			});
			// Switching the module off and on with another currency is the same change.
			actAs(ids.ownerUser);
			await switchBillableTime({ enabled: false });
			await expect(switchBillableTime({ enabled: true, currency: "CHF" })).resolves.toMatchObject({
				success: false,
				code: "ConflictError",
			});
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: "EUR",
			});
		});

		it("allows a currency the connected accounting tool takes, and any once it is removed", async () => {
			await connectAccountingTool(ids.organization, "sevdesk");
			actAs(ids.adminUser);

			await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
				success: true,
				data: { currency: "CHF" },
			});

			await admin.query(
				"update accounting_connection set status = 'removed', ended_at = now() where organization_id = $1",
				[ids.organization],
			);
			await connectAccountingTool(ids.otherOrganization, "lexware_office");
			await expect(updateBillableCurrency({ currency: "USD" })).resolves.toMatchObject({
				success: true,
				data: { currency: "USD" },
			});
		});
	});

	describe("organization scoping", () => {
		it("writes only the active organization", async () => {
			await switchBillableTime({ enabled: true, currency: "CHF" });

			await expect(getBillableTimeSettings(ids.otherOrganization)).resolves.toEqual({
				enabled: false,
				currency: null,
			});
		});

		it("acts on the active organization, where an owner elsewhere has no owner rights", async () => {
			// The owner of the first organization is only a member of the other one.
			actAs(ids.ownerUser, ids.otherOrganization);

			await expect(switchBillableTime({ enabled: true, currency: "CHF" })).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
			await expect(getBillableTimeSettings(ids.otherOrganization)).resolves.toEqual({
				enabled: false,
				currency: null,
			});
			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: false,
				currency: null,
			});
		});

		it("reads each organization's own settings", async () => {
			await switchBillableTime({ enabled: true, currency: "CHF" });
			actAs(ids.otherOwnerUser, ids.otherOrganization);
			await switchBillableTime({ enabled: true, currency: "GBP" });

			await expect(getBillableTimeSettings(ids.organization)).resolves.toEqual({
				enabled: true,
				currency: "CHF",
			});
			await expect(getBillableTimeSettings(ids.otherOrganization)).resolves.toEqual({
				enabled: true,
				currency: "GBP",
			});
		});

		it("refuses a session without an active organization", async () => {
			harness.organizationId = null;

			await expect(switchBillableTime({ enabled: true, currency: "CHF" })).resolves.toMatchObject({
				success: false,
			});
			await expect(updateBillableCurrency({ currency: "CHF" })).resolves.toMatchObject({
				success: false,
			});
		});
	});
});
