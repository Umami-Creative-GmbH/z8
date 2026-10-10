/**
 * PostgreSQL contract (#942): hourly workers' requirements come from the
 * published shifts of the requested calendar days, matched by the
 * organization-local `shift.date`. They used to be keyed by the UTC date and
 * read with an inclusive end bound.
 */
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { getPublishedShiftRequirementsForEmployee } from "./work-policy-requirements";

describe("published shift requirements", () => {
	let fixture: ShiftDatabaseFixture;
	let database: DatabaseService["Service"];

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
		database = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* DatabaseService;
			}).pipe(Effect.provide(DatabaseServiceLive)),
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"requires the %s organization's shift hours on its calendar day only",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.shift(org, { employeeId: person.employeeId, stored: stored.previous });
			await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: stored.day,
				startTime: "22:00",
				endTime: "02:00",
			});
			await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: stored.day,
				status: "draft",
			});
			await fixture.shift(org, { employeeId: person.employeeId, stored: stored.next });

			// The way the clocking reminders ask for one day: its start in the requested zone, twice.
			const requirements = await getPublishedShiftRequirementsForEmployee({
				database,
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				startDate: new Date(stored.day),
				endDate: new Date(stored.day),
				timezone,
			});

			expect(requirements).toEqual({
				[SHIFT_DAY]: {
					requiredMinutes: 240,
					policyId: "assigned-shift",
					policyName: "Assigned shift",
				},
			});
		},
	);

	it("never reads another organization's shifts", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const foreign = await fixture.organization("Europe/Berlin");
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		await fixture.shift(foreign, {
			employeeId: person.employeeId,
			stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
		});

		const requirements = await getPublishedShiftRequirementsForEmployee({
			database,
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			startDate: new Date(STORED_SHIFT_DATES["Europe/Berlin"].day),
			endDate: new Date(STORED_SHIFT_DATES["Europe/Berlin"].day),
			timezone: "Europe/Berlin",
		});

		expect(requirements).toEqual({});
	});
});
