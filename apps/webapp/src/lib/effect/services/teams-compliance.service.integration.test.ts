/**
 * #1977: the Teams compliance card lists and counts the pending compliance exceptions the
 * Approval inbox it links to lists, so one whose validity window has passed is left out, and a
 * manager sees those of the employees they are an eligible manager of, as in that inbox.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { DatabaseServiceLive } from "./database.service";
import { TeamsComplianceService, TeamsComplianceServiceLive } from "./teams-compliance.service";

const layer = TeamsComplianceServiceLive.pipe(Layer.provide(DatabaseServiceLive));

describe("Teams compliance card on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;
	let organizationId: string;
	let ownerUserId: string;
	let employee: { employeeId: string; userId: string };
	let manager: { employeeId: string; userId: string };

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
	});

	beforeEach(async () => {
		const organization = await fixture.organization("Europe/Berlin");
		organizationId = organization.organizationId;
		ownerUserId = organization.ownerUserId;
		employee = await fixture.employee({ organizationId });
		manager = await fixture.employee({ organizationId });
		await makeManager(manager);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), employee.employeeId, manager.employeeId, ownerUserId],
		);
	});

	async function makeManager(person: { employeeId: string }) {
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			person.employeeId,
		]);
	}

	const now = () => systemClock.nowInstant();

	async function exception(input: {
		employeeId: string;
		createdAt?: Instant;
		validUntil?: Instant;
	}): Promise<string> {
		const id = randomUUID();
		const createdAt = input.createdAt ?? now().subtract({ hours: 2 });
		await fixture.pool.query(
			`insert into compliance_exception
			 (id, organization_id, employee_id, exception_type, status, reason, valid_from, valid_until,
			  created_at, created_by, updated_at)
			 values ($1, $2, $3, 'rest_period', 'pending', 'Night shift handover', $4, $5, $4, $6, $4)`,
			[
				id,
				organizationId,
				input.employeeId,
				dateFromInstant(createdAt),
				dateFromInstant(input.validUntil ?? createdAt.add({ hours: 24 })),
				ownerUserId,
			],
		);
		return id;
	}

	async function violation(employeeId: string): Promise<string> {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into work_policy_violation (id, employee_id, organization_id, violation_date, violation_type)
			 values ($1, $2, $3, $4, 'rest_period')`,
			[id, employeeId, organizationId, dateFromInstant(now().subtract({ hours: 12 }))],
		);
		return id;
	}

	function cardFor(viewer: { employeeId: string }) {
		const params = { managerId: viewer.employeeId, organizationId };
		return Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* TeamsComplianceService;
				return {
					pending: yield* service.getPendingExceptionsForManager(params),
					count: yield* service.getPendingExceptionsCount(params),
					alerts: yield* service.getComplianceAlertsForManager({
						...params,
						timezone: "Europe/Berlin",
					}),
				};
			}).pipe(Effect.provide(layer)),
		);
	}

	it("lists and counts only pending exceptions whose validity window is still open", async () => {
		const openId = await exception({
			employeeId: employee.employeeId,
			createdAt: now().subtract({ hours: 2 }),
			validUntil: now().add({ hours: 22 }),
		});
		await exception({
			employeeId: employee.employeeId,
			createdAt: now().subtract({ hours: 48 }),
			validUntil: now().subtract({ hours: 24 }),
		});

		const card = await cardFor(manager);

		expect(card.pending.map((pending) => pending.id)).toEqual([openId]);
		expect(card.count).toBe(1);
	});

	describe("a team's primary manager", () => {
		let teamLead: { employeeId: string; userId: string };
		let teamMember: { employeeId: string; userId: string };

		beforeEach(async () => {
			teamLead = await fixture.employee({ organizationId });
			await makeManager(teamLead);
			teamMember = await fixture.employee({ organizationId });
			const teamId = await fixture.team(organizationId);
			await fixture.pool.query("update team set primary_manager_id = $2 where id = $1", [
				teamId,
				teamLead.employeeId,
			]);
			// The team member has no direct manager; the employee has one, the manager.
			await fixture.setEmployeeTeam(teamMember.employeeId, teamId);
			await fixture.setEmployeeTeam(employee.employeeId, teamId);
		});

		it("sees the pending exception and violation of a team member who has no direct manager", async () => {
			const exceptionId = await exception({ employeeId: teamMember.employeeId });
			const violationId = await violation(teamMember.employeeId);

			const card = await cardFor(teamLead);

			expect(card.pending.map((pending) => pending.id)).toEqual([exceptionId]);
			expect(card.count).toBe(1);
			expect(card.alerts.map((alert) => alert.id)).toEqual([violationId]);
		});

		it("does not see those of a team member who has a direct manager", async () => {
			const exceptionId = await exception({ employeeId: employee.employeeId });
			await violation(employee.employeeId);

			const card = await cardFor(teamLead);

			expect(card).toEqual({ pending: [], count: 0, alerts: [] });
			expect((await cardFor(manager)).pending.map((pending) => pending.id)).toEqual([exceptionId]);
		});
	});

	it("shows an inactive direct manager nothing, as the inbox does", async () => {
		await exception({ employeeId: employee.employeeId });
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			manager.employeeId,
		]);

		expect(await cardFor(manager)).toEqual({ pending: [], count: 0, alerts: [] });
	});
});
