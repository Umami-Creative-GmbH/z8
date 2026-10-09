/**
 * PostgreSQL contract (#942): the workday timeline shows the shift whose
 * organization-local `shift.date` is the selected day, at the organization's
 * wall times. It used to match `shift.date` against UTC midnight, which found
 * no shift for any organization outside UTC.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";

vi.mock("@/lib/self-service-requests/get-self-service-requests", () => ({
	getSelfServiceRequests: async () => ({
		items: [],
		counts: { pending: 0, requiredFixes: 0, recentDecisions: 0, total: 0 },
		sourceErrors: [],
	}),
}));

const { getWorkdayTimelineData } = await import("./workday-timeline-data");

/** 22:00 on 2026-10-09 to 06:00 the next day, in each zone. */
const NIGHT_SHIFT = {
	"Europe/Berlin": { startTime: "2026-10-09T20:00:00.000Z", endTime: "2026-10-10T04:00:00.000Z" },
	"America/New_York": {
		startTime: "2026-10-10T02:00:00.000Z",
		endTime: "2026-10-10T10:00:00.000Z",
	},
	UTC: { startTime: "2026-10-09T22:00:00.000Z", endTime: "2026-10-10T06:00:00.000Z" },
} as const;

describe("workday timeline shifts", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"shows the %s organization's shift of the selected day",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.shift(org, { employeeId: person.employeeId, stored: stored.previous });
			const onDay = await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: stored.day,
				startTime: "22:00",
				endTime: "06:00",
			});
			await fixture.shift(org, { employeeId: person.employeeId, stored: stored.next });

			const result = await getWorkdayTimelineData({
				employeeId: person.employeeId,
				organizationId: org.organizationId,
				timezone,
				dateParam: SHIFT_DAY,
			});

			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.data.items.filter((item) => item.type === "shift")).toEqual([
				expect.objectContaining({
					id: `shift:${onDay}`,
					startTime: new Date(NIGHT_SHIFT[timezone].startTime),
					endTime: new Date(NIGHT_SHIFT[timezone].endTime),
				}),
			]);
		},
	);
});
