/**
 * #1668 (spec #1664): with SSO approval required, both SSO sign-ins produce a
 * pending membership and no employee; the pending-member approval is the way
 * in. Without approval, the sign-in produces an approved membership at once.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const seatSignals = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async (signal: unknown) => {
		seatSignals.push(signal);
	},
}));
const notices = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/notifications/notification-service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/notifications/notification-service")>()),
	createNotification: async (params: unknown) => {
		notices.push(params);
		return null;
	},
}));
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
const { parseInstant } = await import("@/lib/datetime/temporal-core");
const { insertDeactivation } = await import("@/lib/employee-lifecycle/receipts");
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

/**
 * #1669 (spec #1664): an SSO sign-in that produces or finds an approved
 * membership joins through the joining module in its own transaction, and
 * sends the seat signal after commit.
 */
describe("SSO sign-ins join the organization (#1669)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => fixture?.close());
	beforeEach(() => {
		seatSignals.length = 0;
		notices.length = 0;
	});

	type SignIn = "provider-bound" | "verified domain";
	const signIns: SignIn[] = ["provider-bound", "verified domain"];

	/** An organization that lets SSO sign-ins in without approval, with a verified provider. */
	async function openSsoOrganization(requiresApproval = false) {
		const organizationId = await fixture.createOrganization();
		const domain = `t1669-${randomUUID().slice(0, 8)}.example.test`;
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

	async function newSsoUser(domain: string) {
		const userId = randomUUID();
		const email = `${userId.slice(0, 8)}@${domain}`;
		await fixture.pool.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'SSO person', $2, true, now(), now())`,
			[userId, email],
		);
		return { id: userId, email };
	}

	/** Gives a seeded user a verified email of the organization's domain. */
	async function onDomain(userId: string, domain: string) {
		const email = `${userId.slice(0, 8)}@${domain}`;
		await fixture.pool.query(`update "user" set email = $2, email_verified = true where id = $1`, [
			userId,
			email,
		]);
		return { id: userId, email };
	}

	/** A former employee: deactivated, or departed without a rehire. */
	async function formerEmployee(
		organizationId: string,
		state: "deactivated" | "departed",
		options: { keepMembership: boolean },
	) {
		const seeded = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			seeded.employeeId,
		]);
		await insertDeactivation(fixture.db, {
			organizationId,
			employeeId: seeded.employeeId,
			employmentPeriodId: seeded.employmentPeriodId,
			deactivatedAt: parseInstant("2026-01-05T08:00:00Z"),
			createdBy: fixture.ownerUserId,
			reason: "employee_deactivated",
			requestId: randomUUID(),
			requestFingerprint: "test",
			replacementManagers: {},
		});
		if (state === "departed") {
			await fixture.pool.query(
				`insert into employee_departure
				 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
				  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
				 values ($1, $2, $3, 'immediate', '2026-01-06', 'UTC', '2026-01-07T08:00:00Z', $4,
				         gen_random_uuid(), 'test', 1, 'effective', '2026-01-07T08:00:00Z')`,
				[organizationId, seeded.employeeId, seeded.employmentPeriodId, fixture.ownerUserId],
			);
			await fixture.pool.query(
				`update employee_employment_period set status = 'closed', ended_at = '2026-01-07T08:00:00Z' where id = $1`,
				[seeded.employmentPeriodId],
			);
		}
		if (!options.keepMembership) {
			await fixture.pool.query("delete from member where id = $1", [seeded.memberId]);
		}
		return seeded;
	}

	function signIn(
		kind: SignIn,
		input: {
			organizationId: string;
			user: { id: string; email: string };
			userInfo?: Record<string, unknown>;
		},
	) {
		return kind === "provider-bound"
			? provisionSsoProviderOrganization(db, {
					user: input.user,
					userInfo: input.userInfo ?? {},
					provider: { organizationId: input.organizationId },
				})
			: assignSsoOrganizationByVerifiedDomain(db, input.user.id);
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
			"select id, role, is_active from employee where organization_id = $1 and user_id = $2",
			[organizationId, userId],
		);
		return rows as { id: string; role: string; is_active: boolean }[];
	}

	async function organizationWideTeamPermissions(organizationId: string, employeeId: string) {
		const { rows } = await fixture.pool.query(
			`select can_create_teams from team_permissions
			 where organization_id = $1 and employee_id = $2 and team_id is null`,
			[organizationId, employeeId],
		);
		return rows;
	}

	function seatSignalFor(organizationId: string, userId: string) {
		return [expect.objectContaining({ organizationId, userId, change: "added" })];
	}

	describe.each(signIns)("%s sign-in", (kind) => {
		it("joins a new user as an active employee and signals the seat", async () => {
			const { organizationId, domain } = await openSsoOrganization();
			const user = await newSsoUser(domain);

			const outcome = await signIn(kind, { organizationId, user });

			expect(outcome?.kind).toBe("joined");
			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "member", status: "approved" },
			]);
			expect(await employees(organizationId, user.id)).toEqual([
				expect.objectContaining({ role: "employee", is_active: true }),
			]);
			expect(seatSignals).toEqual(seatSignalFor(organizationId, user.id));
		});

		it("reactivates a deactivated returner whose membership was removed", async () => {
			const { organizationId, domain } = await openSsoOrganization();
			const former = await formerEmployee(organizationId, "deactivated", {
				keepMembership: false,
			});
			const user = await onDomain(former.userId, domain);

			const outcome = await signIn(kind, { organizationId, user });

			expect(outcome?.kind).toBe("reactivated");
			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "member", status: "approved" },
			]);
			expect(await employees(organizationId, user.id)).toEqual([
				{ id: former.employeeId, role: "employee", is_active: true },
			]);
			expect(seatSignals).toEqual(seatSignalFor(organizationId, user.id));
		});

		it("reactivates an inactive employee who kept an approved membership, even while approval is required", async () => {
			const { organizationId, domain } = await openSsoOrganization(true);
			const former = await formerEmployee(organizationId, "deactivated", {
				keepMembership: true,
			});
			const user = await onDomain(former.userId, domain);

			const outcome = await signIn(kind, { organizationId, user });

			expect(outcome?.kind).toBe("reactivated");
			expect(await employees(organizationId, user.id)).toEqual([
				{ id: former.employeeId, role: "employee", is_active: true },
			]);
			expect(seatSignals).toEqual(seatSignalFor(organizationId, user.id));
		});

		it("keeps a departed returner off the current roster with the membership only", async () => {
			const { organizationId, domain } = await openSsoOrganization();
			const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
			const former = await formerEmployee(organizationId, "departed", { keepMembership: false });
			const user = await onDomain(former.userId, domain);

			const outcome = await signIn(kind, { organizationId, user });

			expect(outcome?.kind).toBe("membership_only");
			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "member", status: "approved" },
			]);
			expect(await employees(organizationId, user.id)).toEqual([
				{ id: former.employeeId, role: "employee", is_active: false },
			]);
			expect(seatSignals).toEqual(seatSignalFor(organizationId, user.id));
			// Nobody watches an SSO sign-in: the admins learn a rehire is needed (#1672).
			expect(notices).toContainEqual(
				expect.objectContaining({
					userId: owner.userId,
					organizationId,
					type: "former_employee_needs_rehire",
					entityId: former.employeeId,
				}),
			);
		});

		it("tells nobody again when a departed returner who kept the membership signs in (#1672)", async () => {
			const { organizationId, domain } = await openSsoOrganization();
			await fixture.seedEmployee({ organizationId, role: "owner" });
			const former = await formerEmployee(organizationId, "departed", { keepMembership: true });
			const user = await onDomain(former.userId, domain);

			const outcome = await signIn(kind, { organizationId, user });

			expect(outcome?.kind).toBe("membership_only");
			expect(notices).toEqual([]);
			// Neither the membership nor the employee changed: no seat signal.
			expect(seatSignals).toEqual([]);
		});

		it("sends no seat signal when a current employee signs in again", async () => {
			const { organizationId, domain } = await openSsoOrganization();
			const user = await newSsoUser(domain);
			await signIn(kind, { organizationId, user });
			seatSignals.length = 0;

			const outcome = await signIn(kind, { organizationId, user });

			expect(outcome?.kind).toBe("already_current");
			expect(seatSignals).toEqual([]);
		});

		it("joins nothing while the membership waits for approval", async () => {
			const { organizationId, domain } = await openSsoOrganization(true);
			const user = await newSsoUser(domain);

			const outcome = await signIn(kind, { organizationId, user });

			expect(outcome).toBeNull();
			expect(await employees(organizationId, user.id)).toEqual([]);
			expect(seatSignals).toEqual([]);
		});
	});

	describe("an identity provider admin", () => {
		it("provider-bound: gets an admin membership, an admin employee and the organization-wide team permissions", async () => {
			const { organizationId, domain } = await openSsoOrganization();
			const user = await newSsoUser(domain);

			await signIn("provider-bound", {
				organizationId,
				user,
				userInfo: { attributes: { role: "manager" } },
			});

			expect(await membership(organizationId, user.id)).toEqual([
				{ role: "admin", status: "approved" },
			]);
			const [joined] = await employees(organizationId, user.id);
			expect(joined).toMatchObject({ role: "admin", is_active: true });
			expect(await organizationWideTeamPermissions(organizationId, joined?.id ?? "")).toEqual([
				{ can_create_teams: true },
			]);
			expect(seatSignals).toEqual(seatSignalFor(organizationId, user.id));
		});

		it("verified domain: an admin membership without an employee joins as an admin employee", async () => {
			// The verified-domain sign-in carries no provider role; an admin
			// membership it finds (for example an earlier provider-bound one) decides.
			const { organizationId, domain } = await openSsoOrganization();
			const user = await newSsoUser(domain);
			await fixture.pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, 'admin', 'approved', now())`,
				[randomUUID(), organizationId, user.id],
			);

			const outcome = await signIn("verified domain", { organizationId, user });

			expect(outcome?.kind).toBe("joined");
			const [joined] = await employees(organizationId, user.id);
			expect(joined).toMatchObject({ role: "admin", is_active: true });
			expect(await organizationWideTeamPermissions(organizationId, joined?.id ?? "")).toEqual([
				{ can_create_teams: true },
			]);
			expect(seatSignals).toEqual(seatSignalFor(organizationId, user.id));
		});
	});
});
