/**
 * #1628 (spec #1590, Organization ADR 0011): every way back after a
 * deactivation is a Reactivation. A deactivated employee who comes back
 * through an invite code, a pending-member approval or provisioning has the
 * deactivation marked reactivated by whoever brought them back, `deactivatedAt`
 * cleared, the history event recorded and the reactivation checklist offered,
 * and nothing the deactivation ended returns. SCIM re-enable is covered by the
 * SCIM protocol suite. Only the request and session, billing, queues and the
 * Next cache are replaced.
 */
import { createHash, randomUUID } from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-10-20T08:00:00Z",
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
			getSession: async () => ({
				user: { id: harness.userId, role: "user" },
				session: {
					id: `session-${harness.userId}`,
					userId: harness.userId,
					activeOrganizationId: harness.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/auth-helpers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/auth-helpers")>();
	const { db } = await import("@/db");
	const { loadOrganizationPrincipalContext } = await import(
		"@/lib/authorization/principal-loader"
	);
	return {
		...original,
		getAuthContext: async () => ({
			user: { id: harness.userId },
			session: { activeOrganizationId: harness.organizationId },
		}),
		getPrincipalContext: async () =>
			loadOrganizationPrincipalContext(db, {
				userId: harness.userId,
				organizationId: harness.organizationId,
			}),
	};
});
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
vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));
vi.mock("@/lib/queue", async (importOriginal) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(
		importOriginal,
	),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(harness.now) },
	};
});
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
	};
	return { ...original, createLogger: () => quiet };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { deactivateEmployeeAction } = await import(
	"@/app/[locale]/(app)/settings/employees/employee-lifecycle.actions"
);
const { getReactivationChecklistAction, listEmployeeLifecycleHistoryAction } =
	await import(
		"@/app/[locale]/(app)/settings/employees/employee-reactivation.actions"
	);
const { Effect, Layer } = await import("effect");
const { DatabaseServiceLive } = await import(
	"@/lib/effect/services/database.service"
);
const { AuthServiceLive } = await import("@/lib/effect/services/auth.service");
const { InviteCodeService, InviteCodeServiceLive } = await import(
	"@/lib/effect/services/invite-code.service"
);
const { PendingMemberService, PendingMemberServiceLive } = await import(
	"@/lib/effect/services/pending-member.service"
);
const { db } = await import("@/db");
const { ensureEmployeeForOrganizationMember } = await import(
	"@/lib/auth/organization-member-provisioning"
);
const { createLifecycleDatabaseFixture } = await import(
	"./testing/database.test.fixture"
);
type LifecycleDatabaseFixture =
	import("./testing/database.test.fixture").LifecycleDatabaseFixture;
type SeededEmployee = import("./testing/database.test.fixture").SeededEmployee;

const services = Layer.mergeAll(
	InviteCodeServiceLive,
	PendingMemberServiceLive,
).pipe(Layer.provide(Layer.merge(DatabaseServiceLive, AuthServiceLive)));

const DEACTIVATED_AT = "2026-10-20T08:00:00Z";
const RETURNED_AT = "2026-10-22T08:00:00Z";

