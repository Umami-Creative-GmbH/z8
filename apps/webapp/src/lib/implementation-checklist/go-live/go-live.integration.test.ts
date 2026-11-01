import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { resolveImplementationChecklistItems } from "../status";
import { workPolicyGoLiveCheck } from "./checks/work-policy";
import { resolveGoLiveGroup } from "./group";
import { resolveGoLiveReadiness } from "./readiness";
import { goLiveAsOf, runGoLiveChecks } from "./run";
import type { GoLiveCheckResult, GoLiveFixLinkResolver, GoLiveMember } from "./types";

const AS_OF = goLiveAsOf(parseInstant("2026-06-15T10:00:00Z"), "Europe/Berlin");
const allowEveryLink: GoLiveFixLinkResolver = (href, label) => ({ href, label });

describe("go-live checks (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	let db: DatabaseClient;

	async function createOrganizationWithOwner() {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		return { organizationId, owner };
	}

	async function createPolicy(organizationId: string, name: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[organizationId, name, fixture.ownerUserId],
		);
		const id = rows[0]?.id;
		if (!id) throw new Error("work policy insert returned no row");
		return id;
	}

	async function assign(
		organizationId: string,
		policyId: string,
		target: { type: "organization" } | { type: "team"; teamId: string },
	) {
		await fixture.pool.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, team_id, priority, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, now())`,
			[
				policyId,
				organizationId,
				target.type,
				target.type === "team" ? target.teamId : null,
				target.type === "team" ? 1 : 0,
				fixture.ownerUserId,
			],
		);
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

	async function seedNamed(organizationId: string, name: string, teamId: string | null = null) {
		const seeded = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(`update "user" set name = $1 where id = $2`, [name, seeded.userId]);
		if (teamId) {
			await fixture.pool.query(`update employee set team_id = $1 where id = $2`, [
				teamId,
				seeded.employeeId,
			]);
		}
		return seeded;
	}

	async function seedOwnerWithoutEmployee(organizationId: string) {
		const userId = randomUUID();
		await fixture.pool.query(
			`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'Owner only', $2, now(), now())`,
			[userId, `${userId}@lifecycle.test`],
		);
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, 'owner', 'approved', now())`,
			[randomUUID(), organizationId, userId],
		);
	}

	async function run(organizationId: string, fixLink = allowEveryLink, database = db) {
		const { results } = await runGoLiveChecks({
			db: database,
			organizationId,
			asOf: AS_OF,
			fixLink,
			checks: [workPolicyGoLiveCheck],
		});
		return results;
	}

	function workPolicyResult(results: GoLiveCheckResult[]) {
		const result = results.find((entry) => entry.checkId === "work-policy");
		if (!result) throw new Error("work-policy check did not run");
		return result;
	}

	function employeeIds(members: readonly { member: GoLiveMember }[]) {
		return members.map(({ member }) => (member.kind === "employee" ? member.employeeId : null));
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		db = fixture.db as unknown as DatabaseClient;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it("checks the current roster only: no former employees, no owners without an employee record", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const current = await seedNamed(organizationId, "Current");
		const deactivated = await fixture.seedEmployee({ organizationId, isActive: false });
		await seedOwnerWithoutEmployee(organizationId);
		const elsewhere = await createOrganizationWithOwner();

		const group = await resolveGoLiveGroup(db, organizationId, AS_OF);
		const ids = group.members.map((member) =>
			member.kind === "employee" ? member.employeeId : member.draftId,
		);

		expect(ids.sort()).toEqual([owner.employeeId, current.employeeId].sort());
		expect(ids).not.toContain(deactivated.employeeId);
		expect(ids).not.toContain(elsewhere.owner.employeeId);
		expect(
			group.members.find(
				(member) => member.kind === "employee" && member.employeeId === current.employeeId,
			),
		).toMatchObject({
			kind: "employee",
			displayName: "Current",
			primaryTeamId: null,
		});
	});

	it("groups employees without a policy by cause and links the fix", async () => {
		const { organizationId, owner } = await createOrganizationWithOwner();
		const warehouse = await createTeam(organizationId, "Warehouse");
		const office = await createTeam(organizationId, "Office");
		await assign(organizationId, await createPolicy(organizationId, "Office hours"), {
			type: "team",
			teamId: office,
		});
		const loner = await seedNamed(organizationId, "Loner");
		const picker = await seedNamed(organizationId, "Picker", warehouse);
		const packer = await seedNamed(organizationId, "Packer", warehouse);
		await seedNamed(organizationId, "Clerk", office);
		// Another organization's employee with no policy must never show up here.
		const elsewhere = await createOrganizationWithOwner();
		await seedNamed(elsewhere.organizationId, "Outsider");

		const result = workPolicyResult(await run(organizationId));

		expect(result).toMatchObject({ outcome: "failed", configured: true, checkedMemberCount: 5 });
		if (result.outcome === "unavailable") throw new Error("unexpected");
		const noTeam = result.failures.find((failure) => failure.cause === "work-policy:no-team");
		const team = result.failures.find(
			(failure) => failure.cause === `work-policy:team:${warehouse}`,
		);
		expect(result.failures).toHaveLength(2);
		expect(employeeIds(noTeam?.members ?? []).sort()).toEqual(
			[owner.employeeId, loner.employeeId].sort(),
		);
		expect(noTeam?.reason).toMatchObject({
			key: "settings.implementationChecklist.goLive.workPolicy.noTeamNoOrganizationPolicy",
			params: { count: 2 },
		});
		expect(employeeIds(team?.members ?? []).sort()).toEqual(
			[picker.employeeId, packer.employeeId].sort(),
		);
		expect(team?.reason).toMatchObject({
			key: "settings.implementationChecklist.goLive.workPolicy.teamWithoutPolicy",
			params: { team: "Warehouse", count: 2 },
		});
		expect(team?.fix?.href).toBe("/settings/work-policies?tab=work&view=assignments");

		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(),
			goLiveResults: [result],
		});
		expect(items.find((item) => item.id === "work-policies")?.status).toBe("needs-attention");
		expect(resolveGoLiveReadiness([result])).toEqual({
			status: "not-ready",
			affectedMemberCount: 4,
			warnings: [],
		});
	});

	it("leaves the fix link out when the viewer may not open the page", async () => {
		const { organizationId } = await createOrganizationWithOwner();

		const result = workPolicyResult(await run(organizationId, () => null));

		if (result.outcome === "unavailable") throw new Error("unexpected");
		expect(result.failures[0]?.fix).toBeNull();
	});

	it("shows a configured but unassigned work policy as configured with nobody to check", async () => {
		// Only an owner without an employee record, so nobody is on the roster.
		const organizationId = await fixture.createOrganization();
		await seedOwnerWithoutEmployee(organizationId);
		await createPolicy(organizationId, "Unassigned");

		const result = workPolicyResult(await run(organizationId));
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(),
			goLiveResults: [result],
		});

		expect(result).toMatchObject({ outcome: "passed", configured: true, checkedMemberCount: 0 });
		expect(items.find((item) => item.id === "work-policies")?.status).toBe("configured");
	});

	it("needs attention for an unassigned work policy once someone is on the roster", async () => {
		const { organizationId } = await createOrganizationWithOwner();
		await createPolicy(organizationId, "Unassigned");

		const result = workPolicyResult(await run(organizationId));

		expect(result).toMatchObject({ outcome: "failed", configured: true });
	});

	it("is not set up without any work policy", async () => {
		const { organizationId } = await createOrganizationWithOwner();

		const result = workPolicyResult(await run(organizationId));

		expect(result).toMatchObject({ outcome: "failed", configured: false });
	});

	it("verifies and is ready when every current employee has a policy", async () => {
		const { organizationId } = await createOrganizationWithOwner();
		await assign(organizationId, await createPolicy(organizationId, "Default"), {
			type: "organization",
		});
		await seedNamed(organizationId, "Covered");

		const results = await run(organizationId);
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(),
			goLiveResults: results,
		});

		expect(workPolicyResult(results)).toMatchObject({ outcome: "passed", checkedMemberCount: 2 });
		expect(items.find((item) => item.id === "work-policies")?.status).toBe("verified");
		expect(resolveGoLiveReadiness(results)).toEqual({ status: "ready", warnings: [] });
	});

	it("is unavailable, never passing, when a lookup fails", async () => {
		const { organizationId } = await createOrganizationWithOwner();
		await assign(organizationId, await createPolicy(organizationId, "Default"), {
			type: "organization",
		});
		const broken = new Proxy(db, {
			get(target, property, receiver) {
				if (property === "query") throw new Error("lookup failed");
				return Reflect.get(target, property, receiver);
			},
		});

		const results = await run(organizationId, allowEveryLink, broken);

		expect(workPolicyResult(results).outcome).toBe("unavailable");
		expect(resolveGoLiveReadiness(results)).toEqual({ status: "unavailable" });
		expect(
			resolveImplementationChecklistItems({
				detectedCompleteIds: new Set(["work-policies"]),
				manualCompleteIds: new Set(),
				goLiveResults: results,
			}).find((item) => item.id === "work-policies")?.status,
		).toBe("unavailable");
	});

	it("makes every check unavailable when the group cannot be resolved", async () => {
		const { organizationId } = await createOrganizationWithOwner();
		const broken = new Proxy(db, {
			get(target, property, receiver) {
				if (property === "select") throw new Error("lookup failed");
				return Reflect.get(target, property, receiver);
			},
		});

		const results = await run(organizationId, allowEveryLink, broken);

		expect(results.map((result) => result.outcome)).toEqual(["unavailable"]);
	});
});
