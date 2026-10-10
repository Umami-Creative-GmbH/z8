/**
 * PostgreSQL contract (#942): open-shift counts read `shift.date` as the
 * organization's calendar day. They used to compare `DATE(shift.date)`, the
 * UTC date, with the organization's today and tomorrow.
 */
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createShiftDatabaseFixture,
	SHIFT_TEST_TIMEZONES,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { DatabaseServiceLive } from "./database.service";
import { OpenShiftsService, OpenShiftsServiceLive } from "./open-shifts.service";

const layer = OpenShiftsServiceLive.pipe(Layer.provide(DatabaseServiceLive));

/** Noon on 2026-10-09 in each zone, so "today" is 2026-10-09 and "tomorrow" 2026-10-10. */
const NOON = {
	"Europe/Berlin": "2026-10-09T10:00:00Z",
	"America/New_York": "2026-10-09T16:00:00Z",
	UTC: "2026-10-09T12:00:00Z",
} as const;

describe("open shifts counts", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	it.each(SHIFT_TEST_TIMEZONES)(
		"counts the %s organization's open shifts of its today and tomorrow",
		async (timezone) => {
			const org = await fixture.organization(timezone);
			const stored = STORED_SHIFT_DATES[timezone];
			const assigned = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.shift(org, { employeeId: null, stored: stored.previous });
			await fixture.shift(org, { employeeId: null, stored: stored.day });
			await fixture.shift(org, { employeeId: null, stored: stored.day });
			await fixture.shift(org, { employeeId: null, stored: stored.day, status: "draft" });
			await fixture.shift(org, { employeeId: assigned.employeeId, stored: stored.day });
			await fixture.shift(org, { employeeId: null, stored: stored.next });

			const counts = await Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* OpenShiftsService;
					return yield* service.getOpenShiftsCounts({
						organizationId: org.organizationId,
						timezone,
						now: Temporal.Instant.from(NOON[timezone]),
					});
				}).pipe(Effect.provide(layer)),
			);

			expect(counts).toEqual({ today: 2, tomorrow: 1 });
		},
	);
});
