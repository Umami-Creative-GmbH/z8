import { drizzle } from "drizzle-orm/node-postgres";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type DatabaseClient,
	DatabaseService,
	makeDatabaseService,
} from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { loadEffectiveWorkPolicies } from "./effective-work-policies";

const AT = parseInstant("2026-06-15T10:00:00Z");

describe("batched effective work policies (PostgreSQL)", () => {
	let fixture: LifecycleDatabaseFixture;
	let db: DatabaseClient;

	async function createPolicy(
		name: string,
		options: { organizationId?: string; isActive?: boolean; hoursPerCycle?: string } = {},
	) {
		const organizationId = options.organizationId ?? fixture.organizationId;
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, is_active, created_by, updated_at)
			 values ($1, $2, $3, $4, now()) returning id`,
			[organizationId, name, options.isActive ?? true, fixture.ownerUserId],
		);
		const id = rows[0]?.id;
		if (!id) throw new Error("work policy insert returned no row");
		const schedule = await fixture.pool.query<{ id: string }>(
			`insert into work_policy_schedule (policy_id, schedule_type, hours_per_cycle, updated_at)
			 values ($1, 'simple', $2, now()) returning id`,
			[id, options.hoursPerCycle ?? "40.00"],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule_day (schedule_id, day_of_week, hours_per_day, is_work_day)
			 values ($1, 'monday', '8.00', true), ($1, 'saturday', '0.00', false)`,
			[schedule.rows[0]?.id],
		);
		return id;
	}

	async function createTeam(name: string, organizationId = fixture.organizationId) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into team (organization_id, name, updated_at) values ($1, $2, now()) returning id`,
			[organizationId, name],
		);
		const id = rows[0]?.id;
		if (!id) throw new Error("team insert returned no row");
		return id;
	}

	async function assign(input: {
		policyId: string;
		type: "organization" | "team" | "employee";
		teamId?: string;
		employeeId?: string;
		organizationId?: string;
		from?: string | null;
		until?: string | null;
		isActive?: boolean;
	}) {
		await fixture.pool.query(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, team_id, employee_id, priority,
			  effective_from, effective_until, is_active, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
			[
				input.policyId,
				input.organizationId ?? fixture.organizationId,
				input.type,
				input.teamId ?? null,
				input.employeeId ?? null,
				input.type === "employee" ? 2 : input.type === "team" ? 1 : 0,
				input.from ?? null,
				input.until ?? null,
				input.isActive ?? true,
				fixture.ownerUserId,
			],
		);
	}

	async function seedInTeam(teamId: string | null, organizationId = fixture.organizationId) {
		const seeded = await fixture.seedEmployee({ organizationId });
		if (teamId) {
			await fixture.pool.query(`update employee set team_id = $1 where id = $2`, [
				teamId,
				seeded.employeeId,
			]);
		}
		return { id: seeded.employeeId, teamId };
	}

	function singleResolution(employeeId: string, organizationId = fixture.organizationId) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const policies = yield* WorkPolicyService;
				return yield* policies.getEffectivePolicyAt({ employeeId, organizationId, at: AT });
			}).pipe(
				Effect.provide(WorkPolicyServiceLive),
				Effect.provideService(DatabaseService, makeDatabaseService(db)),
			),
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		db = fixture.db as unknown as DatabaseClient;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	describe("one organization's precedence", () => {
		let organizationPolicy: string;
		let teamPolicy: string;
		let personalPolicy: string;
		let people: Record<string, { id: string; teamId: string | null }>;

		beforeAll(async () => {
			organizationPolicy = await createPolicy("Organization default", { hoursPerCycle: "38.50" });
			teamPolicy = await createPolicy("Warehouse");
			personalPolicy = await createPolicy("Part time", { hoursPerCycle: "20.00" });
			const inactivePolicy = await createPolicy("Retired", { isActive: false });
			const warehouse = await createTeam("Warehouse");
			const office = await createTeam("Office");

			people = {
				personal: await seedInTeam(warehouse),
				team: await seedInTeam(warehouse),
				office: await seedInTeam(office),
				noTeam: await seedInTeam(null),
				expired: await seedInTeam(warehouse),
				future: await seedInTeam(null),
				inactivePolicy: await seedInTeam(warehouse),
				inactiveAssignment: await seedInTeam(null),
				windowed: await seedInTeam(null),
			};

			await assign({ policyId: organizationPolicy, type: "organization" });
			await assign({ policyId: teamPolicy, type: "team", teamId: warehouse });
			await assign({ policyId: personalPolicy, type: "employee", employeeId: people.personal.id });
			// Ended exactly at AT: the window is half-open, so it no longer applies.
			await assign({
				policyId: personalPolicy,
				type: "employee",
				employeeId: people.expired.id,
				until: "2026-06-15T10:00:00Z",
			});
			await assign({
				policyId: personalPolicy,
				type: "employee",
				employeeId: people.future.id,
				from: "2026-06-15T10:00:01Z",
			});
			await assign({
				policyId: inactivePolicy,
				type: "employee",
				employeeId: people.inactivePolicy.id,
			});
			await assign({
				policyId: personalPolicy,
				type: "employee",
				employeeId: people.inactiveAssignment.id,
				isActive: false,
			});
			// Starts exactly at AT: in force.
			await assign({
				policyId: personalPolicy,
				type: "employee",
				employeeId: people.windowed.id,
				from: "2026-06-15T10:00:00Z",
				until: "2026-07-01T00:00:00Z",
			});
		});

		it("resolves employee, then primary team, then organization", async () => {
			const resolved = await loadEffectiveWorkPolicies(db, {
				organizationId: fixture.organizationId,
				employees: Object.values(people),
				at: AT,
			});
			const resolvedPolicy = (key: string) => resolved.get(people[key]?.id ?? "");

			expect(resolvedPolicy("personal")).toMatchObject({
				policyId: personalPolicy,
				assignmentType: "employee",
			});
			expect(resolvedPolicy("team")).toMatchObject({
				policyId: teamPolicy,
				assignmentType: "team",
				assignedVia: "Warehouse",
			});
			expect(resolvedPolicy("office")).toMatchObject({
				policyId: organizationPolicy,
				assignmentType: "organization",
			});
			expect(resolvedPolicy("noTeam")).toMatchObject({ policyId: organizationPolicy });
		});

		it("honours half-open effective windows and skips inactive policies and assignments", async () => {
			const resolved = await loadEffectiveWorkPolicies(db, {
				organizationId: fixture.organizationId,
				employees: Object.values(people),
				at: AT,
			});
			const resolvedPolicyId = (key: string) => resolved.get(people[key]?.id ?? "")?.policyId;

			expect(resolvedPolicyId("expired")).toBe(teamPolicy);
			expect(resolvedPolicyId("future")).toBe(organizationPolicy);
			expect(resolvedPolicyId("inactivePolicy")).toBe(teamPolicy);
			expect(resolvedPolicyId("inactiveAssignment")).toBe(organizationPolicy);
			expect(resolvedPolicyId("windowed")).toBe(personalPolicy);
		});

		it("gives the same result as resolving each employee on its own", async () => {
			const resolved = await loadEffectiveWorkPolicies(db, {
				organizationId: fixture.organizationId,
				employees: Object.values(people),
				at: AT,
			});

			for (const person of Object.values(people)) {
				expect(resolved.get(person.id)).toEqual(await singleResolution(person.id));
			}
		});

		it("resolves a large roster in a bounded number of queries", async () => {
			const warehouse = people.team?.teamId ?? null;
			const many = [];
			for (let index = 0; index < 25; index++) many.push(await seedInTeam(warehouse));

			const queries: string[] = [];
			const counted = drizzle({
				client: fixture.pool,
				schema: { ...authSchema, ...schema },
				logger: { logQuery: (query) => queries.push(query) },
			}) as unknown as DatabaseClient;

			const few = await loadEffectiveWorkPolicies(counted, {
				organizationId: fixture.organizationId,
				employees: many.slice(0, 2),
				at: AT,
			});
			const fewQueries = queries.length;
			queries.length = 0;
			const all = await loadEffectiveWorkPolicies(counted, {
				organizationId: fixture.organizationId,
				employees: many,
				at: AT,
			});

			expect(few.size).toBe(2);
			expect(all.size).toBe(25);
			expect(queries.length).toBe(fewQueries);
			expect(queries.length).toBeLessThanOrEqual(2);
		});

		it("makes no query for nobody", async () => {
			const queries: string[] = [];
			const counted = drizzle({
				client: fixture.pool,
				schema: { ...authSchema, ...schema },
				logger: { logQuery: (query) => queries.push(query) },
			}) as unknown as DatabaseClient;

			const resolved = await loadEffectiveWorkPolicies(counted, {
				organizationId: fixture.organizationId,
				employees: [],
				at: AT,
			});

			expect(resolved.size).toBe(0);
			expect(queries).toEqual([]);
		});
	});

	it("resolves to nothing without any assignment and never uses another organization's", async () => {
		const organizationId = await fixture.createOrganization();
		const otherOrganization = await fixture.createOrganization();
		const otherPolicy = await createPolicy("Other default", { organizationId: otherOrganization });
		await assign({
			policyId: otherPolicy,
			type: "organization",
			organizationId: otherOrganization,
		});
		const otherTeam = await createTeam("Other team", otherOrganization);
		await assign({
			policyId: otherPolicy,
			type: "team",
			teamId: otherTeam,
			organizationId: otherOrganization,
		});
		const lonely = await seedInTeam(null, organizationId);
		const outsider = await seedInTeam(otherTeam, otherOrganization);

		const resolved = await loadEffectiveWorkPolicies(db, {
			organizationId,
			employees: [lonely, outsider],
			at: AT,
		});

		expect(resolved.get(lonely.id)).toBeNull();
		expect(resolved.get(outsider.id)).toBeNull();
		expect(await singleResolution(lonely.id, organizationId)).toBeNull();
	});
});
