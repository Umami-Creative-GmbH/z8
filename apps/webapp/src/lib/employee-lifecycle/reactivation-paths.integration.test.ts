/**
 * #1628 (spec #1590, Organization ADR 0011): every way back after a
 * deactivation is a Reactivation. Each way back makes the one call that does
 * it (#1643): a deactivated employee who comes back through an invite code, a
 * pending-member approval or provisioning has the deactivation marked
 * reactivated by whoever brought them back, `deactivatedAt` cleared, the
 * history event recorded and the reactivation checklist offered, and nothing
 * the deactivation ended returns. What the call decides (a departed employee,
 * one who was never deactivated, a second call, a rollback) is covered by
 * reactivation.integration.test.ts; SCIM re-enable by the SCIM protocol suite.
 * Only the request and session, billing, queues and the Next cache are
 * replaced.
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
	seatSignals: [] as unknown[],
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
	syncBillingSeatsAfterMemberChange: async (signal: unknown) => {
		harness.seatSignals.push(signal);
	},
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
const { joinOrganization } = await import("./joining");
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

	async function inviteCode(
		requiresApproval: boolean,
		defaultTeamId: string | null = null,
	) {
		const code = `R${randomUUID().slice(0, 8).toUpperCase()}`;
		await fixture.pool.query(
			`insert into invite_code (organization_id, code, label, requires_approval, created_by, default_team_id)
			 values ($1, $2, 'Rejoin', $3, $4, $5)`,
			[
				fixture.organizationId,
				code,
				requiresApproval,
				fixture.ownerUserId,
				defaultTeamId,
			],
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

	/** The person's employees with their team placement and organization-wide permissions. */
	async function employeesOf(userId: string) {
		const { rows } = await fixture.pool.query(
			`select e.role, e.is_active, e.team_id,
			   (select coalesce(array_agg(m.team_id::text), '{}') from team_membership m
			      where m.employee_id = e.id) as team_memberships,
			   (select count(*)::int from team_permissions p
			      where p.employee_id = e.id and p.team_id is null) as org_wide_permissions
			 from employee e where e.organization_id = $1 and e.user_id = $2`,
			[fixture.organizationId, userId],
		);
		return rows;
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
	async function approvePendingRejoin(
		person: Pick<SeededEmployee, "userId" | "memberId">,
		assignedTeamId: string | null = null,
	) {
		await fixture.pool.query("delete from member where id = $1", [
			person.memberId,
		]);
		return approvePendingJoin(person, assignedTeamId);
	}

	/** They ask to join with a code that needs approval, and the owner approves into `assignedTeamId`. */
	async function approvePendingJoin(
		person: Pick<SeededEmployee, "userId">,
		assignedTeamId: string | null = null,
		beforeApproval: (memberId: string) => Promise<void> = async () => {},
	) {
		const code = await inviteCode(true);
		const before = await employeesOf(person.userId);
		const joined = await run(
			InviteCodeService.pipe(
				Effect.flatMap((service) =>
					service.useCode({ code, userId: person.userId }),
				),
			),
		);
		expect(joined).toMatchObject({ status: "pending" });
		// A redemption that leaves the membership pending does not join.
		expect(await employeesOf(person.userId)).toEqual(before);
		await beforeApproval(joined.memberId ?? "");
		harness.seatSignals = [];
		await run(
			PendingMemberService.pipe(
				Effect.flatMap((service) =>
					service.approve({
						memberId: joined.memberId ?? "",
						organizationId: fixture.organizationId,
						approvedBy: fixture.ownerUserId,
						assignedTeamId,
					}),
				),
			),
		);
		return joined.memberId ?? "";
	}

	/** Still a member, they join again with a code that needs no approval. */
	async function joinWithInviteCode(
		person: Pick<SeededEmployee, "userId">,
		defaultTeamId: string | null = null,
	) {
		harness.seatSignals = [];
		const code = await inviteCode(false, defaultTeamId);
		const joined = await run(
			InviteCodeService.pipe(
				Effect.flatMap((service) =>
					service.useCode({ code, userId: person.userId }),
				),
			),
		);
		expect(joined).toMatchObject({ status: "approved" });
		return joined.memberId ?? "";
	}

	/** They accept an invitation: joining brings their employee back. */
	async function acceptInvitation(person: SeededEmployee) {
		const joined = await db.transaction((tx) =>
			joinOrganization(tx, {
				userId: person.userId,
				organizationId: fixture.organizationId,
				membership: { id: person.memberId, role: "member" },
			}),
		);
		await joined.afterCommit.run();
	}

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

	it("reactivates a deactivated employee whose accepted invitation joins them, by the accepting user", async () => {
		const person = await deactivatedPerson();
		await acceptInvitation(person);
		await expectReactivatedBy(person, person.userId);
	});

	/**
	 * #1667 (spec #1664): invite code redemption and pending-member approval join
	 * through the joining module, in their own transactions, and signal the seat
	 * change after commit.
	 */
	describe("invite codes and pending-member approval join (#1667)", () => {
		let teamId: string;

		beforeAll(async () => {
			const { rows } = await fixture.pool.query<{ id: string }>(
				`insert into team (organization_id, name, updated_at) values ($1, 'Arrivals', now()) returning id`,
				[fixture.organizationId],
			);
			teamId = rows[0]?.id ?? "";
		});

		/** A user with no membership and no employee in the organization. */
		async function newUser() {
			const userId = randomUUID();
			await fixture.pool.query(
				`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'Arrival', $2, now(), now())`,
				[userId, `${userId}@arrival.test`],
			);
			return { userId };
		}

		/** A deactivated person whose departure then took effect: only a rehire brings them back. */
		async function departedPerson() {
			const person = await deactivatedPerson();
			await fixture.pool.query(
				`insert into employee_departure
				 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
				  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
				 values ($1, $2, $3, 'immediate', '2026-10-20', 'UTC', '2026-10-21T00:00:00Z', $4,
				         gen_random_uuid(), 'test', 1, 'effective', '2026-10-21T00:00:00Z')`,
				[
					fixture.organizationId,
					person.employeeId,
					person.employmentPeriodId,
					fixture.ownerUserId,
				],
			);
			await fixture.pool.query(
				`update employee_employment_period set status = 'closed', ended_at = '2026-10-21T00:00:00Z' where id = $1`,
				[person.employmentPeriodId],
			);
			return person;
		}

		function seatSignal(userId: string, memberId: string) {
			return {
				organizationId: fixture.organizationId,
				memberId,
				userId,
				change: "added",
			};
		}

		type Path = {
			name: string;
			/** Joins the person into `teamId`; returns the membership id. */
			joinNew(person: { userId: string }): Promise<string>;
			rejoin(person: SeededEmployee): Promise<string>;
		};
		const PATHS: Path[] = [
			{
				name: "invite code",
				joinNew: (person) => joinWithInviteCode(person, teamId),
				rejoin: async (person) => {
					await joinWithInviteCode(person, teamId);
					return person.memberId;
				},
			},
			{
				name: "pending-member approval",
				joinNew: (person) => approvePendingJoin(person, teamId),
				rejoin: (person) => approvePendingRejoin(person, teamId),
			},
		];

		describe.each(PATHS)("$name", (path) => {
			it("joins a new member as an employee placed in the team, with the seat signal", async () => {
				const person = await newUser();
				const memberId = await path.joinNew(person);

				expect(await employeesOf(person.userId)).toEqual([
					{
						role: "employee",
						is_active: true,
						team_id: teamId,
						team_memberships: [teamId],
						org_wide_permissions: 0,
					},
				]);
				expect(harness.seatSignals).toEqual([
					seatSignal(person.userId, memberId),
				]);
			});

			it("reactivates a deactivated returner onto the current roster and places them in the team", async () => {
				const person = await deactivatedPerson();
				const memberId = await path.rejoin(person);

				expect(await employeesOf(person.userId)).toEqual([
					{
						role: "employee",
						is_active: true,
						team_id: teamId,
						team_memberships: [teamId],
						org_wide_permissions: 0,
					},
				]);
				expect(harness.seatSignals).toEqual([
					seatSignal(person.userId, memberId),
				]);
			});

			it("leaves a departed returner off the current roster and does not place them (#1641)", async () => {
				const person = await departedPerson();
				await path.rejoin(person);

				expect(await employeesOf(person.userId)).toEqual([
					{
						role: "employee",
						is_active: false,
						team_id: null,
						team_memberships: [],
						org_wide_permissions: 0,
					},
				]);
				expect(await ledger(person)).toMatchObject([{ reactivated_at: null }]);
			});
		});

		it("gives an admin membership approved from pending an admin employee with organization-wide team permissions", async () => {
			const person = await newUser();
			await approvePendingJoin(person, null, async (memberId) => {
				await fixture.pool.query("update member set role = 'admin' where id = $1", [
					memberId,
				]);
			});

			expect(await employeesOf(person.userId)).toEqual([
				{
					role: "admin",
					is_active: true,
					team_id: null,
					team_memberships: [],
					org_wide_permissions: 1,
				},
			]);
		});

		it("signals the seat after an existing approved member rejoins by invite code (#1642)", async () => {
			const person = await deactivatedPerson();
			await joinWithInviteCode(person);

			expect(harness.seatSignals).toEqual([
				seatSignal(person.userId, person.memberId),
			]);
		});
	});
});
