/**
 * PostgreSQL contract (#942): the works council schedule review lists the
 * published shifts of the requested calendar days by their organization-local
 * `shift.date`, with wall times resolved in the organization's zone. It used
 * to read both the date and the wall times in UTC.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { buildWorksCouncilPortalModel } from "./review-data";

/** 22:00 on 2026-10-09 to 06:00 the next day, in each zone. */
const NIGHT_SHIFT = {
	"Europe/Berlin": { startsAt: "2026-10-09T20:00:00.000Z", endsAt: "2026-10-10T04:00:00.000Z" },
	"America/New_York": {
		startsAt: "2026-10-10T02:00:00.000Z",
		endsAt: "2026-10-10T10:00:00.000Z",
	},
	UTC: { startsAt: "2026-10-09T22:00:00.000Z", endsAt: "2026-10-10T06:00:00.000Z" },
} as const;

describe("works council schedule review", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"reviews the %s organization's shifts of the requested day at its wall times",
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

			// The portal's `?from=2026-10-09&to=2026-10-09`.
			const model = await buildWorksCouncilPortalModel({
				organizationId: org.organizationId,
				actorUserId: org.creator.userId,
				dateRangeStart: new Date("2026-10-09T00:00:00.000Z"),
				dateRangeEnd: new Date("2026-10-09T23:59:59.999Z"),
				settings: {
					enabled: true,
					identityVisibility: "named",
					absenceVisibility: "hidden",
					exportEnabled: false,
					minimumAggregationThreshold: 1,
					visibleTeamIds: [],
					visibleLocationIds: [],
				},
			});

			expect(model.scheduleReview).toEqual([
				expect.objectContaining({ id: onDay, ...NIGHT_SHIFT[timezone] }),
			]);
		},
	);
});
