/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * One billable-seat definition shared by every billing entry point.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { countBillableSeats } from "./billable-seat-count";

const NOW = parseInstant("2026-09-15T12:00:00Z");

describeLifecycleDatabase("billable seat count", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function departure(
		target: SeededEmployee,
		organizationId: string,
		input: { status: string; cutoff: string; createdBy: string },
	) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at, created_by,
			  request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'immediate', 'UTC', $4, $5, gen_random_uuid(), 'test', 1, $6,
			         case when $6 = 'effective' then $4::timestamptz end)`,
			[
				organizationId,
				target.employeeId,
				target.employmentPeriodId,
				input.cutoff,
				input.createdBy,
				input.status,
			],
		);
	}

	async function scenario() {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const admin = await fixture.seedEmployee({ organizationId, role: "admin" });
		const active = await fixture.seedEmployee({ organizationId });
		const legacyInactive = await fixture.seedEmployee({ organizationId, isActive: false });
		const pending = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(`update member set status = 'pending' where id = $1`, [
			pending.memberId,
		]);
		const demo = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(`update "user" set email = $2 where id = $1`, [
			demo.userId,
			`${randomUUID()}@demo.invalid`,
		]);
		const scheduledLater = await fixture.seedEmployee({ organizationId });
		await departure(scheduledLater, organizationId, {
			status: "pending",
			cutoff: "2026-09-30T22:00:00Z",
			createdBy: owner.userId,
		});
		const dueValid = await fixture.seedEmployee({ organizationId });
		await departure(dueValid, organizationId, {
			status: "pending",
			cutoff: "2026-09-15T00:00:00Z",
			createdBy: owner.userId,
		});
		const dueBlocked = await fixture.seedEmployee({ organizationId, role: "owner" });
		await departure(dueBlocked, organizationId, {
			status: "pending",
			cutoff: "2026-09-15T00:00:00Z",
			createdBy: admin.userId,
		});
		const offboarded = await fixture.seedEmployee({ organizationId, isActive: false });
		await departure(offboarded, organizationId, {
			status: "effective",
			cutoff: "2026-09-10T00:00:00Z",
			createdBy: owner.userId,
		});
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = '2026-09-10T00:00:00Z'
			 where id = $1`,
			[offboarded.employmentPeriodId],
		);
		const rehired = await fixture.seedEmployee({ organizationId });
		await departure(rehired, organizationId, {
			status: "effective",
			cutoff: "2026-06-01T00:00:00Z",
			createdBy: owner.userId,
		});
		await fixture.pool.query(
			`update employee_employment_period set status = 'closed', ended_at = '2026-06-01T00:00:00Z'
			 where id = $1`,
			[rehired.employmentPeriodId],
		);
		await fixture.pool.query(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, start_provenance)
			 values ($1, $2, 'open', '2026-08-01T00:00:00Z', 'recorded')`,
			[organizationId, rehired.employeeId],
		);
		const memberOnlyUserId = randomUUID();
		await fixture.pool.query(
			`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'M', $2, now(), now())`,
			[memberOnlyUserId, `${memberOnlyUserId}@lifecycle.test`],
		);
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values (gen_random_uuid(), $1, $2, 'owner', 'approved', now())`,
			[organizationId, memberOnlyUserId],
		);
		return { organizationId, active, legacyInactive };
	}

	it("keeps the member policy before release but never bills an offboarded employee", async () => {
		const { organizationId } = await scenario();

		// owner, admin, active, legacy-inactive, scheduled-later, due-blocked, rehired, member-only
		expect(
			await countBillableSeats(fixture.db, organizationId, {
				requireActiveEmployee: false,
				now: NOW,
			}),
		).toBe(8);
	});

	it("requires an effectively active employee once released", async () => {
		const { organizationId } = await scenario();

		// owner, admin, active, scheduled-later, due-blocked, rehired
		expect(
			await countBillableSeats(fixture.db, organizationId, {
				requireActiveEmployee: true,
				now: NOW,
			}),
		).toBe(6);
	});

	it("counts nothing from other tenants", async () => {
		const { organizationId } = await scenario();
		const foreignOrganizationId = await fixture.createOrganization();
		await fixture.seedEmployee({ organizationId: foreignOrganizationId });

		expect(
			await countBillableSeats(fixture.db, foreignOrganizationId, {
				requireActiveEmployee: true,
				now: NOW,
			}),
		).toBe(1);
		expect(
			await countBillableSeats(fixture.db, organizationId, {
				requireActiveEmployee: true,
				now: NOW,
			}),
		).toBe(6);
	});
});