describe("every way back after a deactivation is a reactivation (#1628)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(
			"update organization set timezone = 'Europe/Berlin' where id = $1",
			[fixture.organizationId],
		);
	});
	afterAll(async () => fixture?.close());
	beforeEach(() => {
		actAs(fixture.ownerUserId);
		harness.now = DEACTIVATED_AT;
	});

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = fixture.organizationId;
	}

	async function seedShareLink(creator: SeededEmployee) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into report_share_link
			 (organization_id, created_by, creator_employee_id, kind, project_ids, from_day, to_day, figures,
			  creator_locale, token_digest, token_hash_version, snapshot, created_at, expires_at)
			 values ($1, $2, $3, 'project', array[$4::uuid], '2026-09-01', '2026-09-30', 'hours', 'en', $5, 'v1',
			  '{}'::jsonb, '2026-10-01T08:00:00Z', '2026-12-01T00:00:00Z')
			 returning id`,
			[
				fixture.organizationId,
				creator.userId,
				creator.employeeId,
				randomUUID(),
				createHash("sha256").update(randomUUID()).digest("hex"),
			],
		);
		return rows[0]?.id ?? "";
	}

	/** A person holding a share link, deactivated by the owner at `DEACTIVATED_AT`. */
	async function deactivatedPerson() {
		const person = await fixture.seedEmployee();
		const shareLinkId = await seedShareLink(person);
		actAs(fixture.ownerUserId);
		harness.now = DEACTIVATED_AT;
		const result = await deactivateEmployeeAction({
			employeeId: person.employeeId,
			requestId: randomUUID(),
			replacementManagers: {},
		});
		expect(result).toEqual({ success: true, data: undefined });
		harness.now = RETURNED_AT;
		return { ...person, shareLinkId };
	}

	function run<A, E>(
		effect: Effect.Effect<A, E, InviteCodeService | PendingMemberService>,
	) {
		return Effect.runPromise(effect.pipe(Effect.provide(services)));
	}

	async function inviteCode(requiresApproval: boolean) {
		const code = `R${randomUUID().slice(0, 8).toUpperCase()}`;
		await fixture.pool.query(
			`insert into invite_code (organization_id, code, label, requires_approval, created_by)
			 values ($1, $2, 'Rejoin', $3, $4)`,
			[fixture.organizationId, code, requiresApproval, fixture.ownerUserId],
		);
		return code;
	}

	async function employeeState(person: SeededEmployee) {
		const { rows } = await fixture.pool.query(
			"select is_active, deactivated_at from employee where id = $1",
			[person.employeeId],
		);
		return rows[0];
	}

	async function ledger(person: SeededEmployee) {
		const { rows } = await fixture.pool.query(
			`select id, reactivated_at, reactivated_by from employee_deactivation
			 where organization_id = $1 and employee_id = $2`,
			[fixture.organizationId, person.employeeId],
		);
		return rows;
	}

	/** The person is current again, with the deactivation reactivated by `actorUserId`. */
	async function expectReactivatedBy(
		person: SeededEmployee & { shareLinkId: string },
		actorUserId: string,
	) {
		expect(await employeeState(person)).toEqual({
			is_active: true,
			deactivated_at: null,
		});
		const [deactivation, ...others] = await ledger(person);
		expect(others).toEqual([]);
		expect(deactivation).toMatchObject({
			reactivated_at: new Date(RETURNED_AT),
			reactivated_by: actorUserId,
		});

		actAs(fixture.ownerUserId);
		const checklist = await getReactivationChecklistAction(person.employeeId);
		expect(checklist).toMatchObject({
			success: true,
			data: { deactivationId: deactivation?.id, reactivatedAt: RETURNED_AT },
		});
		expect(
			await listEmployeeLifecycleHistoryAction(person.employeeId),
		).toMatchObject({
			success: true,
			data: {
				events: [
					{ kind: "reactivated", at: RETURNED_AT },
					{ kind: "deactivated", at: DEACTIVATED_AT },
				],
			},
		});
		// Nothing the deactivation ended comes back.
		const { rows } = await fixture.pool.query(
			"select revoked_at is not null as revoked from report_share_link where id = $1",
			[person.shareLinkId],
		);
		expect(rows).toEqual([{ revoked: true }]);
	}

	/** They were removed, asked to join again with a code that needs approval, and the owner approves. */
	async function approvePendingRejoin(person: SeededEmployee) {
		await fixture.pool.query("delete from member where id = $1", [
			person.memberId,
		]);
		const code = await inviteCode(true);
		const joined = await run(
			InviteCodeService.pipe(
				Effect.flatMap((service) =>
					service.useCode({ code, userId: person.userId }),
				),
			),
		);
		expect(joined).toMatchObject({ status: "pending" });
		await run(
			PendingMemberService.pipe(
				Effect.flatMap((service) =>
					service.approve({
						memberId: joined.memberId ?? "",
						organizationId: fixture.organizationId,
						approvedBy: fixture.ownerUserId,
					}),
				),
			),
		);
	}

	/** Still a member, they join again with a code that needs no approval. */
	async function joinWithInviteCode(person: SeededEmployee) {
		const code = await inviteCode(false);
		const joined = await run(
			InviteCodeService.pipe(
				Effect.flatMap((service) =>
					service.useCode({ code, userId: person.userId }),
				),
			),
		);
		expect(joined).toMatchObject({ status: "approved" });
	}

	/** They accept an invitation, which provisions their employee. */
	async function acceptInvitation(person: SeededEmployee) {
		await ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId: person.userId,
			organizationId: fixture.organizationId,
			memberRole: "member",
		});
	}

	const waysBack = [
		{ way: "pending-member approval", comeBack: approvePendingRejoin },
		{ way: "invite-code join", comeBack: joinWithInviteCode },
		{ way: "provisioning", comeBack: acceptInvitation },
	];

	it("reactivates a deactivated employee whose pending membership an admin approves, by the admin", async () => {
		const person = await deactivatedPerson();
		await approvePendingRejoin(person);
		await expectReactivatedBy(person, fixture.ownerUserId);
	});

	it("reactivates a deactivated member who joins again with an invite code, by the joining user", async () => {
		const person = await deactivatedPerson();
		await joinWithInviteCode(person);
		await expectReactivatedBy(person, person.userId);
	});

	it("reactivates a deactivated employee whose accepted invitation provisions them, by the accepting user", async () => {
		const person = await deactivatedPerson();
		await acceptInvitation(person);
		await expectReactivatedBy(person, person.userId);
	});

	it.each(waysBack)(
		"never reactivates a former employee whose departure took effect through $way",
		async ({ comeBack }) => {
			const person = await deactivatedPerson();
			// Their departure took effect after the deactivation: only a rehire brings them back.
			await fixture.pool.query(
				`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'immediate', '2026-10-20', 'UTC', '2026-10-21T08:00:00Z', $4,
			         gen_random_uuid(), 'test', 1, 'effective', '2026-10-21T08:00:00Z')`,
				[
					fixture.organizationId,
					person.employeeId,
					person.employmentPeriodId,
					fixture.ownerUserId,
				],
			);
			await fixture.pool.query(
				`update employee_employment_period set status = 'closed', ended_at = '2026-10-21T08:00:00Z' where id = $1`,
				[person.employmentPeriodId],
			);

			await comeBack(person);

			expect(await employeeState(person)).toMatchObject({ is_active: false });
			expect(await ledger(person)).toMatchObject([
				{ reactivated_at: null, reactivated_by: null },
			]);
			actAs(fixture.ownerUserId);
			expect(await getReactivationChecklistAction(person.employeeId)).toEqual({
				success: true,
				data: null,
			});
		},
	);

	it.each(waysBack)(
		"leaves an employee who was never deactivated without a reactivation through $way",
		async ({ comeBack }) => {
			// Switched off before deactivations were recorded: today's direct switch-on, nothing more.
			const person = await fixture.seedEmployee({ isActive: false });
			harness.now = RETURNED_AT;

			await comeBack(person);

			expect(await employeeState(person)).toEqual({
				is_active: true,
				deactivated_at: null,
			});
			expect(await ledger(person)).toEqual([]);
			actAs(fixture.ownerUserId);
			expect(
				await listEmployeeLifecycleHistoryAction(person.employeeId),
			).toMatchObject({
				success: true,
				data: { events: [] },
			});
		},
	);
});
