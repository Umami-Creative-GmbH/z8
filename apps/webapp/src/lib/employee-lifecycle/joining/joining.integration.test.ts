/**
 * #1665 (spec #1664): Joining owns what follows an approved membership. One
 * suite at the module's interface over the state matrix: no employee, current,
 * deactivated, follow-up deactivation pending and departed without rehire,
 * crossed with the member role, a team given or not, and a draft or not. It
 * asserts the rows and the returned after-commit step.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	reconcileBillingSeatsForOrganization: async () => undefined,
	syncBillingSeatsAfterMemberChange: async () => undefined,
}));
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return { ...original, createLogger: () => ({ ...quiet, child: () => quiet }) };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const { db } = await import("@/db");
const { parseInstant } = await import("@/lib/datetime/temporal-core");
const { joinOrganization } = await import("./joining");
const { joinMemberWithoutEmployee } = await import("./repairs");
const { recordFollowUpDeactivation } = await import("../deactivation/follow-up-record");
const { insertDeactivation } = await import("../receipts");
const { createLifecycleDatabaseFixture } = await import("../testing/database.test.fixture");
type LifecycleDatabaseFixture = import("../testing/database.test.fixture").LifecycleDatabaseFixture;
type JoiningInput = Parameters<typeof joinOrganization>[1];

type MemberRole = "member" | "admin";
type State = "no employee" | "current" | "deactivated" | "follow-up pending" | "departed";
type Person = { userId: string; memberId: string; role: MemberRole; employeeId: string | null };

const DRAFT = { role: "manager", firstName: "Ada", position: "Analyst", hourlyRate: "21.50" };

describe("joining an organization (#1665)", () => {
	let fixture: LifecycleDatabaseFixture;
	let draftTeamId: string;
	let givenTeamId: string;
	const userIds: string[] = [];

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		draftTeamId = await seedTeam("Draft team");
		givenTeamId = await seedTeam("Given team");
	});
	afterAll(async () => {
		await fixture?.close();
		await fixture?.pool.query(`delete from "user" where id = any($1::text[])`, [userIds]);
	});

	async function seedTeam(name: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into team (organization_id, name, updated_at) values ($1, $2, now()) returning id`,
			[fixture.organizationId, name],
		);
		return rows[0]?.id as string;
	}

	/** A user who just gained an approved membership and has no employee yet. */
	async function newMember(role: MemberRole): Promise<Person> {
		const userId = randomUUID();
		const memberId = randomUUID();
		await fixture.pool.query(
			`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'Joiner', $2, now(), now())`,
			[userId, `${userId}@joining.test`],
		);
		userIds.push(userId);
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, $4, 'approved', now())`,
			[memberId, fixture.organizationId, userId, role],
		);
		return { userId, memberId, role, employeeId: null };
	}

	/** Someone with an employee, as an `employee`, whatever their membership role. */
	async function employedMember(
		role: MemberRole,
	): Promise<Person & { employmentPeriodId: string }> {
		const seeded = await fixture.seedEmployee({ role });
		await fixture.pool.query("update employee set role = 'employee' where id = $1", [
			seeded.employeeId,
		]);
		return { ...seeded, role };
	}

	async function deactivate(person: { employeeId: string; employmentPeriodId: string }) {
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			person.employeeId,
		]);
		await insertDeactivation(fixture.db, {
			organizationId: fixture.organizationId,
			employeeId: person.employeeId,
			employmentPeriodId: person.employmentPeriodId,
			deactivatedAt: parseInstant("2026-01-05T08:00:00Z"),
			createdBy: fixture.ownerUserId,
			reason: "employee_deactivated",
			requestId: randomUUID(),
			requestFingerprint: "test",
			replacementManagers: {},
		});
	}

	async function personIn(state: State, role: MemberRole): Promise<Person> {
		if (state === "no employee") return newMember(role);
		const person = await employedMember(role);
		if (state === "deactivated" || state === "departed") await deactivate(person);
		if (state === "follow-up pending") {
			// A member removal: switched off and recorded pending in one transaction (#1629).
			await fixture.db.transaction(async (tx) => {
				await tx.execute(
					sql`update employee set is_active = false where id = ${person.employeeId}::uuid`,
				);
				await recordFollowUpDeactivation(tx, {
					organizationId: fixture.organizationId,
					employeeId: person.employeeId,
					createdBy: fixture.ownerUserId,
					reason: "member_removed",
				});
			});
		}
		if (state === "departed") {
			await fixture.pool.query(
				`insert into employee_departure
				 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
				  cutoff_at, created_by, request_id, request_fingerprint, revision, status, effective_at)
				 values ($1, $2, $3, 'immediate', '2026-01-06', 'UTC', '2026-01-07T08:00:00Z', $4,
				         gen_random_uuid(), 'test', 1, 'effective', '2026-01-07T08:00:00Z')`,
				[fixture.organizationId, person.employeeId, person.employmentPeriodId, fixture.ownerUserId],
			);
			await fixture.pool.query(
				`update employee_employment_period set status = 'closed', ended_at = '2026-01-07T08:00:00Z' where id = $1`,
				[person.employmentPeriodId],
			);
		}
		return person;
	}

	/** An accepted invitation for the person with a draft naming the draft team. */
	async function inviteWithDraft(person: Person) {
		const invitationId = randomUUID();
		const personnelNumber = `P-${invitationId.slice(0, 8)}`;
		const email = `${person.userId}@${person.employeeId ? "lifecycle" : "joining"}.test`;
		await fixture.pool.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
			 values ($1, $2, $3, $4, 'accepted', now() + interval '7 days', $5)`,
			[invitationId, fixture.organizationId, email, person.role, fixture.ownerUserId],
		);
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into employee_invitation_draft
			   (invitation_id, organization_id, normalized_email, team_id, role, first_name, position,
			    employee_number, contract_type, current_hourly_rate)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, 'hourly', $9)
			 returning id`,
			[
				invitationId,
				fixture.organizationId,
				email,
				draftTeamId,
				DRAFT.role,
				DRAFT.firstName,
				DRAFT.position,
				personnelNumber,
				DRAFT.hourlyRate,
			],
		);
		return { invitationId, draftId: rows[0]?.id as string, personnelNumber };
	}

	function join(person: Person, input: Partial<JoiningInput> = {}) {
		return db.transaction((tx) =>
			joinOrganization(tx, {
				organizationId: fixture.organizationId,
				userId: person.userId,
				membership: { id: person.memberId, role: person.role },
				...input,
			}),
		);
	}

	/** Everything joining may write for the person. */
	async function rowsOf(userId: string) {
		const { rows } = await fixture.pool.query(
			`select e.id, e.role, e.is_active, e.team_id, e.first_name, e.position, e.employee_number,
			   (select count(*)::int from employee_employment_history h where h.employee_id = e.id) as terms,
			   (select count(*)::int from team_permissions p
			      where p.employee_id = e.id and p.team_id is null) as org_wide_permissions,
			   (select coalesce(array_agg(m.team_id::text order by m.team_id), '{}') from team_membership m
			      where m.employee_id = e.id) as team_memberships
			 from employee e where e.organization_id = $1 and e.user_id = $2`,
			[fixture.organizationId, userId],
		);
		return rows;
	}

	async function draftExists(draftId: string) {
		const { rows } = await fixture.pool.query(
			"select 1 from employee_invitation_draft where id = $1",
			[draftId],
		);
		return rows.length > 0;
	}

	async function notAppliedAudits(draftId: string) {
		const { rows } = await fixture.pool.query(
			`select performed_by, employee_id from audit_log
			 where organization_id = $1 and entity_id = $2 and action = 'employee.invitation_draft_not_applied'`,
			[fixture.organizationId, draftId],
		);
		return rows;
	}

	type Expected = {
		kind: "joined" | "reactivated" | "already_current" | "membership_only";
		/** Whether joining writes the draft, the team and the permissions. */
		writes: boolean;
		isActive: boolean;
		/** Whether a given team (without a draft) places the employee. */
		placesGivenTeam: boolean;
		/** The role without a draft: admin for an admin membership, else this. */
		roleWithoutDraft: "employee";
	};

	const STATES: Array<[State, Expected]> = [
		[
			"no employee",
			{
				kind: "joined",
				writes: true,
				isActive: true,
				placesGivenTeam: true,
				roleWithoutDraft: "employee",
			},
		],
		[
			"current",
			{
				kind: "already_current",
				writes: false,
				isActive: true,
				placesGivenTeam: false,
				roleWithoutDraft: "employee",
			},
		],
		[
			"deactivated",
			{
				kind: "reactivated",
				writes: true,
				isActive: true,
				placesGivenTeam: true,
				roleWithoutDraft: "employee",
			},
		],
		[
			"follow-up pending",
			{
				kind: "reactivated",
				writes: true,
				isActive: true,
				placesGivenTeam: true,
				roleWithoutDraft: "employee",
			},
		],
		[
			"departed",
			{
				kind: "membership_only",
				writes: false,
				isActive: false,
				placesGivenTeam: false,
				roleWithoutDraft: "employee",
			},
		],
	];
	const VARIANTS = (["member", "admin"] as const).flatMap((role) =>
		[false, true].flatMap((teamGiven) =>
			[false, true].map((withDraft) => ({ role, teamGiven, withDraft })),
		),
	);

	describe.each(STATES)("%s", (state, expected) => {
		it.each(VARIANTS)(
			"$role membership, team given: $teamGiven, draft: $withDraft",
			async ({ role, teamGiven, withDraft }) => {
				const person = await personIn(state, role);
				const draft = withDraft ? await inviteWithDraft(person) : null;

				const joined = await join(person, {
					...(teamGiven ? { teamId: givenTeamId } : {}),
					...(draft ? { invitation: { id: draft.invitationId } } : {}),
				});

				const [row, ...others] = await rowsOf(person.userId);
				expect(others).toEqual([]);
				expect(joined.outcome).toMatchObject({ kind: expected.kind, employee: { id: row?.id } });
				if (person.employeeId) expect(row?.id).toBe(person.employeeId);

				const writtenTeam = draft
					? draftTeamId
					: teamGiven && expected.placesGivenTeam
						? givenTeamId
						: null;
				const writtenRole = draft
					? DRAFT.role
					: role === "admin"
						? "admin"
						: expected.roleWithoutDraft;
				expect(row).toEqual({
					id: expect.any(String),
					is_active: expected.isActive,
					role: expected.writes ? writtenRole : "employee",
					team_id: expected.writes ? writtenTeam : null,
					team_memberships: expected.writes && writtenTeam ? [writtenTeam] : [],
					first_name: expected.writes && draft ? DRAFT.firstName : null,
					position: expected.writes && draft ? DRAFT.position : null,
					employee_number: expected.writes && draft ? draft.personnelNumber : null,
					terms: expected.writes && draft ? 1 : 0,
					org_wide_permissions: expected.writes && role === "admin" ? 1 : 0,
				});

				expect(joined.afterCommit.seatSignal).toEqual({
					organizationId: fixture.organizationId,
					memberId: person.memberId,
					userId: person.userId,
					change: "added",
				});
				expect(joined.afterCommit.draftCleanup).toEqual(
					draft
						? {
								organizationId: fixture.organizationId,
								draftId: draft.draftId,
								allowStaleLinkedInvitation: false,
							}
						: null,
				);
				if (draft) {
					expect(await notAppliedAudits(draft.draftId)).toEqual(
						expected.kind === "membership_only"
							? [{ performed_by: person.userId, employee_id: row?.id }]
							: [],
					);
					await joined.afterCommit.run();
					// Applied or not, the accepted invitation's draft is consumed.
					expect(await draftExists(draft.draftId)).toBe(false);
				}
			},
		);
	});

	it("records who brought a returning employee back", async () => {
		const person = await personIn("deactivated", "member");

		const joined = await join(person, { actorUserId: fixture.ownerUserId });

		expect(joined.outcome).toMatchObject({
			kind: "reactivated",
			reactivationRequestId: expect.any(String),
		});
		const { rows } = await fixture.pool.query(
			"select reactivated_by from employee_deactivation where employee_id = $1",
			[person.employeeId],
		);
		expect(rows).toEqual([{ reactivated_by: fixture.ownerUserId }]);
	});

	it("writes only what a sparse draft sets onto a reactivated employee", async () => {
		const person = await personIn("deactivated", "member");
		await fixture.pool.query(
			"update employee set first_name = 'Grace', position = 'Engineer' where id = $1",
			[person.employeeId],
		);
		const draft = await inviteWithDraft(person);
		await fixture.pool.query(
			"update employee_invitation_draft set first_name = null, team_id = null where id = $1",
			[draft.draftId],
		);

		await join(person, { invitation: { id: draft.invitationId } });

		expect(await rowsOf(person.userId)).toEqual([
			expect.objectContaining({
				first_name: "Grace",
				position: DRAFT.position,
				role: DRAFT.role,
				team_id: null,
			}),
		]);
	});

	it("rolls everything back with the caller's transaction", async () => {
		const person = await personIn("deactivated", "admin");
		const draft = await inviteWithDraft(person);

		await expect(
			db.transaction(async (tx) => {
				await joinOrganization(tx, {
					organizationId: fixture.organizationId,
					userId: person.userId,
					membership: { id: person.memberId, role: person.role },
					invitation: { id: draft.invitationId },
				});
				throw new Error("the membership failed after joining");
			}),
		).rejects.toThrow("the membership failed after joining");

		expect(await rowsOf(person.userId)).toEqual([
			expect.objectContaining({ is_active: false, role: "employee", team_id: null, terms: 0 }),
		]);
		expect(await draftExists(draft.draftId)).toBe(true);
	});

	it("finds a direct member add's draft by email, also for a replacement invitation that went stale", async () => {
		const person = await newMember("member");
		const draft = await inviteWithDraft(person);
		await fixture.pool.query(
			"update invitation set status = 'pending', expires_at = now() - interval '1 day' where id = $1",
			[draft.invitationId],
		);

		const joined = await join(person, { invitation: { id: null } });
		await joined.afterCommit.run();

		expect(joined.outcome.employee).toMatchObject({ firstName: DRAFT.firstName });
		expect(joined.afterCommit.draftCleanup).toMatchObject({ allowStaleLinkedInvitation: true });
		expect(await draftExists(draft.draftId)).toBe(false);
	});

	it("uses no draft when no invitation is given", async () => {
		const person = await newMember("member");
		const draft = await inviteWithDraft(person);

		const joined = await join(person);

		expect(joined.outcome.employee).toMatchObject({ firstName: null, role: "employee" });
		expect(joined.afterCommit.draftCleanup).toBeNull();
		expect(await draftExists(draft.draftId)).toBe(true);
	});

	it("ignores a team of another organization", async () => {
		const person = await newMember("member");
		const otherOrganizationId = await fixture.createOrganization();
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into team (organization_id, name, updated_at) values ($1, 'Elsewhere', now()) returning id`,
			[otherOrganizationId],
		);

		const joined = await join(person, { teamId: rows[0]?.id });

		expect(joined.outcome.employee).toMatchObject({ teamId: null });
	});

	it("takes the user guard before the identity lock, and writes nothing before both", async () => {
		const person = await newMember("member");
		const email = `${person.userId}@joining.test`;
		// Another writer holds the organization identity lock of the person's email.
		const identityHolder: PoolClient = await fixture.pool.connect();
		const guardProbe: PoolClient = await fixture.pool.connect();
		try {
			await identityHolder.query("begin");
			await identityHolder.query(
				`select pg_advisory_xact_lock(hashtextextended(jsonb_build_array($1::text, $2::text)::text, 0))`,
				[fixture.organizationId, email],
			);

			const joining = join(person);
			await vi.waitFor(
				async () => {
					const { rows } = await fixture.pool.query(
						`select 1 from pg_locks where locktype = 'advisory' and not granted`,
					);
					expect(rows.length).toBeGreaterThan(0);
				},
				{ timeout: 20_000, interval: 50 },
			);
			expect(await rowsOf(person.userId)).toEqual([]);

			// Joining already holds the user's exclusive guard while it waits.
			const { acquireExclusiveUserConfigurationAccessGuards } = await import(
				"@/lib/time-tracking/work-transaction"
			);
			const { drizzle } = await import("drizzle-orm/node-postgres");
			await guardProbe.query("begin");
			await guardProbe.query("set local lock_timeout = '200ms'");
			await expect(
				acquireExclusiveUserConfigurationAccessGuards(drizzle({ client: guardProbe }), [
					person.userId,
				]),
			).rejects.toThrow();
			await guardProbe.query("rollback");

			await identityHolder.query("commit");
			const joined = await joining;
			expect(joined.outcome.kind).toBe("joined");
		} finally {
			identityHolder.release();
			guardProbe.release();
		}
	});

	describe("repairs on read", () => {
		it("join a member without an employee, without a seat signal", async () => {
			const person = await newMember("admin");

			const repaired = await joinMemberWithoutEmployee(db, {
				organizationId: fixture.organizationId,
				userId: person.userId,
				membership: { id: person.memberId, role: person.role },
			});

			expect(repaired).toMatchObject({ role: "admin", isActive: true });
		});

		it("never reactivate a member who has an employee", async () => {
			const person = await personIn("deactivated", "member");

			const repaired = await joinMemberWithoutEmployee(db, {
				organizationId: fixture.organizationId,
				userId: person.userId,
				membership: { id: person.memberId, role: person.role },
			});

			expect(repaired).toMatchObject({ id: person.employeeId, isActive: false });
			expect(await rowsOf(person.userId)).toEqual([expect.objectContaining({ is_active: false })]);
		});
	});
});
