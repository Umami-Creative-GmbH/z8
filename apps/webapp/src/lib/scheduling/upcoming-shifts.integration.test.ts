/**
 * PostgreSQL contract (#977): an employee's upcoming shifts are their own published shifts in
 * the active organization, from the organization's today on, keyed by its calendar date.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "./testing/shift-database.test.fixture";
import { loadUpcomingShifts } from "./upcoming-shifts";

/** Just after midnight on 2026-10-09 in each zone, still 2026-10-08 in UTC for UTC+ zones. */
const EARLY_ON_DAY = {
	"Europe/Berlin": "2026-10-08T22:30:00Z",
	"America/New_York": "2026-10-09T04:30:00Z",
	UTC: "2026-10-09T00:30:00Z",
} as const;

describe("upcoming shifts", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"lists the employee's published %s shifts from the organization's today on",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const colleague = await fixture.seedEmployee({ organizationId: org.organizationId });
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
			await fixture.shift(org, { employeeId: colleague.employeeId, stored: stored.day });
			await fixture.shift(org, { employeeId: null, stored: stored.day });
			const tomorrow = await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: stored.next,
			});

			const upcoming = await loadUpcomingShifts(db, {
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				organizationTimezone: timezone,
				now: Temporal.Instant.from(EARLY_ON_DAY[timezone]),
				limit: 5,
			});

			expect(upcoming.today).toBe(SHIFT_DAY);
			expect(upcoming.shifts).toEqual([
				{
					id: today,
					date: SHIFT_DAY,
					startTime: "22:00",
					endTime: "06:00",
					notes: null,
					subareaName: "Floor",
					locationName: "Store",
				},
				expect.objectContaining({ id: tomorrow, date: "2026-10-10" }),
			]);
		},
	);

	it("leaves out another organization's shifts", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const otherOrg = await fixture.organization("Europe/Berlin");
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		const own = await fixture.shift(org, {
			employeeId: person.employeeId,
			stored: STORED_SHIFT_DATES["Europe/Berlin"].next,
		});
		// A shift row carrying the same employee in another organization must never leak in.
		await fixture.shift(otherOrg, {
			employeeId: person.employeeId,
			stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
		});

		const upcoming = await loadUpcomingShifts(db, {
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			organizationTimezone: "Europe/Berlin",
			now: Temporal.Instant.from(EARLY_ON_DAY["Europe/Berlin"]),
			limit: 5,
		});

		expect(upcoming.shifts.map((shift) => shift.id)).toEqual([own]);
	});

	it("drops today's shifts that already ended and keeps the one still running", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		const day = STORED_SHIFT_DATES["Europe/Berlin"].day;
		await fixture.shift(org, {
			employeeId: person.employeeId,
			stored: day,
			startTime: "06:00",
			endTime: "12:00",
		});
		const running = await fixture.shift(org, {
			employeeId: person.employeeId,
			stored: day,
			startTime: "12:00",
			endTime: "18:00",
		});

		const upcoming = await loadUpcomingShifts(db, {
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			organizationTimezone: "Europe/Berlin",
			// 14:00 in Berlin on 2026-10-09.
			now: Temporal.Instant.from("2026-10-09T12:00:00Z"),
			limit: 5,
		});

		expect(upcoming.shifts.map((shift) => shift.id)).toEqual([running]);
	});

	it("returns at most the limit, earliest first", async () => {
		const org = await fixture.organization("UTC");
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		const first = await fixture.shift(org, {
			employeeId: person.employeeId,
			stored: STORED_SHIFT_DATES.UTC.next,
			startTime: "08:00",
		});
		const second = await fixture.shift(org, {
			employeeId: person.employeeId,
			stored: STORED_SHIFT_DATES.UTC.next,
			startTime: "14:00",
		});
		await fixture.shift(org, { employeeId: person.employeeId, stored: "2026-10-11T00:00:00Z" });

		const upcoming = await loadUpcomingShifts(db, {
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			organizationTimezone: "UTC",
			now: Temporal.Instant.from(EARLY_ON_DAY.UTC),
			limit: 2,
		});

		expect(upcoming.shifts.map((shift) => shift.id)).toEqual([first, second]);
	});
});
