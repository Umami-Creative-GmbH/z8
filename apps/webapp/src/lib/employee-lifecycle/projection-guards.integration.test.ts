/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Membership, provisioning and generic toggles cannot reopen ended employment.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureCommands } from "./commands";
import { hasEndedEmploymentWithoutRehire } from "./employment-periods";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
} from "./testing/database";
import type { DepartureClockOutPort, LifecycleActor } from "./types";

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

describeLifecycleDatabase("employment projection guards", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = parseInstant("2026-09-14T09:30:00Z");

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	const commands = () =>
		createDepartureCommands({ db: fixture.db, clock: { nowInstant: () => now }, clockOut });
	const owner = (): LifecycleActor => ({
		userId: fixture.ownerUserId,
		organizationId: fixture.organizationId,
	});

	async function offboard(employeeId: string) {
		now = parseInstant("2026-09-14T09:30:00Z");
		await commands().offboardNow(owner(), {
			employeeId,
			requestId: randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
	}

	async function reactivateDirectly(employeeId: string) {
		// What membership acceptance, invite codes, pending-member approval and
		// SCIM do today: flip the projection without an employment transition.
		await fixture.pool.query(`update employee set is_active = true where id = $1`, [employeeId]);
		const result = await fixture.pool.query<{ is_active: boolean }>(
			`select is_active from employee where id = $1`,
			[employeeId],
		);
		return result.rows[0]?.is_active;
	}

	it("keeps an offboarded employee inactive when membership flows reactivate the projection", async () => {
		const target = await fixture.seedEmployee();
		await offboard(target.employeeId);

		expect(await reactivateDirectly(target.employeeId)).toBe(false);
		expect(
			await hasEndedEmploymentWithoutRehire(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: target.employeeId,
			}),
		).toBe(true);
	});

	it("preserves reactivation of a legacy-deactivated employee without a departure", async () => {
		const target = await fixture.seedEmployee({ isActive: false });

		expect(await reactivateDirectly(target.employeeId)).toBe(true);
		expect(
			await hasEndedEmploymentWithoutRehire(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: target.employeeId,
			}),
		).toBe(false);
	});

	it("lets the explicit rehire reactivate, after which the guard no longer applies", async () => {
		const target = await fixture.seedEmployee();
		const policy = await fixture.pool.query<{ id: string }>(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[fixture.organizationId, `Policy ${randomUUID()}`, fixture.ownerUserId],
		);
		await offboard(target.employeeId);
		now = parseInstant("2026-11-02T08:00:00Z");

		await commands().rehireEmployee(owner(), {
			employeeId: target.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: target.employmentPeriodId,
			role: "employee",
			teamId: null,
			primaryManagerId: null,
			workPolicyId: policy.rows[0]?.id ?? "",
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "onsite",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: null,
		});

		const rehired = await fixture.pool.query<{ is_active: boolean }>(
			`select is_active from employee where id = $1`,
			[target.employeeId],
		);
		expect(rehired.rows[0]?.is_active).toBe(true);
		expect(
			await hasEndedEmploymentWithoutRehire(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: target.employeeId,
			}),
		).toBe(false);
	});
});
