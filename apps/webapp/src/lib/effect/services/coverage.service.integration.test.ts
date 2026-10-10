/**
 * PostgreSQL contract (#942): staffing coverage reads `shift.date` as the
 * organization's calendar day. The day snapshot used to compare
 * `DATE(shift.date)`, the UTC date, and coverage gaps keyed shifts by the
 * server's date while keying clock-ins by the organization's.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { CoverageService, CoverageServiceLive } from "./coverage.service";
import { DatabaseServiceLive } from "./database.service";

const layer = CoverageServiceLive.pipe(Layer.provide(DatabaseServiceLive));

const run = <A>(program: (service: CoverageService["Service"]) => Effect.Effect<A, unknown>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* program(yield* CoverageService);
		}).pipe(Effect.provide(layer)),
	);

/** 08:05 on 2026-10-09 in each zone. */
const CLOCK_IN_ON_DAY = {
	"Europe/Berlin": "2026-10-09T06:05:00Z",
	"America/New_York": "2026-10-09T12:05:00Z",
	UTC: "2026-10-09T08:05:00Z",
} as const;

describe("coverage service", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"snapshots only the %s organization's shifts of the requested day",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const [onDay, before, after] = await Promise.all(
				[1, 2, 3].map(() => fixture.seedEmployee({ organizationId: org.organizationId })),
			);
			await fixture.shift(org, {
				employeeId: onDay.employeeId,
				stored: stored.day,
				startTime: "08:00",
				endTime: "10:00",
			});
			await fixture.shift(org, { employeeId: before.employeeId, stored: stored.previous });
			await fixture.shift(org, { employeeId: after.employeeId, stored: stored.next });
			await fixture.liveWork(org, onDay, CLOCK_IN_ON_DAY[timezone]);

			const summary = await run((service) =>
				service.getCoverageForDate({
					organizationId: org.organizationId,
					date: new Date(stored.day),
					timezone,
				}),
			);

			expect(
				summary.snapshots.map((snapshot) => ({
					timeSlot: snapshot.timeSlot,
					employees: snapshot.employees.map((employee) => [employee.id, employee.status]),
				})),
			).toEqual([
				{ timeSlot: "08:00-09:00", employees: [[onDay.employeeId, "clocked_in"]] },
				{ timeSlot: "09:00-10:00", employees: [[onDay.employeeId, "clocked_in"]] },
			]);
		},
	);

	it.each(SHIFT_TEST_TIMEZONES)(
		"reports the %s organization's gaps by its calendar day",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const [present, missing, later] = await Promise.all(
				[1, 2, 3].map(() => fixture.seedEmployee({ organizationId: org.organizationId })),
			);
			await fixture.shift(org, { employeeId: present.employeeId, stored: stored.day });
			await fixture.shift(org, { employeeId: missing.employeeId, stored: stored.previous });
			// The range ends with the day before.
			await fixture.shift(org, { employeeId: later.employeeId, stored: stored.next });
			await fixture.liveWork(org, present, CLOCK_IN_ON_DAY[timezone]);

			const gaps = await run((service) =>
				service.getCoverageGaps({
					organizationId: org.organizationId,
					startDate: new Date(stored.previous),
					endDate: new Date(stored.day),
					timezone,
				}),
			);

			expect(gaps).toEqual([
				expect.objectContaining({
					subareaId: org.subareaId,
					shortage: 1,
					date: new Date(stored.previous),
				}),
			]);
		},
	);

	it("reports no gaps for a range that ends before it starts", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const stored = STORED_SHIFT_DATES["Europe/Berlin"];

		const gaps = await run((service) =>
			service.getCoverageGaps({
				organizationId: org.organizationId,
				startDate: new Date(stored.next),
				endDate: new Date(stored.day),
				timezone: org.timezone,
			}),
		);

		expect(gaps).toEqual([]);
	});
});
