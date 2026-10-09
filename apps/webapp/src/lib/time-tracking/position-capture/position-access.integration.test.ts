/**
 * #831: who may see position stamps, the work period "Show positions" read and
 * the position stamp access log, through the server actions and the reusable
 * seams on PostgreSQL. Only the session is mocked.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

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
							user: {
								id: harness.userId,
								role: harness.userId.includes("platform") ? "admin" : "user",
							},
							session: {
								id: `t831-session-${harness.userId}`,
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
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

const detail = await import("@/app/[locale]/(app)/calendar/position-stamps-actions");
const own = await import("@/app/[locale]/(app)/settings/position-stamps/actions");
const { loadPositionStampViewer, positionStampAccess } = await import("./viewer");
const { recordPositionStampAccess, listPositionStampAccessLog } = await import("./access-log");

const ids = {
	organization: "t831-position-org",
	otherOrganization: "t831-other-org",
	ownerUser: "t831-owner-user",
	adminUser: "t831-admin-user",
	managerUser: "t831-manager-user",
	holderUser: "t831-holder-user",
	lapsedHolderUser: "t831-lapsed-holder-user",
	fieldUser: "t831-field-user",
	platformUser: "t831-platform-user",
	foreignUser: "t831-foreign-user",
	owner: "d8310000-0000-4000-8000-000000000001",
	adminEmployee: "d8310000-0000-4000-8000-000000000002",
	manager: "d8310000-0000-4000-8000-000000000003",
	holder: "d8310000-0000-4000-8000-000000000004",
	lapsedHolder: "d8310000-0000-4000-8000-000000000005",
	field: "d8310000-0000-4000-8000-000000000006",
	platform: "d8310000-0000-4000-8000-000000000007",
	foreign: "d8310000-0000-4000-8000-000000000008",
	viewerRole: "d8310000-0000-4000-8000-0000000000c1",
	inactiveRole: "d8310000-0000-4000-8000-0000000000c2",
	managerRole: "d8310000-0000-4000-8000-0000000000c3",
	notice: "d8310000-0000-4000-8000-0000000000a1",
	consent: "d8310000-0000-4000-8000-0000000000b1",
	clockIn: "d8310000-0000-4000-8000-0000000000e1",
	clockOut: "d8310000-0000-4000-8000-0000000000e2",
	correctedClockOut: "d8310000-0000-4000-8000-0000000000e3",
	foreignClockIn: "d8310000-0000-4000-8000-0000000000e4",
	period: "d8310000-0000-4000-8000-0000000000f1",
	foreignPeriod: "d8310000-0000-4000-8000-0000000000f2",
} as const;
const users = [
	ids.ownerUser,
	ids.adminUser,
	ids.managerUser,
	ids.holderUser,
	ids.lapsedHolderUser,
	ids.fieldUser,
	ids.platformUser,
	ids.foreignUser,
];

describe("position stamp viewing and access log on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const at = new Date("2026-01-01T00:00:00Z");
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T831 position', $1, 'Europe/Berlin', $3), ($2, 'T831 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, at],
		);
		await pool.query(
			`insert into "user" (id, name, email, role, created_at, updated_at)
			 select user_id, initcap(replace(user_id, '-', ' ')), user_id || '@example.test',
				case when user_id = $3 then 'admin' else 'user' end, $2, $2
			 from unnest($1::text[]) as user_id`,
			[users, at, ids.platformUser],
		);
		const members: Array<[string, string, string]> = [
			[ids.ownerUser, ids.organization, "owner"],
			[ids.adminUser, ids.organization, "admin"],
			[ids.managerUser, ids.organization, "member"],
			[ids.holderUser, ids.organization, "member"],
			[ids.lapsedHolderUser, ids.organization, "member"],
			[ids.fieldUser, ids.organization, "member"],
			[ids.platformUser, ids.organization, "member"],
			[ids.foreignUser, ids.otherOrganization, "owner"],
		];
		for (const [userId, organizationId, role] of members) {
			await pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`m-${userId}`, organizationId, userId, role, at],
			);
		}
		const employees: Array<[string, string, string, string]> = [
			[ids.owner, ids.ownerUser, ids.organization, "admin"],
			[ids.adminEmployee, ids.adminUser, ids.organization, "admin"],
			[ids.manager, ids.managerUser, ids.organization, "manager"],
			[ids.holder, ids.holderUser, ids.organization, "employee"],
			[ids.lapsedHolder, ids.lapsedHolderUser, ids.organization, "employee"],
			[ids.field, ids.fieldUser, ids.organization, "employee"],
			[ids.platform, ids.platformUser, ids.organization, "employee"],
			[ids.foreign, ids.foreignUser, ids.otherOrganization, "admin"],
		];
		for (const [employeeId, userId, organizationId, role] of employees) {
			await pool.query(
				`insert into employee (id, user_id, organization_id, role, employee_number, updated_at)
				 values ($1, $2, $3, $4, $6, $5)`,
				[employeeId, userId, organizationId, role, at, `N-${employeeId}`],
			);
		}
		await pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.field, ids.manager, ids.ownerUser],
		);
		await pool.query(
			`insert into custom_role (id, organization_id, name, is_active, base_tier, created_by, updated_at) values
			 ($1, $4, 'Position reviewer', true, 'employee', $5, $6),
			 ($2, $4, 'Former reviewer', false, 'employee', $5, $6),
			 ($3, $4, 'Team lead', true, 'manager', $5, $6)`,
			[ids.viewerRole, ids.inactiveRole, ids.managerRole, ids.organization, ids.ownerUser, at],
		);
		await pool.query(
			`insert into custom_role_permission (custom_role_id, action, subject) values
			 ($1, 'read', 'PositionStamp'), ($2, 'read', 'PositionStamp'),
			 ($3, 'manage', 'TimeEntry'), ($3, 'read', 'TimeEntry')`,
			[ids.viewerRole, ids.inactiveRole, ids.managerRole],
		);
		await pool.query(
			`insert into employee_custom_role (employee_id, custom_role_id, assigned_by) values
			 ($1, $2, $5), ($3, $4, $5), ($6, $7, $5)`,
			[
				ids.holder,
				ids.viewerRole,
				ids.lapsedHolder,
				ids.inactiveRole,
				ids.ownerUser,
				ids.manager,
				ids.managerRole,
			],
		);

		// The field employee's notice, consent and one corrected work period.
		await pool.query(
			`insert into position_notice (id, organization_id, version, purpose_statement, retention_days, template_revision, created_at)
			 values ($1, $2, 1, 'Proof of on-site work', 90, 1, $3)`,
			[ids.notice, ids.organization, at],
		);
		await pool.query(
			`insert into position_consent (id, organization_id, employee_id, notice_id, granted_at)
			 values ($1, $2, $3, $4, $5)`,
			[ids.consent, ids.organization, ids.field, ids.notice, at],
		);
		const entry = `insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
			timezone_source, hash, created_by, replaces_entry_id, is_superseded, superseded_by_id)
			values ($1, $2, $3, $4, $5, 120, 'test', md5(random()::text), $6, $7, $8, $9)`;
		await pool.query(entry, [
			ids.clockIn,
			ids.field,
			ids.organization,
			"clock_in",
			new Date("2026-09-20T06:00:00Z"),
			ids.fieldUser,
			null,
			false,
			null,
		]);
		await pool.query(entry, [
			ids.clockOut,
			ids.field,
			ids.organization,
			"clock_out",
			new Date("2026-09-20T14:00:00Z"),
			ids.fieldUser,
			null,
			true,
			ids.correctedClockOut,
		]);
		await pool.query(entry, [
			ids.correctedClockOut,
			ids.field,
			ids.organization,
			"clock_out",
			new Date("2026-09-20T14:30:00Z"),
			ids.ownerUser,
			ids.clockOut,
			false,
			null,
		]);
		await pool.query(entry, [
			ids.foreignClockIn,
			ids.foreign,
			ids.otherOrganization,
			"clock_in",
			new Date("2026-09-20T06:00:00Z"),
			ids.foreignUser,
			null,
			false,
			null,
		]);
		await pool.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
				duration_minutes, is_active, updated_at) values
			 ($1, $2, $3, $4, $5, $6, $7, 510, false, $8),
			 ($9, $10, $11, $12, null, $6, null, null, true, $8)`,
			[
				ids.period,
				ids.field,
				ids.organization,
				ids.clockIn,
				ids.correctedClockOut,
				new Date("2026-09-20T06:00:00Z"),
				new Date("2026-09-20T14:30:00Z"),
				at,
				ids.foreignPeriod,
				ids.foreign,
				ids.otherOrganization,
				ids.foreignClockIn,
			],
		);
		const stamp = `insert into position_stamp (organization_id, employee_id, time_entry_id, consent_id,
			latitude, longitude, accuracy_meters, fixed_at, captured_at, purge_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`;
		await pool.query(stamp, [
			ids.organization,
			ids.field,
			ids.clockIn,
			ids.consent,
			52.520008,
			13.404954,
			18.5,
			new Date("2026-09-20T06:00:00Z"),
			new Date("2026-12-19T06:00:00Z"),
		]);
		await pool.query(stamp, [
			ids.organization,
			ids.field,
			ids.clockOut,
			ids.consent,
			52.51,
			13.39,
			34.2,
			new Date("2026-09-20T14:00:00Z"),
			new Date("2026-12-19T14:00:00Z"),
		]);
	}

	async function accessLogCount(): Promise<number> {
		const { rows } = await pool.query<{ count: string }>(
			"select count(*) from position_stamp_access_log where organization_id = $1",
			[ids.organization],
		);
		return Number(rows[0]?.count);
	}

	async function show(userId: string, workPeriodId: string = ids.period) {
		actAs(userId);
		return detail.showWorkPeriodPositionsAction({ workPeriodId });
	}

	beforeEach(async () => {
		vi.restoreAllMocks();
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("loads who may see stamps from membership, employee and custom-role grants", async () => {
		const load = (userId: string) =>
			loadPositionStampViewer(db, { organizationId: ids.organization, userId });

		expect(await load(ids.ownerUser)).toMatchObject({
			organizationWide: "owner",
			ownEmployeeId: ids.owner,
		});
		expect(await load(ids.adminUser)).toMatchObject({ organizationWide: "admin" });
		expect(await load(ids.holderUser)).toMatchObject({ organizationWide: "permission" });
		for (const userId of [ids.managerUser, ids.lapsedHolderUser, ids.platformUser, ids.fieldUser]) {
			expect(await load(userId)).toMatchObject({ organizationWide: null });
		}
		// An owner of another organization has nothing here.
		expect(await load(ids.foreignUser)).toMatchObject({
			organizationWide: null,
			ownEmployeeId: null,
		});
		expect(positionStampAccess(await load(ids.fieldUser), ids.field)).toMatchObject({
			allowed: true,
			logged: false,
		});
	});

	it("refuses a manager without the permission, a platform admin and a foreign owner, and logs nothing", async () => {
		for (const userId of [ids.managerUser, ids.platformUser, ids.lapsedHolderUser]) {
			expect(await show(userId)).toMatchObject({ success: false, code: "AuthorizationError" });
		}
		actAs(ids.foreignUser, ids.otherOrganization);
		expect(await detail.showWorkPeriodPositionsAction({ workPeriodId: ids.period })).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(await accessLogCount()).toBe(0);
	});

	it("shows owners, admins and permission holders the stamps and logs exactly one entry per view", async () => {
		for (const [index, userId] of [ids.ownerUser, ids.adminUser, ids.holderUser].entries()) {
			const result = await show(userId);
			expect(result.success).toBe(true);
			expect(await accessLogCount()).toBe(index + 1);
		}

		const entries = await listPositionStampAccessLog(db, {
			organizationId: ids.organization,
			subjectEmployeeId: ids.field,
		});
		expect(entries).toHaveLength(3);
		expect(entries.map((entry) => entry.viewer?.userId).sort()).toEqual(
			[ids.adminUser, ids.holderUser, ids.ownerUser].sort(),
		);
		expect(entries[0]).toMatchObject({
			kind: "work_period_detail",
			subjectEmployeeIds: [ids.field],
			exportId: null,
			workPeriods: [
				{
					id: ids.period,
					startedAt: parseInstant("2026-09-20T06:00:00Z"),
					utcOffsetMinutes: 120,
				},
			],
		});
	});

	it("shows the employee their own stamps without an access-log entry", async () => {
		const result = await show(ids.fieldUser);
		expect(result.success).toBe(true);
		expect(await accessLogCount()).toBe(0);
	});

	it("labels a stamp whose clock event was corrected as belonging to the original event", async () => {
		const result = await show(ids.fieldUser);
		if (!result.success) throw new Error(result.error);
		expect(result.data.stamps).toEqual([
			{
				event: "clock_in",
				latitude: 52.520008,
				longitude: 13.404954,
				accuracyMeters: 18.5,
				fixedAt: "2026-09-20T06:00:00Z",
				eventAt: "2026-09-20T06:00:00Z",
				eventUtcOffsetMinutes: 120,
				originalEvent: false,
			},
			{
				event: "clock_out",
				latitude: 52.51,
				longitude: 13.39,
				accuracyMeters: 34.2,
				fixedAt: "2026-09-20T14:00:00Z",
				eventAt: "2026-09-20T14:00:00Z",
				eventUtcOffsetMinutes: 120,
				originalEvent: true,
			},
		]);
	});

	it("tells the calendar who may press Show positions", async () => {
		actAs(ids.managerUser);
		expect(await detail.getPositionStampViewerAccessAction()).toMatchObject({
			success: true,
			data: { available: true, ownEmployeeId: ids.manager, mayViewOthers: false },
		});
		actAs(ids.holderUser);
		expect(await detail.getPositionStampViewerAccessAction()).toMatchObject({
			success: true,
			data: { available: true, mayViewOthers: true },
		});
		actAs(ids.foreignUser, ids.otherOrganization);
		expect(await detail.getPositionStampViewerAccessAction()).toMatchObject({
			success: true,
			data: { available: false, mayViewOthers: true },
		});
	});

	it("lists only the employee's own access log in their settings", async () => {
		await show(ids.ownerUser);
		await show(ids.fieldUser);
		await db.transaction((tx) =>
			recordPositionStampAccess(tx, {
				organizationId: ids.organization,
				viewerUserId: ids.adminUser,
				kind: "data_export",
				exportId: "export-1",
				subjectEmployeeIds: [ids.field, ids.holder],
				// Before the detail view above, which is logged at the server's clock.
				accessedAt: parseInstant("2026-01-02T10:00:00Z"),
			}),
		);

		actAs(ids.fieldUser);
		const fieldLog = await own.getOwnPositionStampAccessLogAction();
		if (!fieldLog.success) throw new Error(fieldLog.error);
		expect(fieldLog.data.map((entry) => [entry.kind, entry.viewerName])).toEqual([
			["work_period_detail", "T831 Owner User"],
			["data_export", "T831 Admin User"],
		]);
		expect(fieldLog.data[0]).toMatchObject({ workPeriods: [{ date: "2026-09-20" }] });

		actAs(ids.managerUser);
		const managerLog = await own.getOwnPositionStampAccessLogAction();
		expect(managerLog).toMatchObject({ success: true, data: [] });
	});

	it("keeps access-log entries append-only and survives the viewer's deletion", async () => {
		await show(ids.ownerUser);
		await expect(
			pool.query(
				"update position_stamp_access_log set accessed_at = now() where organization_id = $1",
				[ids.organization],
			),
		).rejects.toThrow(/append-only/);
		await expect(
			pool.query(
				"update position_stamp_access_log_subject set employee_id = $2 where organization_id = $1",
				[ids.organization, ids.holder],
			),
		).rejects.toThrow(/append-only/);

		await show(ids.holderUser);
		await pool.query("delete from employee where user_id = $1", [ids.holderUser]);
		await pool.query("delete from member where user_id = $1", [ids.holderUser]);
		await pool.query('delete from "user" where id = $1', [ids.holderUser]);

		const entries = await listPositionStampAccessLog(db, { organizationId: ids.organization });
		expect(entries).toHaveLength(2);
		expect(entries.find((entry) => entry.viewer === null)).toBeDefined();
	});

	it("refuses an access-log entry naming an employee of another organization", async () => {
		await expect(
			db.transaction((tx) =>
				recordPositionStampAccess(tx, {
					organizationId: ids.organization,
					viewerUserId: ids.ownerUser,
					kind: "work_period_detail",
					workPeriodIds: [ids.period],
					subjectEmployeeIds: [ids.foreign],
					accessedAt: parseInstant("2026-10-01T10:00:00Z"),
				}),
			),
		).rejects.toThrow();
		expect(await accessLogCount()).toBe(0);
	});
});
