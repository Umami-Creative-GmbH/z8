/**
 * #1668 (spec #1664): with SSO approval required, both SSO sign-ins produce a
 * pending membership and no employee; the pending-member approval is the way
 * in. Without approval, the sign-in produces an approved membership at once.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { db } = await import("@/db");
const { assignSsoOrganizationByVerifiedDomain, provisionSsoProviderOrganization } = await import(
	"./sso-organization-provisioning"
);
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
type LifecycleDatabaseFixture =
	import("@/lib/employee-lifecycle/testing/database.test.fixture").LifecycleDatabaseFixture;

describe("SSO sign-in and SSO approval (#1668)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => fixture?.close());

	/** A fresh organization with its own verified SSO provider for `domain`. */
	async function ssoOrganization(requiresApproval: boolean) {
		const organizationId = await fixture.createOrganization();
		const domain = `t1668-${randomUUID().slice(0, 8)}.example.test`;
		await fixture.pool.query("update organization set sso_requires_approval = $2 where id = $1", [
			organizationId,
			requiresApproval,
		]);
		await fixture.pool.query(
			`insert into sso_provider (id, issuer, user_id, provider_id, organization_id, domain, domain_verified)
			 values ($1, $2, $3, $4, $5, $6, true)`,
			[
				randomUUID(),
				`https://idp.${domain}`,
				fixture.ownerUserId,
				`idp-${domain}`,
				organizationId,
				domain,
			],
		);
		return { organizationId, domain };
	}

	async function ssoUser(domain: string) {
		const userId = randomUUID();
		const email = `${userId.slice(0, 8)}@${domain}`;
		await fixture.pool.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'SSO person', $2, true, now(), now())`,
			[userId, email],
		);
		return { id: userId, email };
	}

	async function membership(organizationId: string, userId: string) {
		const { rows } = await fixture.pool.query(
			"select role, status from member where organization_id = $1 and user_id = $2",
			[organizationId, userId],
		);
		return rows;
	}

	async function employees(organizationId: string, userId: string) {
		const { rows } = await fixture.pool.query(
			"select role, is_active from employee where organization_id = $1 and user_id = $2",
			[organizationId, userId],
		);
		return rows;
	}

	describe("provider-bound sign-in", () => {
		it("produces a pending membership with the provider's role and no employee when approval is required", async () => {
			const { organizationId, domain } = await ssoOrganization(true);
			const user = await ssoUser(domain);

			await provisionSsoProviderOrganization(db, {
				user,
				userInfo: { attributes: { role: "manager" } },
				provider: { organizationId },
			});

			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "admin", status: "pending" },
			]);
			expect(await employees(organizationId, user.id)).toEqual([]);
		});

		it("produces an approved membership and an active employee at once when approval is not required", async () => {
			const { organizationId, domain } = await ssoOrganization(false);
			const user = await ssoUser(domain);

			await provisionSsoProviderOrganization(db, {
				user,
				userInfo: {},
				provider: { organizationId },
			});

			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "member", status: "approved" },
			]);
			expect(await employees(organizationId, user.id)).toEqual([
				{ role: "employee", is_active: true },
			]);
		});

		it("leaves a former employee inactive and waiting for approval when approval is required", async () => {
			const { organizationId, domain } = await ssoOrganization(true);
			const former = await fixture.seedEmployee({ organizationId, isActive: false });
			await fixture.pool.query("delete from member where id = $1", [former.memberId]);
			const user = { id: former.userId, email: `${former.userId}@${domain}` };

			await provisionSsoProviderOrganization(db, {
				user,
				userInfo: {},
				provider: { organizationId },
			});

			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "member", status: "pending" },
			]);
			expect(await employees(organizationId, user.id)).toEqual([
				{ role: "employee", is_active: false },
			]);
		});

		it("changes nothing for someone who is already a member", async () => {
			const { organizationId } = await ssoOrganization(true);
			const current = await fixture.seedEmployee({ organizationId });

			await provisionSsoProviderOrganization(db, {
				user: { id: current.userId, email: `${current.userId}@lifecycle.test` },
				userInfo: { attributes: { role: "admin" } },
				provider: { organizationId },
			});

			expect(await membership(organizationId, current.userId)).toEqual([
				{ role: "member", status: "approved" },
			]);
			expect(await employees(organizationId, current.userId)).toEqual([
				{ role: "employee", is_active: true },
			]);
		});
	});

	describe("verified-domain sign-in", () => {
		it("produces a pending membership and no employee when approval is required", async () => {
			const { organizationId, domain } = await ssoOrganization(true);
			const user = await ssoUser(domain);

			await assignSsoOrganizationByVerifiedDomain(db, user.id);

			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "member", status: "pending" },
			]);
			expect(await employees(organizationId, user.id)).toEqual([]);
		});

		it("produces an approved membership when approval is not required", async () => {
			const { organizationId, domain } = await ssoOrganization(false);
			const user = await ssoUser(domain);

			await assignSsoOrganizationByVerifiedDomain(db, user.id);

			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "member", status: "approved" },
			]);
		});
	});
});
