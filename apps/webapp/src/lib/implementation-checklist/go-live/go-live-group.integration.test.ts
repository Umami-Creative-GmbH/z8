import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { workPolicyGoLiveCheck } from "./checks/work-policy";
import { resolveGoLiveGroup } from "./group";
import {
	chooseGoLiveGroupTeams,
	createGoLiveExclusion,
	liftGoLiveExclusion,
	loadGoLiveGroupSettings,
} from "./group-settings";
import { goLiveAsOf, runGoLiveChecks } from "./run";
import type { GoLiveMember } from "./types";

const AS_OF = goLiveAsOf(parseInstant("2026-06-15T10:00:00Z"), "Europe/Berlin");

describe("go-live group (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	let db: DatabaseClient;

	async function createOrganizationWithOwner() {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		return { organizationId, owner };
	}

	async function createTeam(organizationId: string, name: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into team (organization_id, name, updated_at) values ($1, $2, now()) returning id`,
			[organizationId, name],
		);
		const id = rows[0]?.id;
		if (!id) throw new Error("team insert returned no row");
		return id;
	}

	/** A pending invitation with its employee invitation draft. */
	async function invite(
		organizationId: string,
		email: string,
		input: {
			teamId?: string | null;
			name?: [string, string];
			status?: string;
			expiresAt?: string;
		} = {},
	) {
		const invitationId = randomUUID();
		await fixture.pool.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id, created_at)
			 values ($1, $2, $3, 'member', $4, $5, $6, now())`,
			[
				invitationId,
				organizationId,
				email,
				input.status ?? "pending",
				input.expiresAt ?? "2026-07-01T00:00:00Z",
				fixture.ownerUserId,
			],
		);
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into employee_invitation_draft
			 (invitation_id, organization_id, normalized_email, team_id, first_name, last_name, updated_at)
			 values ($1, $2, $3, $4, $5, $6, now()) returning id`,
			[
				invitationId,
				organizationId,
				email.trim().toLowerCase(),
				input.teamId ?? null,
				input.name?.[0] ?? null,
				input.name?.[1] ?? null,
			],
		);
		const draftId = rows[0]?.id;
		if (!draftId) throw new Error("draft insert returned no row");
		return draftId;
	}

	async function assignTeamPolicy(organizationId: string, teamId: string, name: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[organizationId, name, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, team_id, priority, created_by, updated_at)
			 values ($1, $2, 'team', $3, 1, $4, now())`,
			[rows[0]?.id, organizationId, teamId, fixture.ownerUserId],
		);
	}

	async function seedInTeam(organizationId: string, teamId: string) {
		const seeded = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(`update employee set team_id = $1 where id = $2`, [
			teamId,
			seeded.employeeId,
		]);
		return seeded;
	}

	async function addSecondaryMembership(
		organizationId: string,
		teamId: string,
		employeeId: string,
	) {
		await fixture.pool.query(
			`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
			[organizationId, teamId, employeeId],
		);
	}

	async function auditEntries(organizationId: string, action: string) {
		const { rows } = await fixture.pool.query<{
			entity_type: string;
			entity_id: string;
			performed_by: string;
			employee_id: string | null;
			changes: string | null;
			metadata: string | null;
		}>(
			`select entity_type, entity_id, performed_by, employee_id, changes, metadata
			 from audit_log where organization_id = $1 and action = $2 order by timestamp`,
			[organizationId, action],
		);
		return rows;
	}

	function keys(members: readonly GoLiveMember[]) {
		return members
			.map((member) =>
				member.kind === "employee" ? `employee:${member.employeeId}` : `invitee:${member.draftId}`,
			)
			.sort();
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		db = fixture.db as unknown as DatabaseClient;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("adds pending invitees, with their draft team or none, to the current roster", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const warehouse = await createTeam(organizationId, "Warehouse");
		const picker = await invite(organizationId, `${randomUUID()}@invitee.test`, {
			teamId: warehouse,
			name: ["Pia", "Picker"],
		});
		const unplacedEmail = `${randomUUID()}@invitee.test`;
		const unplaced = await invite(organizationId, unplacedEmail);
		// Not pending: expired, accepted, or already an employee here.
		await invite(organizationId, `${randomUUID()}@invitee.test`, {
			expiresAt: "2026-06-01T00:00:00Z",
		});
		await invite(organizationId, `${randomUUID()}@invitee.test`, { status: "accepted" });
		const joined = await fixture.seedEmployee({ organizationId });
		await invite(organizationId, `${joined.userId}@lifecycle.test`);
		// Another organization's invitee never shows up here.
		const elsewhere = await createOrganizationWithOwner();
		await invite(elsewhere.organizationId, `${randomUUID()}@invitee.test`);

		const group = await resolveGoLiveGroup(db, organizationId, AS_OF);

		expect(keys(group.members)).toEqual(
			[
				`employee:${owner.employeeId}`,
				`employee:${joined.employeeId}`,
				`invitee:${picker}`,
				`invitee:${unplaced}`,
			].sort(),
		);
		expect(group.members).toContainEqual({
			kind: "invitee",
			draftId: picker,
			email: expect.stringContaining("@invitee.test"),
			teamId: warehouse,
			displayName: "Pia Picker",
		});
		expect(group.members).toContainEqual({
			kind: "invitee",
			draftId: unplaced,
			email: unplacedEmail,
			teamId: null,
			displayName: unplacedEmail,
		});
		expect(group.teamNames.get(warehouse)).toBe("Warehouse");
	});

	it("narrows to chosen teams by primary or draft team only, and audits the choice", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const warehouse = await createTeam(organizationId, "Warehouse");
		const office = await createTeam(organizationId, "Office");
		const picker = await seedInTeam(organizationId, warehouse);
		const clerk = await seedInTeam(organizationId, office);
		// The clerk is also a (secondary) member of the warehouse team: that doesn't count.
		await addSecondaryMembership(organizationId, warehouse, clerk.employeeId);
		const invitedPicker = await invite(organizationId, `${randomUUID()}@invitee.test`, {
			teamId: warehouse,
		});
		await invite(organizationId, `${randomUUID()}@invitee.test`, { teamId: office });
		await invite(organizationId, `${randomUUID()}@invitee.test`);

		const result = await chooseGoLiveGroupTeams(db, {
			organizationId,
			actorUserId: owner.userId,
			teamIds: [warehouse],
		});
		const group = await resolveGoLiveGroup(db, organizationId, AS_OF);

		expect(result).toEqual({ ok: true });
		expect(keys(group.members)).toEqual(
			[`employee:${picker.employeeId}`, `invitee:${invitedPicker}`].sort(),
		);
		const [entry] = await auditEntries(organizationId, "go_live.group_teams_changed");
		expect(entry).toMatchObject({
			entity_type: "organization",
			entity_id: organizationId,
			performed_by: owner.userId,
		});
		expect(JSON.parse(entry?.changes ?? "null")).toEqual({
			teams: { from: [], to: [{ id: warehouse, name: "Warehouse" }] },
		});

		// Choosing no teams again brings everyone back.
		await chooseGoLiveGroupTeams(db, {
			organizationId,
			actorUserId: owner.userId,
			teamIds: [],
		});
		expect((await resolveGoLiveGroup(db, organizationId, AS_OF)).members).toHaveLength(6);
		expect(await auditEntries(organizationId, "go_live.group_teams_changed")).toHaveLength(2);
	});

	it("refuses another organization's team and keeps the choice", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const own = await createTeam(organizationId, "Own");
		const elsewhere = await createOrganizationWithOwner();
		const foreign = await createTeam(elsewhere.organizationId, "Foreign");
		await chooseGoLiveGroupTeams(db, {
			organizationId,
			actorUserId: owner.userId,
			teamIds: [own],
		});

		const result = await chooseGoLiveGroupTeams(db, {
			organizationId,
			actorUserId: owner.userId,
			teamIds: [own, foreign],
		});

		expect(result).toEqual({ ok: false, refusal: "team_not_found" });
		const settings = await loadGoLiveGroupSettings(db, organizationId, AS_OF);
		expect(settings.chosenTeamIds).toEqual([own]);
		expect(await auditEntries(organizationId, "go_live.group_teams_changed")).toHaveLength(1);
	});

	it("excludes an employee only with a reason, lists who and when, and lifting brings them back", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const director = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(`update "user" set name = 'Dana Director' where id = $1`, [
			director.userId,
		]);
		await fixture.pool.query(`update "user" set name = 'Olga Owner' where id = $1`, [owner.userId]);

		const blank = await createGoLiveExclusion(db, {
			organizationId,
			actorUserId: owner.userId,
			employeeId: director.employeeId,
			reason: "   ",
		});
		const created = await createGoLiveExclusion(db, {
			organizationId,
			actorUserId: owner.userId,
			employeeId: director.employeeId,
			reason: "  Director, doesn't track time ",
		});

		expect(blank).toEqual({ ok: false, refusal: "reason_required" });
		expect(created).toEqual({ ok: true });
		expect(keys((await resolveGoLiveGroup(db, organizationId, AS_OF)).members)).toEqual([
			`employee:${owner.employeeId}`,
		]);
		const { exclusions } = await loadGoLiveGroupSettings(db, organizationId, AS_OF);
		expect(exclusions).toEqual([
			{
				id: expect.any(String),
				employeeId: director.employeeId,
				displayName: "Dana Director",
				reason: "Director, doesn't track time",
				createdByName: "Olga Owner",
				createdAt: expect.stringMatching(/Z$/),
			},
		]);
		const [createdEntry] = await auditEntries(organizationId, "go_live.exclusion_created");
		expect(createdEntry).toMatchObject({
			entity_type: "go_live_exclusion",
			entity_id: exclusions[0]?.id,
			performed_by: owner.userId,
			employee_id: director.employeeId,
		});
		expect(JSON.parse(createdEntry?.metadata ?? "null")).toEqual({
			reason: "Director, doesn't track time",
		});

		const lifted = await liftGoLiveExclusion(db, {
			organizationId,
			actorUserId: owner.userId,
			exclusionId: exclusions[0]?.id ?? "",
		});

		expect(lifted).toEqual({ ok: true });
		expect(keys((await resolveGoLiveGroup(db, organizationId, AS_OF)).members)).toEqual(
			[`employee:${owner.employeeId}`, `employee:${director.employeeId}`].sort(),
		);
		expect((await loadGoLiveGroupSettings(db, organizationId, AS_OF)).exclusions).toEqual([]);
		const [liftedEntry] = await auditEntries(organizationId, "go_live.exclusion_lifted");
		expect(liftedEntry).toMatchObject({
			entity_type: "go_live_exclusion",
			entity_id: exclusions[0]?.id,
			performed_by: owner.userId,
			employee_id: director.employeeId,
		});
		expect(JSON.parse(liftedEntry?.metadata ?? "null")).toEqual({
			reason: "Director, doesn't track time",
		});
		// Lifted once: lifting again changes nothing.
		expect(
			await liftGoLiveExclusion(db, {
				organizationId,
				actorUserId: owner.userId,
				exclusionId: exclusions[0]?.id ?? "",
			}),
		).toEqual({ ok: false, refusal: "exclusion_not_found" });
	});

	it("refuses former employees, other organizations' employees and exclusions, and a second exclusion", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const former = await fixture.seedEmployee({ organizationId, isActive: false });
		const current = await fixture.seedEmployee({ organizationId });
		const elsewhere = await createOrganizationWithOwner();
		const outsider = await fixture.seedEmployee({ organizationId: elsewhere.organizationId });
		const exclude = (employeeId: string, orgId = organizationId, actor = owner.userId) =>
			createGoLiveExclusion(db, {
				organizationId: orgId,
				actorUserId: actor,
				employeeId,
				reason: "Not going live",
			});

		expect(await exclude(former.employeeId)).toEqual({ ok: false, refusal: "employee_not_found" });
		expect(await exclude(outsider.employeeId)).toEqual({
			ok: false,
			refusal: "employee_not_found",
		});
		expect(await exclude(current.employeeId)).toEqual({ ok: true });
		expect(await exclude(current.employeeId)).toEqual({ ok: false, refusal: "already_excluded" });

		await exclude(outsider.employeeId, elsewhere.organizationId, elsewhere.owner.userId);
		const [foreign] = (await loadGoLiveGroupSettings(db, elsewhere.organizationId, AS_OF))
			.exclusions;
		expect(
			await liftGoLiveExclusion(db, {
				organizationId,
				actorUserId: owner.userId,
				exclusionId: foreign?.id ?? "",
			}),
		).toEqual({ ok: false, refusal: "exclusion_not_found" });
		expect(await auditEntries(organizationId, "go_live.exclusion_created")).toHaveLength(1);
		expect(await auditEntries(organizationId, "go_live.exclusion_lifted")).toHaveLength(0);
	});

	it("resolves invitees' work policy from their draft team, else at organization level", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const warehouse = await createTeam(organizationId, "Warehouse");
		await assignTeamPolicy(organizationId, warehouse, "Warehouse hours");
		await fixture.pool.query(`update employee set team_id = $1 where id = $2`, [
			warehouse,
			owner.employeeId,
		]);
		await invite(organizationId, `${randomUUID()}@invitee.test`, { teamId: warehouse });
		const unplacedEmail = `${randomUUID()}@invitee.test`;
		const unplaced = await invite(organizationId, unplacedEmail);

		const { results } = await runGoLiveChecks({
			db,
			organizationId,
			asOf: AS_OF,
			fixLink: (href, label) => ({ href, label }),
			checks: [workPolicyGoLiveCheck],
		});
		const [result] = results;

		if (!result || result.outcome === "unavailable") throw new Error("unexpected");
		expect(result).toMatchObject({ outcome: "failed", checkedMemberCount: 3 });
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({
			cause: "work-policy:no-team",
			members: [
				{
					member: {
						kind: "invitee",
						draftId: unplaced,
						displayName: unplacedEmail,
					},
				},
			],
		});
	});

	it("ends an exclusion when the employee becomes former; a rehired employee needs a new one", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const leaver = await fixture.seedEmployee({ organizationId });
		await createGoLiveExclusion(db, {
			organizationId,
			actorUserId: owner.userId,
			employeeId: leaver.employeeId,
			reason: "Leaving soon",
		});
		const [exclusion] = (await loadGoLiveGroupSettings(db, organizationId, AS_OF)).exclusions;

		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			leaver.employeeId,
		]);

		const { rows } = await fixture.pool.query<{ ended_at: Date | null }>(
			`select ended_at from go_live_exclusion where id = $1`,
			[exclusion?.id],
		);
		expect(rows[0]?.ended_at).not.toBeNull();
		expect((await loadGoLiveGroupSettings(db, organizationId, AS_OF)).exclusions).toEqual([]);
		expect(
			await liftGoLiveExclusion(db, {
				organizationId,
				actorUserId: owner.userId,
				exclusionId: exclusion?.id ?? "",
			}),
		).toEqual({ ok: false, refusal: "exclusion_not_found" });

		// Back on the roster, they are checked again until someone excludes them anew.
		await fixture.pool.query(`update employee set is_active = true where id = $1`, [
			leaver.employeeId,
		]);
		expect(keys((await resolveGoLiveGroup(db, organizationId, AS_OF)).members)).toContain(
			`employee:${leaver.employeeId}`,
		);
		expect(
			await createGoLiveExclusion(db, {
				organizationId,
				actorUserId: owner.userId,
				employeeId: leaver.employeeId,
				reason: "Still not going live",
			}),
		).toEqual({ ok: true });
	});
});
