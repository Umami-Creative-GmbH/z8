/**
 * PostgreSQL contract (#942): the daily digest reads `shift.date` as the
 * organization's calendar day. It used to compare `DATE(shift.date)`, the UTC
 * date, with today and tomorrow.
 */
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { buildDigestDataForManager } from "./daily-digest";

/** Noon on 2026-10-09 in each zone, so today is 2026-10-09 and tomorrow 2026-10-10. */
const NOON = {
	"Europe/Berlin": "2026-10-09T10:00:00Z",
	"America/New_York": "2026-10-09T16:00:00Z",
	UTC: "2026-10-09T12:00:00Z",
} as const;

describe("daily digest shifts", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"summarizes the %s organization's shifts of today and tomorrow",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
			const [scheduled, scheduledYesterday] = await Promise.all(
				[1, 2].map(() => fixture.seedEmployee({ organizationId: org.organizationId })),
			);
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $3, true, $4), ($2, $3, true, $4)`,
				[
					scheduled.employeeId,
					scheduledYesterday.employeeId,
					manager.employeeId,
					org.creator.userId,
				],
			);
			await fixture.shift(org, { employeeId: null, stored: stored.previous });
			await fixture.shift(org, { employeeId: null, stored: stored.day });
			await fixture.shift(org, { employeeId: null, stored: stored.day });
			await fixture.shift(org, { employeeId: null, stored: stored.day, status: "draft" });
			await fixture.shift(org, { employeeId: null, stored: stored.next });
			await fixture.shift(org, { employeeId: scheduled.employeeId, stored: stored.day });
			await fixture.shift(org, {
				employeeId: scheduledYesterday.employeeId,
				stored: stored.previous,
			});

			const digest = await buildDigestDataForManager(
				manager.employeeId,
				org.organizationId,
				timezone,
				"en",
				Temporal.Instant.from(NOON[timezone]),
			);

			expect(digest).toMatchObject({
				openShiftsToday: 2,
				openShiftsTomorrow: 1,
				coverageGaps: [
					{
						subareaName: "Floor",
						timeSlot: "08:00-16:00",
						scheduled: 1,
						actual: 0,
						shortage: 1,
					},
				],
			});
		},
	);

	describe("pending compliance exceptions (#1977)", () => {
		const now = Temporal.Instant.from(NOON.UTC);

		async function directReport(org: ShiftTestOrganization, managerEmployeeId: string) {
			const report = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
				 values ($1, $2, true, $3)`,
				[report.employeeId, managerEmployeeId, org.creator.userId],
			);
			return report;
		}

		async function manager(org: ShiftTestOrganization) {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.pool.query("update employee set role = 'manager' where id = $1", [
				person.employeeId,
			]);
			return person;
		}

		async function exception(
			org: ShiftTestOrganization,
			employeeId: string,
			validFrom: Temporal.Instant = now.subtract({ hours: 2 }),
		) {
			await fixture.pool.query(
				`insert into compliance_exception
				 (id, organization_id, employee_id, exception_type, status, reason, valid_from, valid_until,
				  created_at, created_by, updated_at)
				 values ($1, $2, $3, 'overtime_daily', 'pending', 'Inventory', $4, $5, $4, $6, $4)`,
				[
					randomUUID(),
					org.organizationId,
					employeeId,
					validFrom.toString(),
					validFrom.add({ hours: 24 }).toString(),
					org.creator.userId,
				],
			);
		}

		function digestFor(org: ShiftTestOrganization, managerEmployeeId: string) {
			return buildDigestDataForManager(managerEmployeeId, org.organizationId, "UTC", "en", now);
		}

		it("counts only those whose validity window is still open", async () => {
			const org = await fixture.organization("UTC");
			const lead = await manager(org);
			const report = await directReport(org, lead.employeeId);
			await exception(org, report.employeeId);
			// Lapsed an hour ago: the Approval inbox lists it as expired, not pending.
			await exception(org, report.employeeId, now.subtract({ hours: 25 }));

			expect((await digestFor(org, lead.employeeId)).compliancePending).toBe(1);
		});

		it("counts a team member without a direct manager for the team's primary manager, as the inbox does", async () => {
			const org = await fixture.organization("UTC");
			const lead = await manager(org);
			// A direct report too, so this manager receives a digest at all.
			await directReport(org, lead.employeeId);
			const member = await fixture.seedEmployee({ organizationId: org.organizationId });
			const teamId = randomUUID();
			await fixture.pool.query(
				`insert into team (id, organization_id, name, primary_manager_id, updated_at)
				 values ($1, $2, 'Floor team', $3, now())`,
				[teamId, org.organizationId, lead.employeeId],
			);
			await fixture.pool.query("update employee set team_id = $2 where id = $1", [
				member.employeeId,
				teamId,
			]);
			await exception(org, member.employeeId);

			expect((await digestFor(org, lead.employeeId)).compliancePending).toBe(1);
		});

		it("counts none for an employee-role user with a direct report, who is no eligible manager", async () => {
			const org = await fixture.organization("UTC");
			const linked = await fixture.seedEmployee({ organizationId: org.organizationId });
			const report = await directReport(org, linked.employeeId);
			await exception(org, report.employeeId);

			expect((await digestFor(org, linked.employeeId)).compliancePending).toBeUndefined();
		});
	});
});
