/**
 * #857 / ADR 0006: kiosk-only employees on PostgreSQL. An owner or admin
 * creates one as a real user with a reserved, undeliverable address, an
 * approved membership and an ordinary employee profile; it is a billable seat.
 * Adding a real email later keeps the user, the PIN and the history, and sends
 * the invitation that lets the person choose a password.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("server-only", () => ({}));

const { createKioskOnlyEmployee, addEmailToKioskOnlyEmployee } = await import(
	"./kiosk-only-employee"
);
const { issueKioskPin, verifyEmployeeKioskPin } = await import("./pin-store");
const { KioskPinRefusal } = await import("./pin-errors");
const { isReservedEmail } = await import("@/lib/auth/reserved-email");
const { countBillableSeats } = await import("@/lib/effect/services/billing/billable-seat-count");

const ids = {
	organization: "t857-kiosk-org",
	otherOrganization: "t857-kiosk-other-org",
	ownerUser: "t857-kiosk-owner-user",
	adminUser: "t857-kiosk-admin-user",
	managerUser: "t857-kiosk-manager-user",
	demoUser: "t857-kiosk-demo-user",
	takenUser: "t857-kiosk-taken-user",
	owner: "d8571000-0000-4000-8000-000000000001",
	admin: "d8571000-0000-4000-8000-000000000002",
	manager: "d8571000-0000-4000-8000-000000000003",
	demo: "d8571000-0000-4000-8000-000000000004",
	team: "d8571000-0000-4000-8000-0000000000a1",
	foreignTeam: "d8571000-0000-4000-8000-0000000000a2",
	store: "d8571000-0000-4000-8000-0000000000b1",
	warehouse: "d8571000-0000-4000-8000-0000000000b2",
	foreignLocation: "d8571000-0000-4000-8000-0000000000b3",
} as const;
const fixtureUsers = [ids.ownerUser, ids.adminUser, ids.managerUser, ids.demoUser, ids.takenUser];
const clock = { nowInstant: () => parseInstant("2026-03-02T08:00:00Z") };

async function refusalOf(promise: Promise<unknown>) {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(KioskPinRefusal);
	return (error as InstanceType<typeof KioskPinRefusal>).code;
}

describe("kiosk-only employees on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();
	const org = ids.organization;
	const invitations: { organizationId: string; email: string; invitationUrl: string }[] = [];
	const deps = {
		createPasswordSetupUrl: async (_organizationId: string, userId: string) =>
			`https://app.example.com/reset-password?token=setup-${userId}`,
		sendInvitationEmail: async (invitation: {
			organizationId: string;
			email: string;
			invitationUrl: string;
			inviterUserId: string;
		}) => {
			invitations.push(invitation);
		},
	};

	async function cleanup() {
		const { rows } = await pool.query<{ user_id: string }>(
			"select user_id from member where organization_id = $1",
			[org],
		);
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [
			[...fixtureUsers, ...rows.map((row) => row.user_id)],
		]);
	}

	beforeEach(async () => {
		invitations.length = 0;
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T857 kiosk', $1, 'Europe/Berlin', $3), ($2, 'T857 kiosk other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Owner', 'owner@t857.test', $6, $6),
			 ($2, 'Admin', 'admin@t857.test', $6, $6),
			 ($3, 'Manager', 'manager@t857.test', $6, $6),
			 ($4, 'Demo', 'demo-t857@demo.invalid', $6, $6),
			 ($5, 'Taken', 'taken@t857.test', $6, $6)`,
			[ids.ownerUser, ids.adminUser, ids.managerUser, ids.demoUser, ids.takenUser, timestamp],
		);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t857-kiosk-m-owner', $1, $2, 'owner', 'approved', $6),
			 ('t857-kiosk-m-admin', $1, $3, 'admin', 'approved', $6),
			 ('t857-kiosk-m-manager', $1, $4, 'member', 'approved', $6),
			 ('t857-kiosk-m-demo', $1, $5, 'member', 'approved', $6)`,
			[org, ids.ownerUser, ids.adminUser, ids.managerUser, ids.demoUser, timestamp],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, is_active, updated_at) values
			 ($1, $2, $9, 'admin', true, now()),
			 ($3, $4, $9, 'admin', true, now()),
			 ($5, $6, $9, 'manager', true, now()),
			 ($7, $8, $9, 'employee', true, now())`,
			[
				ids.owner,
				ids.ownerUser,
				ids.admin,
				ids.adminUser,
				ids.manager,
				ids.managerUser,
				ids.demo,
				ids.demoUser,
				org,
			],
		);
		await pool.query(
			`insert into team (id, organization_id, name, updated_at) values
			 ($1, $2, 'Floor', now()), ($3, $4, 'Foreign', now())`,
			[ids.team, org, ids.foreignTeam, ids.otherOrganization],
		);
	});

	afterAll(cleanup);

	const seats = () =>
		countBillableSeats(db, org, { requireActiveEmployee: true, now: clock.nowInstant() });

	it("creates a credential-less user with a unique reserved address that counts as a seat", async () => {
		const before = await seats();

		const first = await createKioskOnlyEmployee(db, {
			organizationId: org,
			actorUserId: ids.adminUser,
			firstName: " Jamie ",
			lastName: "Doe",
			teamId: ids.team,
		});
		const second = await createKioskOnlyEmployee(db, {
			organizationId: org,
			actorUserId: ids.ownerUser,
			firstName: "Kim",
			lastName: "",
		});

		const { rows } = await pool.query(
			`select u.id as user_id, u.email, u.email_verified, m.role as member_role, m.status,
			        e.id as employee_id, u.name, u.first_name, u.last_name, e.team_id, e.role, e.is_active,
			        (select count(*)::int from account a where a.user_id = u.id) as accounts
			 from employee e join "user" u on u.id = e.user_id
			 join member m on m.user_id = u.id and m.organization_id = e.organization_id
			 where e.organization_id = $1 and e.id = any($2::uuid[]) order by u.first_name`,
			[org, [first.employeeId, second.employeeId]],
		);
		expect(rows).toEqual([
			expect.objectContaining({
				user_id: first.userId,
				email_verified: false,
				member_role: "member",
				status: "approved",
				name: "Jamie Doe",
				first_name: "Jamie",
				last_name: "Doe",
				team_id: ids.team,
				role: "employee",
				is_active: true,
				accounts: 0,
			}),
			expect.objectContaining({
				user_id: second.userId,
				name: "Kim",
				first_name: "Kim",
				last_name: null,
				team_id: null,
				accounts: 0,
			}),
		]);
		expect(rows.every((row) => isReservedEmail(row.email))).toBe(true);
		expect(rows[0].email).not.toBe(rows[1].email);
		// The demo member stays excluded; both kiosk-only employees are billable.
		expect(await seats()).toBe(before + 2);
	});

	it("assigns the locations picked at creation in the same transaction (#761)", async () => {
		await pool.query(
			`insert into location (id, organization_id, name, is_active, created_by, updated_at) values
			 ($1, $4, 'Store', true, $6, now()), ($2, $4, 'Warehouse', true, $6, now()),
			 ($3, $5, 'Foreign', true, $6, now())`,
			[ids.store, ids.warehouse, ids.foreignLocation, org, ids.otherOrganization, ids.ownerUser],
		);
		const assignedTo = async (employeeId: string) =>
			(
				await pool.query<{ location_id: string }>(
					`select location_id from employee_assigned_location
					 where organization_id = $1 and employee_id = $2 order by location_id`,
					[org, employeeId],
				)
			).rows.map((row) => row.location_id);

		const created = await createKioskOnlyEmployee(db, {
			organizationId: org,
			actorUserId: ids.adminUser,
			firstName: "Jamie",
			locationIds: [ids.store, ids.warehouse, ids.store],
		});

		expect(await assignedTo(created.employeeId)).toEqual([ids.store, ids.warehouse]);
		const usersBefore = await pool.query(
			"select count(*)::int as count from member where organization_id = $1",
			[org],
		);
		expect(
			await refusalOf(
				createKioskOnlyEmployee(db, {
					organizationId: org,
					actorUserId: ids.adminUser,
					firstName: "Kim",
					locationIds: [ids.store, ids.foreignLocation],
				}),
			),
		).toBe("location_not_found");
		// Nothing of the refused employee remains: user, membership and employee roll back together.
		const usersAfter = await pool.query(
			"select count(*)::int as count from member where organization_id = $1",
			[org],
		);
		expect(usersAfter.rows[0].count).toBe(usersBefore.rows[0].count);
	});

	it("lets only owners and admins create one, in their own organization's teams", async () => {
		const input = { organizationId: org, firstName: "Ana", lastName: "Lee" };
		expect(
			await refusalOf(createKioskOnlyEmployee(db, { ...input, actorUserId: ids.managerUser })),
		).toBe("not_allowed");
		expect(
			await refusalOf(
				createKioskOnlyEmployee(db, {
					...input,
					actorUserId: ids.adminUser,
					teamId: ids.foreignTeam,
				}),
			),
		).toBe("team_not_found");
		expect(
			await refusalOf(
				createKioskOnlyEmployee(db, { ...input, actorUserId: ids.adminUser, firstName: "  " }),
			),
		).toBe("invalid_name");
	});

	it("turns into an ordinary employee with a real email, keeping the user, PIN and history", async () => {
		const created = await createKioskOnlyEmployee(db, {
			organizationId: org,
			actorUserId: ids.adminUser,
			firstName: "Jamie",
			lastName: "Doe",
		});
		const { pin } = await issueKioskPin(db, {
			organizationId: org,
			actorUserId: ids.adminUser,
			employeeId: created.employeeId,
		});
		await pool.query(
			`insert into audit_log (organization_id, entity_type, entity_id, action, performed_by, employee_id, timestamp)
			 values ($1, 'employee', $2, 'history.marker', $3, $2, now())`,
			[org, created.employeeId, ids.adminUser],
		);

		const result = await addEmailToKioskOnlyEmployee(
			db,
			{
				organizationId: org,
				actorUserId: ids.ownerUser,
				employeeId: created.employeeId,
				email: " Jamie.Doe@Example.COM ",
			},
			deps,
		);

		expect(result).toEqual({ invitationSent: true });
		const { rows } = await pool.query(
			`select u.id, u.email, u.email_verified, e.id as employee_id
			 from employee e join "user" u on u.id = e.user_id where e.id = $1`,
			[created.employeeId],
		);
		expect(rows).toEqual([
			{
				id: created.userId,
				email: "jamie.doe@example.com",
				// Verified only when the person completes the emailed setup link, never by the admin typing it.
				email_verified: false,
				employee_id: created.employeeId,
			},
		]);
		expect(invitations).toEqual([
			{
				organizationId: org,
				email: "jamie.doe@example.com",
				inviterUserId: ids.ownerUser,
				invitationUrl: `https://app.example.com/reset-password?token=setup-${created.userId}`,
			},
		]);
		await expect(
			verifyEmployeeKioskPin(
				db,
				{ organizationId: org, employeeId: created.employeeId, pin },
				clock,
			),
		).resolves.toEqual({ status: "verified" });
		const history = await pool.query(
			"select count(*)::int as count from audit_log where employee_id = $1 and action = 'history.marker'",
			[created.employeeId],
		);
		expect(history.rows[0].count).toBe(1);
		// Both writes committed their audit entries with them.
		const audited = await pool.query(
			`select action, performed_by from audit_log
			 where employee_id = $1 and action like 'kiosk_only_employee.%' order by action`,
			[created.employeeId],
		);
		expect(audited.rows).toEqual([
			{ action: "kiosk_only_employee.created", performed_by: ids.adminUser },
			{ action: "kiosk_only_employee.email_added", performed_by: ids.ownerUser },
		]);
	});

	it("refuses unusable addresses, ordinary employees and non-admins", async () => {
		const created = await createKioskOnlyEmployee(db, {
			organizationId: org,
			actorUserId: ids.adminUser,
			firstName: "Jamie",
			lastName: "Doe",
		});
		const add = (
			email: string,
			overrides: Partial<{ actorUserId: string; employeeId: string }> = {},
		) =>
			addEmailToKioskOnlyEmployee(
				db,
				{
					organizationId: org,
					actorUserId: ids.adminUser,
					employeeId: created.employeeId,
					email,
					...overrides,
				},
				deps,
			);

		expect(await refusalOf(add("not-an-email"))).toBe("invalid_email");
		expect(await refusalOf(add("kiosk-other@kiosk.invalid"))).toBe("reserved_email");
		expect(await refusalOf(add("TAKEN@t857.test"))).toBe("email_in_use");
		expect(await refusalOf(add("new@t857.test", { actorUserId: ids.managerUser }))).toBe(
			"not_allowed",
		);
		expect(await refusalOf(add("new@t857.test", { employeeId: ids.manager }))).toBe(
			"not_kiosk_only",
		);
		expect(invitations).toEqual([]);
	});
});
