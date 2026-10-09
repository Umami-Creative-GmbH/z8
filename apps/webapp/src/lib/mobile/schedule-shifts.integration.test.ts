/**
 * PostgreSQL contract (#942): the mobile schedule lists published shifts by
 * the organization's calendar days and keys them by the organization's
 * calendar date. It used to use UTC day bounds and UTC date keys.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { loadMobileScheduleShifts } from "./schedule-shifts";

/** Just after midnight on 2026-10-09 in each zone, still 2026-10-08 in UTC for UTC+ zones. */
const EARLY_ON_DAY = {
	"Europe/Berlin": "2026-10-08T22:30:00Z",
	"America/New_York": "2026-10-09T04:30:00Z",
	UTC: "2026-10-09T00:30:00Z",
} as const;

describe("mobile schedule shifts", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"lists the %s organization's shifts from its today on, keyed by its calendar date",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const other = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.shift(org, { employeeId: person.employeeId, stored: stored.previous });
			const today = await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: stored.day,
				startTime: "22:00",
				endTime: "06:00",
			});
			await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: stored.day,
				status: "draft",
			});
			await fixture.shift(org, { employeeId: other.employeeId, stored: stored.day });
			const tomorrow = await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: stored.next,
			});

			const shifts = await loadMobileScheduleShifts({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				now: Temporal.Instant.from(EARLY_ON_DAY[timezone]),
			});

			expect(shifts).toEqual([
				expect.objectContaining({
					id: today,
					date: SHIFT_DAY,
					startTime: "22:00",
					endTime: "06:00",
				}),
				expect.objectContaining({ id: tomorrow, date: "2026-10-10" }),
			]);
		},
	);

	it("ends the window after the organization's 28th calendar day", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		// 2026-11-05 and 2026-11-06 in Berlin (UTC+1 after the DST change).
		const lastDay = await fixture.shift(org, {
			employeeId: person.employeeId,
			stored: "2026-11-04T23:00:00Z",
		});
		await fixture.shift(org, { employeeId: person.employeeId, stored: "2026-11-05T23:00:00Z" });

		const shifts = await loadMobileScheduleShifts({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			now: Temporal.Instant.from(EARLY_ON_DAY["Europe/Berlin"]),
		});

		expect(shifts.map((shift) => [shift.id, shift.date])).toEqual([[lastDay, "2026-11-05"]]);
	});
});
