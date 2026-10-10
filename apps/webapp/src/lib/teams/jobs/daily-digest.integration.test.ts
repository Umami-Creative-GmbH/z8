/**
 * PostgreSQL contract (#942): the daily digest reads `shift.date` as the
 * organization's calendar day. It used to compare `DATE(shift.date)`, the UTC
 * date, with today and tomorrow.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
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
});
