/**
 * #1197: accepting an invitation never fails because of the draft's personnel
 * number. A draft number another employee of the organization holds by then is
 * not copied onto the new or reactivated employee, and the drop is written to
 * the audit log; a reactivated employee keeps their own number.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
	}),
}));

const { db } = await import("@/db");
const { ensureEmployeeForOrganizationMember } = await import(
	"@/lib/auth/organization-member-provisioning"
);

describe("personnel number of an accepted invitation on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let holderId: string;

	async function setNumber(employeeId: string, employeeNumber: string | null) {
		await fixture.pool.query("update employee set employee_number = $2 where id = $1", [
			employeeId,
			employeeNumber,
		]);
	}

	const inviteeUserIds: string[] = [];

	async function createInvitee() {
		const userId = randomUUID();
		inviteeUserIds.push(userId);
		await fixture.pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Invitee', $2, now(), now())`,
			[userId, `${userId}@invitee.test`],
		);
		return { userId, email: `${userId}@invitee.test` };
	}

	async function invite(email: string, employeeNumber: string) {
		const invitationId = randomUUID();
		await fixture.pool.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
			 values ($1, $2, $3, 'member', 'accepted', now() + interval '7 days', $4)`,
			[invitationId, fixture.organizationId, email, fixture.ownerUserId],
		);
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into employee_invitation_draft
			   (invitation_id, organization_id, normalized_email, employee_number)
			 values ($1, $2, $3, $4)
			 returning id`,
			[invitationId, fixture.organizationId, email, employeeNumber],
		);
		return { invitationId, draftId: rows[0]?.id as string };
	}

	function accept(userId: string, invitationId: string) {
		return ensureEmployeeForOrganizationMember(db, {
			mode: "membershipAccepted",
			userId,
			organizationId: fixture.organizationId,
			memberRole: "member",
			invitationId,
		});
	}

	async function droppedNumberAudits(employeeId: string) {
		const { rows } = await fixture.pool.query<{
			entity_type: string;
			performed_by: string;
			employee_id: string | null;
			metadata: string | null;
		}>(
			`select entity_type, performed_by, employee_id, metadata from audit_log
			 where organization_id = $1 and entity_id = $2
			 and action = 'employee.personnel_number_dropped'`,
			[fixture.organizationId, employeeId],
		);
		return rows.map((row) => ({
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		holderId = fixture.employeeId;
	});

	beforeEach(async () => {
		await setNumber(holderId, "E-42");
	});

	afterAll(async () => {
		await fixture?.close();
		await fixture?.pool.query(`delete from "user" where id = any($1::text[])`, [inviteeUserIds]);
	});

	it("creates the employee without a number taken in the meantime and audits the drop", async () => {
		const invitee = await createInvitee();
		const { invitationId, draftId } = await invite(invitee.email, " e-42 ");

		const employee = await accept(invitee.userId, invitationId);

		expect(employee).toMatchObject({ userId: invitee.userId, employeeNumber: null });
		expect(await droppedNumberAudits(employee?.id as string)).toEqual([
			{
				entity_type: "employee",
				performed_by: invitee.userId,
				employee_id: employee?.id,
				metadata: expect.objectContaining({
					droppedPersonnelNumber: "e-42",
					heldByEmployeeId: holderId,
					invitationId,
					draftId,
					outcome: "created",
				}),
			},
		]);
	});

	it("reactivates an inactive employee who keeps their own number when the draft's is taken", async () => {
		const former = await fixture.seedEmployee({ isActive: false, withPeriod: false });
		await setNumber(former.employeeId, "OWN-1");
		const { invitationId } = await invite(`${former.userId}@lifecycle.test`, "E-42");

		const employee = await accept(former.userId, invitationId);

		expect(employee).toMatchObject({
			id: former.employeeId,
			isActive: true,
			employeeNumber: "OWN-1",
		});
		expect(await droppedNumberAudits(former.employeeId)).toEqual([
			expect.objectContaining({
				performed_by: former.userId,
				metadata: expect.objectContaining({
					droppedPersonnelNumber: "E-42",
					heldByEmployeeId: holderId,
					keptPersonnelNumber: "OWN-1",
					outcome: "reactivated",
				}),
			}),
		]);
	});

	it("still accepts when a concurrent save takes the number during acceptance", async () => {
		const invitee = await createInvitee();
		const { invitationId } = await invite(invitee.email, "R-1");
		// The holder's save is in flight: its number is written but not committed, so
		// acceptance's check can't see it and its insert waits on the unique index.
		const concurrent: PoolClient = await fixture.pool.connect();
		try {
			await concurrent.query("begin");
			await concurrent.query("update employee set employee_number = 'r-1' where id = $1", [
				holderId,
			]);

			const accepting = accept(invitee.userId, invitationId);
			await vi.waitFor(
				async () => {
					const { rows } = await fixture.pool.query(
						`select 1 from pg_stat_activity
						 where wait_event_type = 'Lock' and query ilike 'insert into "employee"%'`,
					);
					expect(rows).toHaveLength(1);
				},
				{ timeout: 20_000, interval: 50 },
			);
			await concurrent.query("commit");

			const employee = await accepting;
			expect(employee).toMatchObject({ userId: invitee.userId, employeeNumber: null });
			expect(await droppedNumberAudits(employee?.id as string)).toEqual([
				expect.objectContaining({
					metadata: expect.objectContaining({
						droppedPersonnelNumber: "R-1",
						heldByEmployeeId: holderId,
					}),
				}),
			]);
		} finally {
			concurrent.release();
		}
	});

	it("copies a draft number that is still free, trimmed", async () => {
		const invitee = await createInvitee();
		const { invitationId } = await invite(invitee.email, " N-7 ");

		const employee = await accept(invitee.userId, invitationId);

		expect(employee).toMatchObject({ employeeNumber: "N-7" });
		expect(await droppedNumberAudits(employee?.id as string)).toEqual([]);
	});

	it("gives the reactivated employee the draft's number, also when it is already theirs", async () => {
		const former = await fixture.seedEmployee({ isActive: false, withPeriod: false });
		await setNumber(former.employeeId, "OWN-2");
		const { invitationId } = await invite(`${former.userId}@lifecycle.test`, "own-2");

		const employee = await accept(former.userId, invitationId);

		expect(employee).toMatchObject({ isActive: true, employeeNumber: "own-2" });
		expect(await droppedNumberAudits(former.employeeId)).toEqual([]);
	});

	it("gives no number for a blank draft number", async () => {
		const invitee = await createInvitee();
		const { invitationId } = await invite(invitee.email, "   ");

		const employee = await accept(invitee.userId, invitationId);

		expect(employee).toMatchObject({ employeeNumber: null });
		expect(await droppedNumberAudits(employee?.id as string)).toEqual([]);
	});
});
