/**
 * PostgreSQL contract (#988): a scheduled export's owner must stay an org admin. A schedule
 * whose owner was demoted, removed or deactivated pauses once, with an automatic audit entry
 * attributed to the owner, and every org admin of its organization is told.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { pauseSchedulesAfterOwnerAccessChange } from "./owner-access-change";
import {
	describeScheduleOwners,
	listScheduleOwnerCandidates,
	pauseSchedulesWithIneligibleOwners,
} from "./schedule-owner";

vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);

const NOW = parseInstant("2026-10-11T08:00:00Z");

describe("scheduled export owners", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function seedSchedule(input: {
		organizationId: string;
		ownerId: string;
		isActive?: boolean;
		name?: string;
	}) {
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into scheduled_export
			 (organization_id, name, schedule_type, report_type, report_config, date_range_strategy,
				delivery_method, email_recipients, owner_id, created_by, is_active, updated_at)
			 values ($1, $2, 'monthly', 'payroll_export', '{"formatId":"datev_lohn"}', 'previous_month',
				'email_only', $3, $4, $4, $5, now())
			 returning id`,
			[
				input.organizationId,
				input.name ?? "Monthly payroll",
				["tax@example.com"],
				input.ownerId,
				input.isActive ?? true,
			],
		);
		return rows[0]?.id as string;
	}

	async function isActive(scheduleId: string) {
		const { rows } = await fixture.pool.query<{ is_active: boolean }>(
			"select is_active from scheduled_export where id = $1",
			[scheduleId],
		);
		return rows[0]?.is_active;
	}

	async function auditFor(scheduleId: string) {
		const { rows } = await fixture.pool.query<{
			action: string;
			performed_by: string;
			metadata: string | null;
		}>(
			`select action, performed_by, metadata from audit_log
			 where entity_type = 'scheduled_export' and entity_id = $1 order by timestamp`,
			[scheduleId],
		);
		return rows.map((row) => ({
			action: row.action,
			performedBy: row.performed_by,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	async function pausedNotices(scheduleId: string) {
		const { rows } = await fixture.pool.query<{ user_id: string; action_url: string }>(
			`select user_id, action_url from notification
			 where type = 'scheduled_export_paused' and entity_id = $1 order by user_id`,
			[scheduleId],
		);
		return rows;
	}

	/** An organization with an owner, two admins and a member. */
	async function organization() {
		const organizationId = await fixture.createOrganization();
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const admin = await fixture.seedEmployee({ organizationId, role: "admin" });
		const otherAdmin = await fixture.seedEmployee({ organizationId, role: "admin" });
		const member = await fixture.seedEmployee({ organizationId });
		return { organizationId, owner, admin, otherAdmin, member };
	}

	async function demote(employee: SeededEmployee) {
		await fixture.pool.query("update member set role = 'member' where id = $1", [
			employee.memberId,
		]);
	}

	it("counts approved owners and admins with access as owners, and nobody else", async () => {
		const org = await organization();
		const deactivated = await fixture.seedEmployee({
			organizationId: org.organizationId,
			role: "admin",
			isActive: false,
		});
		const elsewhere = await organization();

		const owners = await describeScheduleOwners(fixture.db, {
			organizationId: org.organizationId,
			userIds: [
				org.owner.userId,
				org.admin.userId,
				org.member.userId,
				deactivated.userId,
				elsewhere.admin.userId,
				"no-such-user",
			],
			now: NOW,
		});

		expect(Object.fromEntries([...owners].map(([id, owner]) => [id, owner.eligible]))).toEqual({
			[org.owner.userId]: true,
			[org.admin.userId]: true,
			[org.member.userId]: false,
			[deactivated.userId]: false,
			[elsewhere.admin.userId]: false,
			"no-such-user": false,
		});
		const candidates = await listScheduleOwnerCandidates(fixture.db, {
			organizationId: org.organizationId,
			now: NOW,
		});
		expect(candidates.map((candidate) => candidate.userId).sort()).toEqual(
			[org.owner.userId, org.admin.userId, org.otherAdmin.userId].sort(),
		);
	});

	it("pauses each schedule whose owner lost admin rights once, audited as the owner, and tells every org admin", async () => {
		const org = await organization();
		const demoted = await fixture.seedEmployee({
			organizationId: org.organizationId,
			role: "admin",
		});
		const removed = await fixture.seedEmployee({
			organizationId: org.organizationId,
			role: "admin",
		});
		const deactivated = await fixture.seedEmployee({
			organizationId: org.organizationId,
			role: "admin",
		});
		const kept = await seedSchedule({
			organizationId: org.organizationId,
			ownerId: org.admin.userId,
		});
		const ofDemoted = await seedSchedule({
			organizationId: org.organizationId,
			ownerId: demoted.userId,
			name: "Payroll",
		});
		const ofRemoved = await seedSchedule({
			organizationId: org.organizationId,
			ownerId: removed.userId,
		});
		const ofDeactivated = await seedSchedule({
			organizationId: org.organizationId,
			ownerId: deactivated.userId,
		});
		const alreadyPaused = await seedSchedule({
			organizationId: org.organizationId,
			ownerId: demoted.userId,
			isActive: false,
		});
		await demote(demoted);
		await fixture.pool.query("delete from member where id = $1", [removed.memberId]);
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			deactivated.employeeId,
		]);

		const paused = await pauseSchedulesWithIneligibleOwners(fixture.db, {
			organizationId: org.organizationId,
			now: NOW,
		});
		const again = await pauseSchedulesWithIneligibleOwners(fixture.db, {
			organizationId: org.organizationId,
			now: NOW,
		});

		expect(paused.map((schedule) => schedule.id).sort()).toEqual(
			[ofDemoted, ofRemoved, ofDeactivated].sort(),
		);
		expect(again).toEqual([]);
		expect(await isActive(kept)).toBe(true);
		for (const id of [ofDemoted, ofRemoved, ofDeactivated]) expect(await isActive(id)).toBe(false);

		expect(await auditFor(ofDemoted)).toEqual([
			{
				action: "scheduled_export.paused",
				performedBy: demoted.userId,
				metadata: expect.objectContaining({
					automatic: true,
					reason: "owner_not_org_admin",
					ownerId: demoted.userId,
				}),
			},
		]);
		expect(await auditFor(alreadyPaused)).toEqual([]);
		expect(await auditFor(kept)).toEqual([]);

		const admins = [org.owner.userId, org.admin.userId, org.otherAdmin.userId].sort();
		const notices = await pausedNotices(ofDemoted);
		expect(notices.map((notice) => notice.user_id)).toEqual(admins);
		expect(notices.every((notice) => notice.action_url === "/settings/scheduled-exports")).toBe(
			true,
		);
	});

	it("leaves other organizations' schedules and admins alone", async () => {
		const org = await organization();
		const other = await organization();
		const lost = await seedSchedule({
			organizationId: other.organizationId,
			ownerId: other.admin.userId,
		});
		await demote(other.admin);

		await pauseSchedulesWithIneligibleOwners(fixture.db, {
			organizationId: org.organizationId,
			now: NOW,
		});
		expect(await isActive(lost)).toBe(true);

		await pauseSchedulesWithIneligibleOwners(fixture.db, { now: NOW });
		expect(await isActive(lost)).toBe(false);
		const notified = (await pausedNotices(lost)).map((notice) => notice.user_id);
		expect(notified).not.toContain(org.owner.userId);
		expect(notified).not.toContain(org.admin.userId);
	});

	it("pauses only the changed owner's schedules after an access change, naming who changed it", async () => {
		const org = await organization();
		const ofAdmin = await seedSchedule({
			organizationId: org.organizationId,
			ownerId: org.admin.userId,
		});
		const ofOther = await seedSchedule({
			organizationId: org.organizationId,
			ownerId: org.otherAdmin.userId,
		});
		await demote(org.admin);
		await demote(org.otherAdmin);

		await pauseSchedulesAfterOwnerAccessChange(fixture.db, {
			organizationId: org.organizationId,
			owner: { employeeId: org.admin.employeeId },
			actorUserId: org.owner.userId,
		});

		expect(await isActive(ofAdmin)).toBe(false);
		expect(await isActive(ofOther)).toBe(true);
		expect(await auditFor(ofAdmin)).toEqual([
			expect.objectContaining({
				performedBy: org.admin.userId,
				metadata: expect.objectContaining({ triggeredBy: org.owner.userId }),
			}),
		]);
	});
});
