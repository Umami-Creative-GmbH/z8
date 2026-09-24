/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * Effective organization access for due, blocked and effective departures.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess, resolveEmployeeOrganizationAccess } from "./access";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database";

const CUTOFF = "2026-09-15T00:00:00Z";
const BEFORE = parseInstant("2026-09-14T23:59:00Z");
const AFTER = parseInstant("2026-09-15T00:01:00Z");

describeLifecycleDatabase("effective organization access", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function schedule(target: SeededEmployee, createdBy = fixture.ownerUserId) {
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(),
			         'test', 1, 'pending')`,
			[fixture.organizationId, target.employeeId, target.employmentPeriodId, CUTOFF, createdBy],
		);
	}

	const accessOf = (userId: string, now = AFTER, organizationId = fixture.organizationId) =>
		resolveEmployeeOrganizationAccess(fixture.db, { userId, organizationId, now });

	it("denies a still-active employee once a valid departure is due, without writing", async () => {
		const target = await fixture.seedEmployee();
		await schedule(target);

		expect(await accessOf(target.userId, BEFORE)).toMatchObject({ allowed: true });
		expect(await accessOf(target.userId, AFTER)).toEqual({ allowed: false, reason: "offboarded" });
		const stored = await fixture.pool.query(
			`select e.is_active, d.status from employee e
			 join employee_departure d on d.employee_id = e.id where e.id = $1`,
			[target.employeeId],
		);
		expect(stored.rows[0]).toEqual({ is_active: true, status: "pending" });
	});

	it("keeps the same user's access to other organizations", async () => {
		const target = await fixture.seedEmployee();
		await schedule(target);
		const otherOrganizationId = await fixture.createOrganization();
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values (gen_random_uuid(), $1, $2, 'member', 'approved', now())`,
			[otherOrganizationId, target.userId],
		);
		await fixture.pool.query(
			`insert into employee (user_id, organization_id, is_active, updated_at)
			 values ($1, $2, true, now())`,
			[target.userId, otherOrganizationId],
		);

		expect(await accessOf(target.userId, AFTER, otherOrganizationId)).toMatchObject({
			allowed: true,
		});
	});

	it("admits a due owner whose departure the executor would block", async () => {
		const owner = await fixture.seedEmployee({ role: "owner" });
		const admin = await fixture.seedEmployee({ role: "admin" });
		// An admin initiator cannot end an owner's employment: the executor blocks it.
		await schedule(owner, admin.userId);

		expect(await accessOf(owner.userId)).toMatchObject({ allowed: true });
	});

	it("reports an effective departure as offboarded and a plain deactivation as inactive", async () => {
		const departed = await fixture.seedEmployee({ isActive: false });
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, timezone, cutoff_at,
			  created_by, request_id, request_fingerprint, revision, status, effective_at)
			 values ($1, $2, $3, 'immediate', 'UTC', $4, $5, gen_random_uuid(), 'test', 1,
			         'effective', $4)`,
			[
				fixture.organizationId,
				departed.employeeId,
				departed.employmentPeriodId,
				CUTOFF,
				fixture.ownerUserId,
			],
		);
		const deactivated = await fixture.seedEmployee({ isActive: false });

		expect(await accessOf(departed.userId)).toEqual({ allowed: false, reason: "offboarded" });
		expect(await accessOf(deactivated.userId)).toEqual({ allowed: false, reason: "inactive" });
	});

	it("provides a join-safe employee condition for existing access queries", async () => {
		const target = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		await schedule(target);

		const rows = await fixture.db
			.select({ userId: member.userId })
			.from(member)
			.innerJoin(
				employee,
				and(eq(employee.userId, member.userId), eq(employee.organizationId, member.organizationId)),
			)
			.where(
				and(
					eq(member.organizationId, fixture.organizationId),
					inArray(member.userId, [target.userId, colleague.userId]),
					employeeHasOrganizationAccess(AFTER),
				),
			);

		expect(rows).toEqual([{ userId: colleague.userId }]);
	});

	it("works inside relational findFirst queries used by authorization services", async () => {
		const target = await fixture.seedEmployee();
		await schedule(target);

		const found = await fixture.db.query.employee.findFirst({
			where: and(
				eq(employee.userId, target.userId),
				eq(employee.organizationId, fixture.organizationId),
				employeeHasOrganizationAccess(AFTER),
			),
		});
		const beforeCutoff = await fixture.db.query.employee.findFirst({
			where: and(
				eq(employee.userId, target.userId),
				eq(employee.organizationId, fixture.organizationId),
				employeeHasOrganizationAccess(BEFORE),
			),
		});

		expect(found).toBeUndefined();
		expect(beforeCutoff?.id).toBe(target.employeeId);
	});

	it("requires approved membership", async () => {
		const target = await fixture.seedEmployee();
		await fixture.pool.query(`update member set status = 'pending' where id = $1`, [
			target.memberId,
		]);

		expect(await accessOf(target.userId)).toEqual({
			allowed: false,
			reason: "membership_required",
		});
	});

	it("keeps member-only access for legacy accounts without an employee profile", async () => {
		const userId = randomUUID();
		await fixture.pool.query(
			`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'Legacy', $2, now(), now())`,
			[userId, `${userId}@lifecycle.test`],
		);
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values (gen_random_uuid(), $1, $2, 'owner', 'approved', now())`,
			[fixture.organizationId, userId],
		);

		expect(await accessOf(userId)).toEqual({ allowed: true, employeeId: null });
	});
});
