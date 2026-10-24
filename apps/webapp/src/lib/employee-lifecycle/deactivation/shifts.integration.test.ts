/**
 * #1440 (spec #1437, decision D7): shifts that start after the deactivation
 * instant become open shifts, audited under the acting admin; past and running
 * shifts stay. The person's current managers get one notice with the count,
 * org admins when the person had no manager.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditTrail } from "@/lib/audit-trail";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "../testing/database.test.fixture";

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));
vi.mock("@/lib/notifications/notification-service", () => ({ createNotification }));

const { applyShiftsToOpen, planShiftsToOpen } = await import("./shifts");
type Contexts = import("./types").DeactivationApplyContext;

const zone = "Europe/Berlin";
// 11:00 in Berlin.
const at: Instant = parseInstant("2026-10-24T09:00:00Z");

describe("deactivation opens upcoming shifts (#1440)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification" });
	});

	async function organization() {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query(`update organization set timezone = $2 where id = $1`, [
			organizationId,
			zone,
		]);
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[locationId, organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, fixture.ownerUserId],
		);
		return { organizationId, subareaId };
	}

	async function shift(
		org: { organizationId: string; subareaId: string },
		person: SeededEmployee,
		date: string,
		startTime: string,
		endTime: string,
		status: "draft" | "published" = "published",
	) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
			[
				id,
				org.organizationId,
				person.employeeId,
				org.subareaId,
				shiftStoredDate(date, zone),
				startTime,
				endTime,
				status,
				fixture.ownerUserId,
			],
		);
		return id;
	}

	async function link(report: SeededEmployee, manager: SeededEmployee) {
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[report.employeeId, manager.employeeId, fixture.ownerUserId],
		);
	}

	function context(organizationId: string, leaver: SeededEmployee): Contexts {
		return {
			organizationId,
			employeeId: leaver.employeeId,
			at,
			organizationTimeZone: zone,
			employmentPeriodId: leaver.employmentPeriodId,
			replacementManagers: {},
			replaceManagers: true,
			actorUserId: fixture.ownerUserId,
			deactivationId: randomUUID(),
			reason: "employee_deactivated",
			audit: new AuditTrail(),
		};
	}

	it("plans the shifts that start after the instant and the person's current managers", async () => {
		const org = await organization();
		const leaver = await fixture.seedEmployee({ organizationId: org.organizationId });
		const colleague = await fixture.seedEmployee({ organizationId: org.organizationId });
		const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
		const formerManager = await fixture.seedEmployee({
			organizationId: org.organizationId,
			isActive: false,
		});
		await link(leaver, manager);
		await link(leaver, formerManager);
		await shift(org, leaver, "2026-10-23", "08:00", "16:00");
		// Started at 08:00 Berlin, before the instant: stays.
		await shift(org, leaver, "2026-10-24", "08:00", "16:00");
		// Overnight from yesterday, started before the instant: stays.
		await shift(org, leaver, "2026-10-23", "22:00", "06:00");
		const later = await shift(org, leaver, "2026-10-24", "12:00", "18:00");
		const draft = await shift(org, leaver, "2026-10-30", "09:00", "17:00", "draft");
		await shift(org, colleague, "2026-10-25", "09:00", "17:00");

		const plan = await planShiftsToOpen(fixture.db, context(org.organizationId, leaver));

		expect(plan).toEqual({
			shiftsToOpen: [
				{ shiftId: later, date: "2026-10-24", startTime: "12:00", endTime: "18:00" },
				{ shiftId: draft, date: "2026-10-30", startTime: "09:00", endTime: "17:00" },
			],
			plannerRecipientUserIds: [manager.userId],
		});
	});

	it("tells the organization admins when the person had no manager", async () => {
		const org = await organization();
		const leaver = await fixture.seedEmployee({
			organizationId: org.organizationId,
			role: "admin",
		});
		const admin = await fixture.seedEmployee({ organizationId: org.organizationId, role: "admin" });
		const owner = await fixture.seedEmployee({ organizationId: org.organizationId, role: "owner" });
		await fixture.seedEmployee({ organizationId: org.organizationId });
		await shift(org, leaver, "2026-10-26", "09:00", "17:00");

		const plan = await planShiftsToOpen(fixture.db, context(org.organizationId, leaver));

		// Never the person who leaves, even as an admin.
		expect(plan.plannerRecipientUserIds).toEqual([admin.userId, owner.userId].toSorted());
	});

	it("tells nobody when no shift opens", async () => {
		const org = await organization();
		const leaver = await fixture.seedEmployee({ organizationId: org.organizationId });
		const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
		await link(leaver, manager);
		await shift(org, leaver, "2026-10-20", "09:00", "17:00");

		const plan = await planShiftsToOpen(fixture.db, context(org.organizationId, leaver));

		expect(plan).toEqual({ shiftsToOpen: [], plannerRecipientUserIds: [] });
	});

	it("opens exactly the planned shifts, audits each and notifies each planner once after the commit", async () => {
		const org = await organization();
		const leaver = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.pool.query(`update "user" set name = 'Robin Leaver' where id = $1`, [
			leaver.userId,
		]);
		const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
		await link(leaver, manager);
		const past = await shift(org, leaver, "2026-10-23", "08:00", "16:00");
		const first = await shift(org, leaver, "2026-10-25", "08:00", "16:00");
		const second = await shift(org, leaver, "2026-10-26", "08:00", "16:00");
		const ctx = context(org.organizationId, leaver);
		const plan = await planShiftsToOpen(fixture.db, ctx);

		const result = await fixture.db.transaction((tx) => applyShiftsToOpen(tx, ctx, plan));

		expect(result.applied).toEqual({ openedShiftIds: [first, second] });
		const rows = await fixture.pool.query<{ id: string; employee_id: string | null }>(
			`select id, employee_id from shift where organization_id = $1`,
			[org.organizationId],
		);
		expect(rows.rows).toEqual(
			expect.arrayContaining([
				{ id: past, employee_id: leaver.employeeId },
				{ id: first, employee_id: null },
				{ id: second, employee_id: null },
			]),
		);
		const audits = await fixture.pool.query<{
			action: string;
			entity_type: string;
			entity_id: string;
			employee_id: string;
			performed_by: string;
			metadata: string;
		}>(
			`select action, entity_type, entity_id, employee_id, performed_by, metadata from audit_log
			 where organization_id = $1 order by entity_id`,
			[org.organizationId],
		);
		expect(audits.rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }))).toEqual(
			[first, second].toSorted().map((shiftId) => ({
				action: "shift.unassigned",
				entity_type: "shift",
				entity_id: shiftId,
				employee_id: leaver.employeeId,
				performed_by: fixture.ownerUserId,
				metadata: expect.objectContaining({
					reason: "employee_deactivated",
					deactivationId: ctx.deactivationId,
				}),
			})),
		);

		expect(createNotification).not.toHaveBeenCalled();
		for (const step of result.afterCommit) await step();
		expect(createNotification).toHaveBeenCalledTimes(1);
		expect(createNotification.mock.calls[0]?.[0]).toMatchObject({
			userId: manager.userId,
			organizationId: org.organizationId,
			type: "employee_deactivation_shifts_opened",
			message: "Robin Leaver was deactivated. 2 upcoming shifts are open now.",
			idempotencyKey: `deactivation-shifts:${ctx.deactivationId}:${manager.userId}`,
		});

		// A re-run changes nothing and sends no notice.
		const again = await fixture.db.transaction(async (tx) =>
			applyShiftsToOpen(tx, ctx, await planShiftsToOpen(tx, ctx)),
		);
		expect(again.applied.openedShiftIds).toEqual([]);
		for (const step of again.afterCommit) await step();
		expect(createNotification).toHaveBeenCalledTimes(1);
	});
});
