/**
 * #1977: the Teams compliance card lists and counts the pending compliance exceptions the
 * Approval inbox it links to lists, so one whose validity window has passed is left out.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
	});

	it("lists and counts only pending exceptions whose validity window is still open", async () => {
		const { organizationId, ownerUserId } = await fixture.organization("Europe/Berlin");
		const employee = await fixture.employee({ organizationId });
		const manager = await fixture.employee({ organizationId });
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), employee.employeeId, manager.employeeId, ownerUserId],
		);
		const now = systemClock.nowInstant();
		const exception = async (input: { createdAt: Instant; validUntil: Instant }) => {
			const id = randomUUID();
			await fixture.pool.query(
				`insert into compliance_exception
				 (id, organization_id, employee_id, exception_type, status, reason, valid_from, valid_until,
				  created_at, created_by, updated_at)
				 values ($1, $2, $3, 'rest_period', 'pending', 'Night shift handover', $4, $5, $4, $6, $4)`,
				[
					id,
					organizationId,
					employee.employeeId,
					dateFromInstant(input.createdAt),
					dateFromInstant(input.validUntil),
					ownerUserId,
				],
			);
			return id;
		};
		const openId = await exception({
			createdAt: now.subtract({ hours: 2 }),
			validUntil: now.add({ hours: 22 }),
		});
		await exception({
			createdAt: now.subtract({ hours: 48 }),
			validUntil: now.subtract({ hours: 24 }),
		});
		const params = { managerId: manager.employeeId, organizationId };

		const [pending, count] = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* TeamsComplianceService;
				return [
					yield* service.getPendingExceptionsForManager(params),
					yield* service.getPendingExceptionsCount(params),
				] as const;
			}).pipe(Effect.provide(layer)),
		);

		expect(pending.map((exception) => exception.id)).toEqual([openId]);
		expect(count).toBe(1);
	});
});
