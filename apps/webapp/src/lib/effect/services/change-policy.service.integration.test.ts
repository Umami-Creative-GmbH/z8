/**
 * #1598: the change policy time corrections are checked against, resolved on real rows.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { ChangePolicyService, ChangePolicyServiceLive } from "./change-policy.service";
import { type DatabaseClient, DatabaseService, makeDatabaseService } from "./database.service";

const NOW = new Date("2026-06-15T10:00:00Z");

describe("ChangePolicyService (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let owner: { userId: string };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		organizationId = await fixture.createOrganization();
		owner = await fixture.seedEmployee({ organizationId, role: "owner" });
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);

	function run<A>(use: (service: ChangePolicyService["Service"]) => Effect.Effect<A, unknown>) {
		const database = Layer.succeed(
			DatabaseService,
			DatabaseService.of(makeDatabaseService(fixture.db as unknown as DatabaseClient)),
		);
		return Effect.runPromise(
			Effect.gen(function* () {
				return yield* use(yield* ChangePolicyService);
			}).pipe(Effect.provide(ChangePolicyServiceLive.pipe(Layer.provide(database)))),
		);
	}

	async function teamMember() {
		const { rows } = await sql(
			`insert into team (organization_id, name, updated_at) values ($1, 'Warehouse', now()) returning id`,
			[organizationId],
		);
		const teamId = rows[0].id as string;
		const seeded = await fixture.seedEmployee({ organizationId });
		await sql("update employee set team_id = $1 where id = $2", [teamId, seeded.employeeId]);
		return { teamId, employeeId: seeded.employeeId };
	}

	async function assignToTeam(teamId: string, effectiveUntil: string | null) {
		const { rows } = await sql(
			`insert into change_policy (organization_id, name, self_service_days, approval_days, created_by, updated_at)
			 values ($1, 'Seven days', 0, 7, $2, now()) returning id`,
			[organizationId, owner.userId],
		);
		await sql(
			`insert into change_policy_assignment
			 (policy_id, organization_id, assignment_type, team_id, priority, effective_until, created_by, updated_at)
			 values ($1, $2, 'team', $3, 1, $4, $5, now())`,
			[rows[0].id, organizationId, teamId, effectiveUntil, owner.userId],
		);
		return rows[0].id as string;
	}

	const correctionCapability = (employeeId: string) =>
		run((service) =>
			service.getEditCapability({
				employeeId,
				workPeriodEndTime: new Date("2026-06-12T16:00:00Z"),
				timezone: "Europe/Berlin",
				currentTime: NOW,
			}),
		);

	it("governs a time correction by a team assignment with a future end date", async () => {
		const { teamId, employeeId } = await teamMember();
		const policyId = await assignToTeam(teamId, "2026-12-31T23:00:00");

		await expect(correctionCapability(employeeId)).resolves.toEqual({
			type: "approval_required",
			reason: "within_approval_window",
		});
		await expect(run((service) => service.resolvePolicy(employeeId, NOW))).resolves.toMatchObject({
			policyId,
			assignmentLevel: "team",
		});
	});

	it("stops governing once the team assignment has ended", async () => {
		const { teamId, employeeId } = await teamMember();
		await assignToTeam(teamId, "2026-06-15T09:00:00");

		await expect(correctionCapability(employeeId)).resolves.toEqual({
			type: "direct",
			reason: "no_policy",
		});
	});
});
