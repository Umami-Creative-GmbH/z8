import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../database.service";
import { TimeRecordService, TimeRecordServiceLive } from "../time-record.service";

const mockState = vi.hoisted(() => {
	const insertReturning = vi.fn();
	const insertValues = vi.fn(() => ({ returning: insertReturning }));
	const insert = vi.fn(() => ({ values: insertValues }));

	const selectLimit = vi.fn();
	const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
	const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
	const selectFrom = vi.fn(() => ({ where: selectWhere }));
	const select = vi.fn(() => ({ from: selectFrom }));

	return {
		insert,
		insertValues,
		insertReturning,
		select,
		selectFrom,
		selectWhere,
		selectOrderBy,
		selectLimit,
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	desc: vi.fn((column: unknown) => ({ type: "desc", column })),
	eq: vi.fn((column: unknown, value: unknown) => ({ type: "eq", column, value })),
	gte: vi.fn((column: unknown, value: unknown) => ({ type: "gte", column, value })),
	lte: vi.fn((column: unknown, value: unknown) => ({ type: "lte", column, value })),
}));

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("@/db/schema", () => ({
	timeRecord: {
		id: "id",
		organizationId: "organizationId",
		employeeId: "employeeId",
		recordKind: "recordKind",
		startAt: "startAt",
		createdAt: "createdAt",
	},
}));

describe("TimeRecordService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("create persists and returns the inserted time record", async () => {
		const createdRecord = {
			id: "rec-1",
			organizationId: "org-1",
			employeeId: "emp-1",
			recordKind: "work",
			startAt: new Date("2026-01-01T08:00:00.000Z"),
			createdAt: new Date("2026-01-01T08:01:00.000Z"),
		};

		mockState.insertReturning.mockResolvedValue([createdRecord]);

		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: {
					insert: mockState.insert,
					select: mockState.select,
				} as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(TimeRecordService);
				return yield* _(
					service.create({
						organizationId: "org-1",
						employeeId: "emp-1",
						recordKind: "work",
						startAt: new Date("2026-01-01T08:00:00.000Z"),
						createdBy: "user-1",
					}),
				);
			}).pipe(Effect.provide(TimeRecordServiceLive), Effect.provide(dbLayer)),
		);

		expect(result).toEqual(createdRecord);
		expect(mockState.insert).toHaveBeenCalledTimes(1);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "emp-1",
				recordKind: "work",
				createdBy: "user-1",
			}),
		);
	});

	it("listByOrganization enforces organization-scoped query", async () => {
		mockState.selectLimit.mockResolvedValue([]);

		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: {
					insert: mockState.insert,
					select: mockState.select,
				} as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);

		await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(TimeRecordService);
				return yield* _(
					service.listByOrganization("org-1", {
						employeeId: "emp-1",
						recordKind: "work",
						startAtFrom: new Date("2026-01-01T00:00:00.000Z"),
						startAtTo: new Date("2026-01-31T23:59:59.999Z"),
						limit: 10,
					}),
				);
			}).pipe(Effect.provide(TimeRecordServiceLive), Effect.provide(dbLayer)),
		);

		expect(mockState.selectWhere).toHaveBeenCalledTimes(1);
		const whereArg = mockState.selectWhere.mock.calls[0]?.[0] as { conditions: Array<{ type: string; column: string; value: string }> };
		expect(whereArg.conditions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "eq", column: "organizationId", value: "org-1" }),
			]),
		);
	});
});
