/**
 * #995: holders of an active payroll access grant record and cancel overtime
 * payouts for the employees their grant covers, including covered employees
 * who have left, through the same server actions as owners and admins, and
 * find them on their grant-scoped payroll page. Only the session is mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t995-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const actions = await import("@/app/[locale]/(app)/settings/employees/work-balance-actions");
const workBalance = await import("@/lib/work-balance/service");
const { listBalanceAdjustmentGrantEmployees } = await import(
	"@/lib/payroll-access/adjustment-coverage"
);
const { resolvePayrollAccessibleEmployeeIds } = await import("@/lib/payroll-access/permissions");

const today = plainDateAt(systemClock.nowInstant(), "UTC");
const workDay = today.subtract({ days: 3 });
const payoutDay = today.subtract({ days: 2 });

describe("overtime payouts by payroll grant holders on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let otherOrganizationId: string;
	let teamId: string;
	/** Holds a "specific" grant: `direct` directly, and team `teamId`. */
	let specificHolder: SeededEmployee;
	let specificGrantId: string;
	let allHolder: SeededEmployee;
	let allGrantId: string;
	let deactivatedHolder: SeededEmployee;
	let departedHolder: SeededEmployee;
	let manager: SeededEmployee;
	let member: SeededEmployee;
	let foreignHolder: SeededEmployee;
	let direct: SeededEmployee;
	let viaTeamColumn: SeededEmployee;
	let viaTeamMembership: SeededEmployee;
	let outsider: SeededEmployee;
	let leftDirect: SeededEmployee;
	let leftViaTeam: SeededEmployee;
	let leftOutsider: SeededEmployee;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		otherOrganizationId = await fixture.createOrganization();
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = any($1)`, [
			[organizationId, otherOrganizationId],
		]);
		teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, 'T995 team', now())`,
			[teamId, organizationId],
		);

		const startDate = new Date(`${today.subtract({ days: 7 }).toString()}T00:00:00Z`);
		const seedWorker = async (isActive = true) => {
			const seeded = await fixture.seedEmployee({ isActive, startDate });
			await seedCompletedWork(seeded.employeeId);
			await workBalance.refreshEmployeeWorkBalanceFromPeriods({
				employeeId: seeded.employeeId,
				organizationId,
				forceFullRebuild: true,
			});
			return seeded;
		};
		direct = await seedWorker();
		viaTeamColumn = await seedWorker();
		viaTeamMembership = await seedWorker();
		outsider = await seedWorker();
		leftDirect = await seedWorker(false);
		leftViaTeam = await seedWorker(false);
		leftOutsider = await seedWorker(false);
		await fixture.pool.query(`update employee set team_id = $1 where id = any($2)`, [
			teamId,
			[viaTeamColumn.employeeId, leftViaTeam.employeeId],
		]);
		await fixture.pool.query(
			`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
			[organizationId, teamId, viaTeamMembership.employeeId],
		);

		// Both holders worked too, and the "specific" one is assigned to their own grant.
		specificHolder = await seedWorker();
		specificGrantId = await seedGrant(specificHolder, "specific", {
			employeeIds: [direct.employeeId, leftDirect.employeeId, specificHolder.employeeId],
			teamIds: [teamId],
		});
		allHolder = await seedWorker();
		allGrantId = await seedGrant(allHolder, "all");
		deactivatedHolder = await fixture.seedEmployee();
		await seedGrant(deactivatedHolder, "all", { isActive: false });
		departedHolder = await fixture.seedEmployee({ isActive: false });
		await seedGrant(departedHolder, "all");

		manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[direct.employeeId, manager.employeeId, fixture.ownerUserId],
		);
		member = await fixture.seedEmployee();

		foreignHolder = await fixture.seedEmployee({ organizationId: otherOrganizationId });
		await seedGrant(foreignHolder, "all", { organizationId: otherOrganizationId });
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedGrant(
		holder: SeededEmployee,
		scope: "all" | "specific",
		options: {
			isActive?: boolean;
			employeeIds?: string[];
			teamIds?: string[];
			organizationId?: string;
		} = {},
	) {
		const grantOrganizationId = options.organizationId ?? organizationId;
		const grantId = randomUUID();
		await fixture.pool.query(
			`insert into payroll_access_grant
			 (id, organization_id, payroll_employee_id, scope, is_active, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, now())`,
			[
				grantId,
				grantOrganizationId,
				holder.employeeId,
				scope,
				options.isActive ?? true,
				fixture.ownerUserId,
			],
		);
		for (const employeeId of options.employeeIds ?? []) {
			await fixture.pool.query(
				`insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by)
				 values ($1, $2, $3, $4)`,
				[grantOrganizationId, grantId, employeeId, fixture.ownerUserId],
			);
		}
		for (const grantTeamId of options.teamIds ?? []) {
			await fixture.pool.query(
				`insert into payroll_access_team (organization_id, grant_id, team_id, created_by)
				 values ($1, $2, $3, $4)`,
				[grantOrganizationId, grantId, grantTeamId, fixture.ownerUserId],
			);
		}
		return grantId;
	}

	/** Twelve hours of completed work three days ago: a +12:00h balance. */
	async function seedCompletedWork(employeeId: string) {
		const start = `${workDay.toString()}T08:00:00Z`;
		const end = `${workDay.toString()}T20:00:00Z`;
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", start],
			[clockOutId, "clock_out", end],
		]) {
			await fixture.pool.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $7, $6)`,
				[entryId, employeeId, organizationId, type, timestamp, fixture.ownerUserId, entryId],
			);
		}
		await fixture.pool.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, updated_at)
			 values ($1, $2, $3, $4, $5, $6, 720, false, now())`,
			[employeeId, organizationId, clockInId, clockOutId, start, end],
		);
	}

	function actAs(userId: string, activeOrganizationId: string = organizationId) {
		harness.userId = userId;
		harness.organizationId = activeOrganizationId;
	}

	async function recordPayout(actor: SeededEmployee, target: SeededEmployee, hours = 1) {
		actAs(actor.userId);
		return actions.recordOvertimePayoutAction({
			employeeId: target.employeeId,
			day: payoutDay.toString(),
			hours,
			minutes: 0,
			reason: "Paid with the October payroll",
		});
	}

	async function cancelPayout(actor: SeededEmployee, target: SeededEmployee, adjustmentId: string) {
		actAs(actor.userId);
		return actions.cancelBalanceAdjustmentAction({
			employeeId: target.employeeId,
			adjustmentId,
			reason: "Recorded twice",
		});
	}

	async function readSection(actor: SeededEmployee, target: SeededEmployee) {
		actAs(actor.userId);
		return actions.getEmployeeWorkBalanceSectionAction({ employeeId: target.employeeId });
	}

	/** Records a payout as the owner, for refusal tests on cancelling. */
	async function ownerPayout(target: SeededEmployee) {
		actAs(fixture.ownerUserId);
		const recorded = await actions.recordOvertimePayoutAction({
			employeeId: target.employeeId,
			day: payoutDay.toString(),
			hours: 1,
			minutes: 0,
			reason: "Owner payout",
		});
		if (!recorded.success) throw new Error(`Owner payout refused: ${recorded.code}`);
		return recorded.data.adjustmentId;
	}

	async function auditRows(entityId: string) {
		const rows = await fixture.pool.query<{
			action: string;
			performed_by: string;
			employee_id: string | null;
			metadata: string | null;
		}>(
			`select action, performed_by, employee_id, metadata from audit_log
			 where organization_id = $1 and entity_id = $2 order by timestamp`,
			[organizationId, entityId],
		);
		return rows.rows.map((row) => ({
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	async function expectRecordAndCancel(
		actor: SeededEmployee,
		target: SeededEmployee,
		grantId: string,
	) {
		const before = await workBalance.getEmployeeWorkBalance({
			employeeId: target.employeeId,
			organizationId,
		});
		expect(before?.balanceMinutes).toBe(720);
		const recorded = await recordPayout(actor, target);
		expect(recorded).toMatchObject({ success: true });
		const adjustmentId = recorded.success ? recorded.data.adjustmentId : "";
		expect(
			(await workBalance.getEmployeeWorkBalance({ employeeId: target.employeeId, organizationId }))
				?.balanceMinutes,
		).toBe((before?.balanceMinutes ?? 0) - 60);

		const section = await readSection(actor, target);
		expect(section.success && section.data.adjustments.map((row) => row.id)).toContain(
			adjustmentId,
		);

		expect(await cancelPayout(actor, target, adjustmentId)).toMatchObject({ success: true });
		expect(
			(await workBalance.getEmployeeWorkBalance({ employeeId: target.employeeId, organizationId }))
				?.balanceMinutes,
		).toBe(before?.balanceMinutes);

		const via = { via: "payroll_access_grant", grantId };
		expect(await auditRows(adjustmentId)).toEqual([
			{
				action: "balance_adjustment.recorded",
				performed_by: actor.userId,
				employee_id: target.employeeId,
				metadata: via,
			},
			{
				action: "balance_adjustment.cancelled",
				performed_by: actor.userId,
				employee_id: target.employeeId,
				metadata: via,
			},
		]);
	}

	async function expectRefused(
		actor: SeededEmployee,
		target: SeededEmployee,
		{ readOnly = false }: { readOnly?: boolean } = {},
	) {
		expect(await recordPayout(actor, target)).toMatchObject({
			success: false,
			code: "not_permitted",
		});
		const adjustmentId = await ownerPayout(target);
		expect(await cancelPayout(actor, target, adjustmentId)).toMatchObject({
			success: false,
			code: "not_permitted",
		});
		// The employee and a direct manager see the history read-only (#996); anyone else nothing.
		expect(await readSection(actor, target)).toMatchObject(
			readOnly
				? { success: true, data: { canManage: false } }
				: { success: false, code: "not_permitted" },
		);
		actAs(fixture.ownerUserId);
		await actions.cancelBalanceAdjustmentAction({
			employeeId: target.employeeId,
			adjustmentId,
			reason: "Test cleanup",
		});
	}

	it("lets a 'specific' grant holder pay out employees assigned directly or through a team", async () => {
		for (const target of [direct, viaTeamColumn, viaTeamMembership]) {
			await expectRecordAndCancel(specificHolder, target, specificGrantId);
		}
	});

	it("refuses a 'specific' grant holder for employees the grant does not cover", async () => {
		await expectRefused(specificHolder, outsider);
		await expectRefused(specificHolder, leftOutsider);
	});

	it("lets an 'all' grant holder pay out every employee of the organization", async () => {
		for (const target of [direct, outsider, viaTeamMembership, leftOutsider]) {
			await expectRecordAndCancel(allHolder, target, allGrantId);
		}
	});

	it("refuses grant holders on their own record; another holder or an owner may act on it", async () => {
		// They still see their own history, read-only (#996).
		await expectRefused(allHolder, allHolder, { readOnly: true });
		await expectRefused(specificHolder, specificHolder, { readOnly: true });
		await expectRecordAndCancel(allHolder, specificHolder, allGrantId);
	});

	it("covers employees who have left for payouts only, not for the other payroll screens", async () => {
		for (const target of [leftDirect, leftViaTeam]) {
			await expectRecordAndCancel(specificHolder, target, specificGrantId);
		}

		// The payroll workspace and exports keep their scope: active employees only
		// (and, as before, the holder when the grant covers them).
		expect(
			await resolvePayrollAccessibleEmployeeIds({
				organizationId,
				payrollEmployeeId: specificHolder.employeeId,
			}),
		).toEqual(
			[
				direct.employeeId,
				viaTeamColumn.employeeId,
				viaTeamMembership.employeeId,
				specificHolder.employeeId,
			].toSorted(),
		);
		const allScope = await resolvePayrollAccessibleEmployeeIds({
			organizationId,
			payrollEmployeeId: allHolder.employeeId,
		});
		expect(allScope).toContain(outsider.employeeId);
		expect(allScope).not.toContain(leftOutsider.employeeId);
		expect(allScope).not.toContain(leftDirect.employeeId);
	});

	it("keeps a grant that covers only employees who have left usable for payouts", async () => {
		// /payroll has nothing to show this holder and offers Work balances instead.
		const formerOnlyHolder = await fixture.seedEmployee();
		const grantId = await seedGrant(formerOnlyHolder, "specific", {
			employeeIds: [leftDirect.employeeId],
		});
		expect(
			await resolvePayrollAccessibleEmployeeIds({
				organizationId,
				payrollEmployeeId: formerOnlyHolder.employeeId,
			}),
		).toEqual([]);
		const coverage = await listBalanceAdjustmentGrantEmployees(fixture.db, {
			organizationId,
			actorUserId: formerOnlyHolder.userId,
		});
		expect(coverage?.employees.map((row) => row.id)).toEqual([leftDirect.employeeId]);
		await expectRecordAndCancel(formerOnlyHolder, leftDirect, grantId);
	});

	it("gives a deactivated grant, or a grant whose holder has left, no access", async () => {
		await expectRefused(deactivatedHolder, direct);
		await expectRefused(departedHolder, direct);
	});

	it("refuses managers and employees without a grant", async () => {
		await expectRefused(manager, direct, { readOnly: true });
		await expectRefused(member, direct);
	});

	it("keeps a grant inside its organization", async () => {
		// The foreign holder's "all" grant is for the other organization.
		actAs(foreignHolder.userId, otherOrganizationId);
		expect(
			await actions.recordOvertimePayoutAction({
				employeeId: direct.employeeId,
				day: payoutDay.toString(),
				hours: 1,
				minutes: 0,
				reason: "Foreign",
			}),
		).toMatchObject({ success: false, code: "not_permitted" });
		// With the grant's organization not active, an "all" holder is refused too.
		actAs(allHolder.userId, otherOrganizationId);
		expect(
			await actions.getEmployeeWorkBalanceSectionAction({ employeeId: direct.employeeId }),
		).toMatchObject({ success: false, code: "not_permitted" });
	});

	it("lists the employees a grant covers for payouts, including those who have left, never the holder", async () => {
		const specific = await listBalanceAdjustmentGrantEmployees(fixture.db, {
			organizationId,
			actorUserId: specificHolder.userId,
		});
		expect(specific?.grantId).toBe(specificGrantId);
		expect(
			specific?.employees
				.map((row) => ({ id: row.id, isActive: row.isActive }))
				.toSorted((a, b) => a.id.localeCompare(b.id)),
		).toEqual(
			[
				{ id: direct.employeeId, isActive: true },
				{ id: viaTeamColumn.employeeId, isActive: true },
				{ id: viaTeamMembership.employeeId, isActive: true },
				{ id: leftDirect.employeeId, isActive: false },
				{ id: leftViaTeam.employeeId, isActive: false },
			].toSorted((a, b) => a.id.localeCompare(b.id)),
		);

		// One employee's page reads only that employee, and only when covered.
		const one = (employeeId: string) =>
			listBalanceAdjustmentGrantEmployees(fixture.db, {
				organizationId,
				actorUserId: specificHolder.userId,
				employeeId,
			});
		expect((await one(leftViaTeam.employeeId))?.employees).toEqual([
			expect.objectContaining({ id: leftViaTeam.employeeId, isActive: false }),
		]);
		expect((await one(outsider.employeeId))?.employees).toEqual([]);
		expect((await one(specificHolder.employeeId))?.employees).toEqual([]);

		const all = await listBalanceAdjustmentGrantEmployees(fixture.db, {
			organizationId,
			actorUserId: allHolder.userId,
		});
		expect(all?.employees.map((row) => row.id)).toEqual(
			expect.arrayContaining([outsider.employeeId, leftOutsider.employeeId, direct.employeeId]),
		);
		expect(all?.employees.map((row) => row.id)).toContain(specificHolder.employeeId);
		expect(all?.employees.map((row) => row.id)).not.toContain(allHolder.employeeId);
		expect(all?.employees.map((row) => row.id)).not.toContain(foreignHolder.employeeId);

		for (const actor of [deactivatedHolder, departedHolder, manager, member]) {
			expect(
				await listBalanceAdjustmentGrantEmployees(fixture.db, {
					organizationId,
					actorUserId: actor.userId,
				}),
			).toBeNull();
		}
		expect(
			await listBalanceAdjustmentGrantEmployees(fixture.db, {
				organizationId: otherOrganizationId,
				actorUserId: allHolder.userId,
			}),
		).toBeNull();
	});
});
