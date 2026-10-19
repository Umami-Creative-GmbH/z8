import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { DatabaseService, makeDatabaseService } from "@/lib/effect/services/database.service";
import {
	WorkPolicyService,
	WorkPolicyServiceLive,
} from "@/lib/effect/services/work-policy.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	cancelEmploymentTerms,
	changeHourlyWage,
	confirmEmploymentTerms,
	writeEmploymentTerms,
} from "./write-terms";

const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe("employment terms work-policy assignments", () => {
	let fixture: LifecycleDatabaseFixture;
	let policyA: string;
	let policyB: string;
	const scope = () => ({
		organizationId: fixture.organizationId,
		employeeId: fixture.employeeId,
		actorUserId: fixture.ownerUserId,
		now: day("2026-01-02"),
	});
	async function createPolicy(name: string) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at) values ($1, $2, $3, now()) returning id`,
			[fixture.organizationId, name, fixture.ownerUserId],
		);
		const row = rows[0];
		if (!row) throw new Error("Policy fixture insert returned no row");
		return row.id;
	}
	async function write(
		from: string,
		policyId: string | null,
		reviewState: "confirmed" | "draft" | "pending" = "confirmed",
	) {
		return fixture.db.transaction((tx) =>
			writeEmploymentTerms(tx, {
				...scope(),
				terms: {
					validFrom: day(from),
					status: "active",
					contractType: "fixed",
					weeklyContractMinutes: 2400,
					workModel: "onsite",
					workPolicyId: policyId,
					hourlyRate: null,
					currency: "EUR",
					reviewState,
				},
			}),
		);
	}
	async function effectivePolicy(at: string) {
		return Effect.runPromise(
			Effect.gen(function* () {
				const policies = yield* WorkPolicyService;
				return yield* policies.getEffectivePolicyAt({
					organizationId: fixture.organizationId,
					employeeId: fixture.employeeId,
					at: parseInstant(at),
				});
			}).pipe(
				Effect.provide(WorkPolicyServiceLive),
				Effect.provideService(DatabaseService, makeDatabaseService(fixture.db)),
			),
		);
	}
	async function assignments() {
		return (
			await fixture.pool.query(
				`select policy_id, effective_from, effective_until, priority from work_policy_assignment
       where organization_id = $1 and employee_id = $2 and assignment_type = 'employee' and is_active = true order by effective_from`,
				[fixture.organizationId, fixture.employeeId],
			)
		).rows;
	}
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		policyA = await createPolicy("Original policy");
		policyB = await createPolicy("New policy");
	});
	beforeEach(async () => {
		await fixture.pool.query("delete from work_policy_assignment where organization_id = $1", [
			fixture.organizationId,
		]);
		await fixture.pool.query("delete from employee_employment_history where organization_id = $1", [
			fixture.organizationId,
		]);
	});
	afterAll(async () => {
		await fixture?.close();
	});
	it("makes initial confirmed terms visible to assignment-based policy readers", async () => {
		await write("2026-01-01", policyA);
		expect((await effectivePolicy("2026-01-02T00:00:00Z"))?.policyId).toBe(policyA);
		expect(await assignments()).toEqual([
			{
				policy_id: policyA,
				effective_from: day("2026-01-01"),
				effective_until: null,
				priority: 2,
			},
		]);
	});
	it("switches future policies at their boundary and releases an employee override for unlinked terms", async () => {
		await write("2026-01-01", policyA);
		await write("2026-05-01", policyB);
		await write("2026-09-01", null);
		expect((await effectivePolicy("2026-04-30T23:59:59.999Z"))?.policyId).toBe(policyA);
		expect((await effectivePolicy("2026-05-01T00:00:00Z"))?.policyId).toBe(policyB);
		expect(await effectivePolicy("2026-09-01T00:00:00Z")).toBeNull();
		expect(await assignments()).toEqual([
			{
				policy_id: policyA,
				effective_from: day("2026-01-01"),
				effective_until: day("2026-05-01"),
				priority: 2,
			},
			{
				policy_id: policyB,
				effective_from: day("2026-05-01"),
				effective_until: day("2026-09-01"),
				priority: 2,
			},
		]);
	});
	it.each(["draft", "pending"] as const)(
		"keeps %s terms inert until confirmation",
		async (reviewState) => {
			await write("2026-01-01", policyA);
			const proposal = await write("2026-05-01", policyB, reviewState);
			expect((await effectivePolicy("2026-06-01T00:00:00Z"))?.policyId).toBe(policyA);
			await fixture.db.transaction((tx) =>
				confirmEmploymentTerms(tx, { ...scope(), termsId: proposal.id }),
			);
			expect((await effectivePolicy("2026-05-01T00:00:00Z"))?.policyId).toBe(policyB);
			expect(await assignments()).toHaveLength(2);
		},
	);
	it("cancels a future change and restores the previous policy only until the next terms", async () => {
		await write("2026-01-01", policyA);
		const cancelled = await write("2026-05-01", policyB);
		await write("2026-09-01", policyB);
		await fixture.db.transaction((tx) =>
			cancelEmploymentTerms(tx, { ...scope(), termsId: cancelled.id }),
		);
		expect((await effectivePolicy("2026-05-01T00:00:00Z"))?.policyId).toBe(policyA);
		expect((await effectivePolicy("2026-09-01T00:00:00Z"))?.policyId).toBe(policyB);
		expect(await assignments()).toEqual([
			{
				policy_id: policyA,
				effective_from: day("2026-01-01"),
				effective_until: day("2026-09-01"),
				priority: 2,
			},
			{
				policy_id: policyB,
				effective_from: day("2026-09-01"),
				effective_until: null,
				priority: 2,
			},
		]);
	});
	it("adjusts inserted, backdated, and same-start terms without overlapping coverage", async () => {
		await write("2026-01-01", policyA);
		await write("2026-09-01", policyA);
		await write("2026-05-01", policyB);
		await write("2026-03-01", policyB);
		await write("2026-05-01", policyA);
		expect(await assignments()).toEqual([
			{
				policy_id: policyA,
				effective_from: day("2026-01-01"),
				effective_until: day("2026-03-01"),
				priority: 2,
			},
			{
				policy_id: policyB,
				effective_from: day("2026-03-01"),
				effective_until: day("2026-05-01"),
				priority: 2,
			},
			{
				policy_id: policyA,
				effective_from: day("2026-05-01"),
				effective_until: day("2026-09-01"),
				priority: 2,
			},
			{
				policy_id: policyA,
				effective_from: day("2026-09-01"),
				effective_until: null,
				priority: 2,
			},
		]);
	});
	it("restores an open-ended policy after cancelling the last scheduled change", async () => {
		await write("2026-01-01", policyA);
		const next = await write("2026-05-01", policyB);
		await fixture.db.transaction((tx) =>
			cancelEmploymentTerms(tx, { ...scope(), termsId: next.id }),
		);
		expect((await effectivePolicy("2027-01-01T00:00:00Z"))?.policyId).toBe(policyA);
		expect(await assignments()).toEqual([
			{
				policy_id: policyA,
				effective_from: day("2026-01-01"),
				effective_until: null,
				priority: 2,
			},
		]);
	});
	it.each(["draft", "pending"] as const)(
		"cancels %s terms without changing policy coverage",
		async (reviewState) => {
			await write("2026-01-01", policyA);
			const proposal = await write("2026-01-01", policyB, reviewState);
			const before = await assignments();
			await fixture.db.transaction((tx) =>
				cancelEmploymentTerms(tx, { ...scope(), termsId: proposal.id }),
			);
			expect(await assignments()).toEqual(before);
		},
	);
	it("does not cancel confirmed terms at their start boundary", async () => {
		const terms = await write("2026-01-01", policyA);
		await expect(
			fixture.db.transaction((tx) =>
				cancelEmploymentTerms(tx, {
					...scope(),
					now: day("2026-01-01"),
					termsId: terms.id,
				}),
			),
		).rejects.toThrow("already taken effect");
		expect((await effectivePolicy("2026-01-01T00:00:00Z"))?.policyId).toBe(policyA);
	});
	it("cancels a superseded same-start row without removing its replacement's policy", async () => {
		const old = await write("2026-05-01", policyA);
		await write("2026-05-01", policyA);
		await fixture.db.transaction((tx) =>
			cancelEmploymentTerms(tx, { ...scope(), termsId: old.id }),
		);
		expect((await effectivePolicy("2026-05-01T00:00:00Z"))?.policyId).toBe(policyA);
		expect(await assignments()).toHaveLength(1);
	});
	it("keeps terms and assignment changes together on write and cancellation rollback", async () => {
		await write("2026-01-01", policyA);
		await expect(
			fixture.db.transaction(async (tx) => {
				await writeEmploymentTerms(tx, {
					...scope(),
					terms: {
						validFrom: day("2026-05-01"),
						status: "active",
						contractType: "fixed",
						weeklyContractMinutes: 1200,
						workModel: "onsite",
						workPolicyId: policyB,
						hourlyRate: null,
						currency: "EUR",
						reviewState: "confirmed",
					},
				});
				throw new Error("abort terms");
			}),
		).rejects.toThrow("abort terms");
		expect((await effectivePolicy("2026-06-01T00:00:00Z"))?.policyId).toBe(policyA);
		expect(
			(
				await fixture.pool.query(
					"select count(*)::int as count from employee_employment_history where employee_id=$1",
					[fixture.employeeId],
				)
			).rows[0].count,
		).toBe(1);
		const next = await write("2026-05-01", policyB);
		await expect(
			fixture.db.transaction(async (tx) => {
				await cancelEmploymentTerms(tx, { ...scope(), termsId: next.id });
				throw new Error("abort cancellation");
			}),
		).rejects.toThrow("abort cancellation");
		expect((await effectivePolicy("2026-06-01T00:00:00Z"))?.policyId).toBe(policyB);
		expect(await assignments()).toHaveLength(2);
	});
	it("serializes concurrent confirmed changes for the same employee", async () => {
		await write("2026-01-01", policyA);
		await Promise.all([write("2026-05-01", policyA), write("2026-03-01", policyB)]);
		expect(await assignments()).toEqual([
			{
				policy_id: policyA,
				effective_from: day("2026-01-01"),
				effective_until: day("2026-03-01"),
				priority: 2,
			},
			{
				policy_id: policyB,
				effective_from: day("2026-03-01"),
				effective_until: day("2026-05-01"),
				priority: 2,
			},
			{
				policy_id: policyA,
				effective_from: day("2026-05-01"),
				effective_until: null,
				priority: 2,
			},
		]);
	});
	it("syncs wage-only changes without competing assignments for the same policy", async () => {
		await fixture.db.transaction((tx) =>
			writeEmploymentTerms(tx, {
				...scope(),
				terms: {
					validFrom: day("2026-01-01"),
					status: "active",
					contractType: "hourly",
					weeklyContractMinutes: 2400,
					workModel: "onsite",
					workPolicyId: policyA,
					hourlyRate: 20,
					currency: "EUR",
					reviewState: "confirmed",
				},
			}),
		);
		await fixture.db.transaction((tx) =>
			changeHourlyWage(tx, {
				...scope(),
				effectiveOn: parsePlainDate("2026-05-01"),
				hourlyRate: 25,
				changeReason: "Annual review",
				reviewState: "confirmed",
			}),
		);
		expect(await assignments()).toEqual([
			{
				policy_id: policyA,
				effective_from: day("2026-01-01"),
				effective_until: day("2026-05-01"),
				priority: 2,
			},
			{
				policy_id: policyA,
				effective_from: day("2026-05-01"),
				effective_until: null,
				priority: 2,
			},
		]);
	});
	it("preserves manual coverage before linked terms and organization inheritance afterwards", async () => {
		const other = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into work_policy_assignment(policy_id,organization_id,assignment_type,employee_id,priority,created_by,updated_at)
      values($1,$2,'employee',$3,2,$5,now()),($1,$2,'employee',$4,2,$5,now()),($1,$2,'organization',null,0,$5,now())`,
			[policyA, fixture.organizationId, fixture.employeeId, other.employeeId, fixture.ownerUserId],
		);
		await write("2026-05-01", policyB);
		expect((await effectivePolicy("2026-04-01T00:00:00Z"))?.policyId).toBe(policyA);
		await write("2026-09-01", null);
		const inherited = await effectivePolicy("2026-09-01T00:00:00Z");
		expect(inherited?.policyId).toBe(policyA);
		expect(inherited?.assignmentType).toBe("organization");
		expect(
			(
				await fixture.pool.query(
					`select effective_until,is_active from work_policy_assignment where organization_id=$1 and (employee_id=$2 or assignment_type='organization')`,
					[fixture.organizationId, other.employeeId],
				)
			).rows,
		).toEqual([
			{ effective_until: null, is_active: true },
			{ effective_until: null, is_active: true },
		]);
	});
	it("refuses foreign policies and employees without changing their assignments", async () => {
		const otherOrg = await fixture.createOrganization();
		const foreign = await fixture.seedEmployee({ organizationId: otherOrg });
		const foreignPolicy = (
			await fixture.pool.query(
				`insert into work_policy(organization_id,name,created_by,updated_at) values($1,'Foreign',$2,now()) returning id`,
				[otherOrg, fixture.ownerUserId],
			)
		).rows[0].id;
		await write("2026-01-01", policyA);
		const before = await assignments();
		await expect(write("2026-05-01", foreignPolicy)).rejects.toThrow("Work policy not found");
		const draft = await write("2026-05-01", policyB, "draft");
		await fixture.pool.query(
			"update employee_employment_history set work_policy_id=$2 where id=$1",
			[draft.id, foreignPolicy],
		);
		await expect(
			fixture.db.transaction((tx) => confirmEmploymentTerms(tx, { ...scope(), termsId: draft.id })),
		).rejects.toThrow("Work policy not found");
		await expect(
			fixture.db.transaction((tx) =>
				cancelEmploymentTerms(tx, {
					...scope(),
					employeeId: foreign.employeeId,
					termsId: draft.id,
				}),
			),
		).rejects.toThrow("Employee not found");
		expect(await assignments()).toEqual(before);
		expect(
			(
				await fixture.pool.query(
					"select count(*)::int as count from work_policy_assignment where organization_id=$1",
					[otherOrg],
				)
			).rows[0].count,
		).toBe(0);
	});
	it("uses the same term boundary when queried from a non-UTC timezone", async () => {
		await write("2026-01-01", policyA);
		await write("2026-05-01", policyB);
		expect((await effectivePolicy("2026-05-01T01:59:59.999+02:00"))?.policyId).toBe(policyA);
		expect((await effectivePolicy("2026-05-01T02:00:00+02:00"))?.policyId).toBe(policyB);
	});
	it("does not restore terms beyond a closed employment period", async () => {
		const previous = await write("2026-01-01", policyA);
		const next = await write("2026-05-01", policyB);
		await fixture.pool.query(
			"update employee_employment_period set status='closed',ended_at=$2 where id=$1",
			[fixture.employmentPeriodId, day("2026-04-01")],
		);
		await fixture.pool.query("update employee_employment_history set valid_until=$2 where id=$1", [
			previous.id,
			day("2026-04-01"),
		]);
		await fixture.pool.query(
			"update work_policy_assignment set effective_until=$2 where employee_id=$1 and policy_id=$3",
			[fixture.employeeId, day("2026-04-01"), policyA],
		);
		await fixture.db.transaction((tx) =>
			cancelEmploymentTerms(tx, { ...scope(), termsId: next.id }),
		);
		expect(await effectivePolicy("2026-05-01T00:00:00Z")).toBeNull();
		await fixture.pool.query(
			"update employee_employment_period set status='open',ended_at=null where id=$1",
			[fixture.employmentPeriodId],
		);
	});
	it("rolls terms back when inserting their policy projection fails", async () => {
		await write("2026-01-01", policyA);
		await fixture.pool.query(
			`create function test_1160_refuse_assignment() returns trigger language plpgsql as $$ begin raise exception 'assignment projection refused'; end $$`,
		);
		try {
			await fixture.pool.query(
				`create trigger test_1160_refuse_assignment before insert on work_policy_assignment for each row execute function test_1160_refuse_assignment()`,
			);
			await expect(write("2026-05-01", policyB)).rejects.toThrow();
			expect((await effectivePolicy("2026-06-01T00:00:00Z"))?.policyId).toBe(policyA);
			expect(
				(
					await fixture.pool.query(
						"select count(*)::int as count from employee_employment_history where employee_id=$1",
						[fixture.employeeId],
					)
				).rows[0].count,
			).toBe(1);
		} finally {
			await fixture.pool.query(
				"drop trigger if exists test_1160_refuse_assignment on work_policy_assignment",
			);
			await fixture.pool.query("drop function test_1160_refuse_assignment()");
		}
	});
	it("does not reactivate a same-start replacement in a closed employment period", async () => {
		const superseded = await write("2026-05-01", policyA);
		await write("2026-05-01", policyA);
		await fixture.pool.query(
			"update employee_employment_period set status='closed', ended_at=$2 where id=$1",
			[fixture.employmentPeriodId, day("2026-04-01")],
		);
		await fixture.pool.query(
			"update work_policy_assignment set is_active=false where employee_id=$1",
			[fixture.employeeId],
		);
		try {
			await fixture.db.transaction((tx) =>
				cancelEmploymentTerms(tx, { ...scope(), termsId: superseded.id }),
			);
			expect(await effectivePolicy("2026-05-01T00:00:00Z")).toBeNull();
		} finally {
			await fixture.pool.query(
				"update employee_employment_period set status='open', ended_at=null where id=$1",
				[fixture.employmentPeriodId],
			);
		}
	});
	it("preserves team assignments and inherits them after unlinked terms", async () => {
		const teamId = (
			await fixture.pool.query(
				"insert into team (organization_id,name,updated_at) values ($1,'Policy team',now()) returning id",
				[fixture.organizationId],
			)
		).rows[0].id;
		await fixture.pool.query("update employee set team_id=$2 where id=$1", [
			fixture.employeeId,
			teamId,
		]);
		await fixture.pool.query(
			"insert into work_policy_assignment(policy_id,organization_id,assignment_type,team_id,priority,created_by,updated_at) values($1,$2,'team',$3,1,$4,now())",
			[policyA, fixture.organizationId, teamId, fixture.ownerUserId],
		);
		try {
			await write("2026-01-01", policyB);
			await write("2026-05-01", null);
			const inherited = await effectivePolicy("2026-05-01T00:00:00Z");
			expect(inherited?.policyId).toBe(policyA);
			expect(inherited?.assignmentType).toBe("team");
			expect(
				(
					await fixture.pool.query(
						"select effective_from,effective_until,is_active from work_policy_assignment where team_id=$1",
						[teamId],
					)
				).rows,
			).toEqual([{ effective_from: null, effective_until: null, is_active: true }]);
		} finally {
			await fixture.pool.query("update employee set team_id=null where id=$1", [
				fixture.employeeId,
			]);
		}
	});
	it("restores coverage when cancelling terms in an unended legacy employment period", async () => {
		await write("2026-01-01", policyA);
		await fixture.pool.query("update employee set is_active=false where id=$1", [
			fixture.employeeId,
		]);
		await fixture.pool.query(
			"update employee_employment_period set status='legacy_unknown' where id=$1",
			[fixture.employmentPeriodId],
		);
		try {
			const next = await write("2026-05-01", policyB);
			await fixture.db.transaction((tx) =>
				cancelEmploymentTerms(tx, { ...scope(), termsId: next.id }),
			);
			expect((await effectivePolicy("2026-05-01T00:00:00Z"))?.policyId).toBe(policyA);
		} finally {
			await fixture.pool.query("update employee set is_active=true where id=$1", [
				fixture.employeeId,
			]);
			await fixture.pool.query("update employee_employment_period set status='open' where id=$1", [
				fixture.employmentPeriodId,
			]);
		}
	});
});
