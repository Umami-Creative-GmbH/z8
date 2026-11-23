import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	createShiftDatabaseFixture,
	type ShiftDatabaseFixture,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { DatabaseServiceLive } from "./database.service";
import { ShiftService, ShiftServiceLive } from "./shift.service";

const layer = ShiftServiceLive.pipe(Layer.provide(DatabaseServiceLive));
const range = {
	start: new Date("2026-10-08T22:00:00Z"),
	endExclusive: new Date("2026-10-09T22:00:00Z"),
};
/** The publish block's view of `range`: 9 October in Berlin (no minors here, so nothing blocks). */
const statutory = {
	timezone: "Europe/Berlin",
	window: { start: "2026-10-09", endExclusive: "2026-10-10" },
	now: systemClock.nowInstant(),
};

describe("shift publication against PostgreSQL", () => {
	let fixture: ShiftDatabaseFixture;

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	it("publishes matching drafts, preserving other organizations, dates and published records", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const foreign = await fixture.organization("Europe/Berlin");
		const assignee = await fixture.seedEmployee({ organizationId: org.organizationId });
		const stored = STORED_SHIFT_DATES[org.timezone];
		const assignedA = await fixture.shift(org, {
			employeeId: assignee.employeeId,
			stored: stored.day,
			status: "draft",
		});
		const assignedB = await fixture.shift(org, {
			employeeId: assignee.employeeId,
			stored: stored.day,
			status: "draft",
		});
		const open = await fixture.shift(org, {
			employeeId: null,
			stored: stored.day,
			status: "draft",
		});
		const alreadyPublished = await fixture.shift(org, {
			employeeId: null,
			stored: stored.day,
		});
		const previous = await fixture.shift(org, {
			employeeId: null,
			stored: stored.previous,
			status: "draft",
		});
		const exclusiveEnd = await fixture.shift(org, {
			employeeId: null,
			stored: stored.next,
			status: "draft",
		});
		const foreignDraft = await fixture.shift(foreign, {
			employeeId: null,
			stored: stored.day,
			status: "draft",
		});

		const observed = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftService;
				const result = yield* service.publishShifts(
					org.organizationId,
					range,
					org.creator.userId,
					statutory,
				);
				return {
					result,
					own: yield* service.getShifts({ organizationId: org.organizationId }),
					foreign: yield* service.getShifts({ organizationId: foreign.organizationId }),
				};
			}).pipe(Effect.provide(layer)),
		);

		expect(observed.result).toEqual({ count: 3, affectedEmployeeIds: [assignee.employeeId] });
		const own = new Map(observed.own.map((record) => [record.id, record]));
		for (const id of [assignedA, assignedB, open]) {
			expect(own.get(id)).toMatchObject({
				status: "published",
				publishedBy: org.creator.userId,
				publishedAt: expect.any(Date),
			});
		}
		for (const id of [previous, exclusiveEnd]) {
			expect(own.get(id)).toMatchObject({ status: "draft", publishedBy: null, publishedAt: null });
		}
		expect(own.get(alreadyPublished)).toMatchObject({
			status: "published",
			publishedBy: null,
			publishedAt: null,
		});
		expect(observed.foreign).toMatchObject([
			{ id: foreignDraft, status: "draft", publishedBy: null, publishedAt: null },
		]);
	});

	it("publishes a single open draft and leaves its audit unchanged on a repeated call", async () => {
		const org = await fixture.organization("Europe/Berlin");
		const id = await fixture.shift(org, {
			employeeId: null,
			stored: STORED_SHIFT_DATES[org.timezone].day,
			status: "draft",
		});
		const observed = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftService;
				const first = yield* service.publishShifts(
					org.organizationId,
					range,
					org.creator.userId,
					statutory,
				);
				const beforeRepeat = yield* service.getShiftById(id);
				const repeated = yield* service.publishShifts(
					org.organizationId,
					range,
					org.creator.userId,
					statutory,
				);
				const afterRepeat = yield* service.getShiftById(id);
				return { first, repeated, beforeRepeat, afterRepeat };
			}).pipe(Effect.provide(layer)),
		);
		expect(observed.first).toEqual({ count: 1, affectedEmployeeIds: [] });
		expect(observed.beforeRepeat).toMatchObject({
			id,
			status: "published",
			employeeId: null,
			publishedBy: org.creator.userId,
			publishedAt: expect.any(Date),
		});
		expect(observed.repeated).toEqual({ count: 0, affectedEmployeeIds: [] });
		expect(observed.afterRepeat).toEqual(observed.beforeRepeat);
	});

	it("returns no affected employees when the organization has no drafts", async () => {
		const org = await fixture.organization("UTC");
		const observed = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ShiftService;
				const result = yield* service.publishShifts(
					org.organizationId,
					range,
					org.creator.userId,
					statutory,
				);
				return { result, shifts: yield* service.getShifts({ organizationId: org.organizationId }) };
			}).pipe(Effect.provide(layer)),
		);
		expect(observed).toEqual({ result: { count: 0, affectedEmployeeIds: [] }, shifts: [] });
	});
});
