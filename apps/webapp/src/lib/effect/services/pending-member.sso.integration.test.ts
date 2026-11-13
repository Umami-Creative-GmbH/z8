/**
 * #1668 (spec #1664): a pending membership from an SSO sign-in is approved or
 * rejected like one from an invite code. The pending list shows that it came
 * from the identity provider and with which role; approval grants that role.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { Effect, Layer } = await import("effect");
const { db } = await import("@/db");
const { DatabaseServiceLive } = await import("./database.service");
const { PendingMemberService, PendingMemberServiceLive } = await import(
	"./pending-member.service"
);
const { provisionSsoProviderOrganization } = await import(
	"@/lib/auth/sso-organization-provisioning"
);
const { createLifecycleDatabaseFixture } = await import(
	"@/lib/employee-lifecycle/testing/database.test.fixture"
);
type LifecycleDatabaseFixture =
	import("@/lib/employee-lifecycle/testing/database.test.fixture").LifecycleDatabaseFixture;
type PendingMemberServiceType = import("./pending-member.service").PendingMemberService;

const services = PendingMemberServiceLive.pipe(Layer.provide(DatabaseServiceLive));

function run<A, E>(effect: Effect.Effect<A, E, PendingMemberServiceType>) {
	return Effect.runPromise(effect.pipe(Effect.provide(services)));
}

describe("SSO pending memberships in the pending-member approval (#1668)", () => {
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		await fixture.pool.query("update organization set sso_requires_approval = true where id = $1", [
			organizationId,
		]);
	});
	afterAll(async () => fixture?.close());

	/** Someone signs in through the organization's identity provider and waits for approval. */
	async function ssoSignIn(providerRole?: string) {
		const userId = randomUUID();
		const email = `${userId.slice(0, 8)}@t1668.example.test`;
		await fixture.pool.query(
			`insert into "user" (id, name, email, email_verified, created_at, updated_at)
			 values ($1, 'SSO person', $2, true, now(), now())`,
			[userId, email],
		);
		await provisionSsoProviderOrganization(db, {
			user: { id: userId, email },
			userInfo: providerRole ? { attributes: { role: providerRole } } : {},
			provider: { organizationId },
		});
		const { rows } = await fixture.pool.query<{ id: string }>(
			"select id from member where organization_id = $1 and user_id = $2",
			[organizationId, userId],
		);
		return { userId, memberId: rows[0]?.id ?? "" };
	}

	it("lists and counts an SSO pending membership with its source and requested role", async () => {
		const person = await ssoSignIn("manager");

		const pending = await run(
			PendingMemberService.pipe(Effect.flatMap((service) => service.listPending({ organizationId }))),
		);
		expect(pending.find((entry) => entry.id === person.memberId)).toMatchObject({
			userId: person.userId,
			role: "admin",
			source: "sso",
			inviteCode: null,
		});

		const count = await run(
			PendingMemberService.pipe(Effect.flatMap((service) => service.countPending(organizationId))),
		);
		expect(count).toBe(pending.length);
		expect(count).toBeGreaterThan(0);
	});

	it("lists and counts only the organization's own pending memberships", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const elsewhere = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		await fixture.pool.query("update member set status = 'pending' where id = $1", [
			elsewhere.memberId,
		]);
		const approved = await fixture.seedEmployee();

		const pending = await run(
			PendingMemberService.pipe(Effect.flatMap((service) => service.listPending({ organizationId }))),
		);
		const ids = pending.map((entry) => entry.id);
		expect(ids).not.toContain(elsewhere.memberId);
		expect(ids).not.toContain(approved.memberId);

		const otherCount = await run(
			PendingMemberService.pipe(
				Effect.flatMap((service) => service.countPending(otherOrganizationId)),
			),
		);
		expect(otherCount).toBe(1);
	});

	it("approves an SSO pending membership with the requested role and an active employee", async () => {
		const person = await ssoSignIn("manager");

		await run(
			PendingMemberService.pipe(
				Effect.flatMap((service) =>
					service.approve({
						memberId: person.memberId,
						organizationId,
						approvedBy: fixture.ownerUserId,
					}),
				),
			),
		);

		const { rows: members } = await fixture.pool.query(
			"select role, status from member where id = $1",
			[person.memberId],
		);
		expect(members).toEqual([{ role: "admin", status: "approved" }]);
		const { rows: employees } = await fixture.pool.query(
			"select is_active from employee where organization_id = $1 and user_id = $2",
			[organizationId, person.userId],
		);
		expect(employees).toEqual([{ is_active: true }]);
	});

	it("rejects an SSO pending membership and records the rejection", async () => {
		const person = await ssoSignIn();

		await run(
			PendingMemberService.pipe(
				Effect.flatMap((service) =>
					service.reject({
						memberId: person.memberId,
						organizationId,
						rejectedBy: fixture.ownerUserId,
						notes: "Not one of ours",
					}),
				),
			),
		);

		const { rows: members } = await fixture.pool.query("select id from member where id = $1", [
			person.memberId,
		]);
		expect(members).toEqual([]);
		const { rows: audits } = await fixture.pool.query(
			`select entity_type, entity_id, action from audit_log
			 where organization_id = $1 and metadata::jsonb ->> 'memberId' = $2`,
			[organizationId, person.memberId],
		);
		expect(audits).toEqual([
			{ entity_type: "membership", entity_id: person.memberId, action: "reject" },
		]);
	});
});
