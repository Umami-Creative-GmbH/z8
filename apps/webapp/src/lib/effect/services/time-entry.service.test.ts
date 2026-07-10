import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { timeEntry, timeRecord, workPeriod } from "@/db/schema";
import { ConflictError, DatabaseError, NotFoundError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	type CreateCorrectionInput,
	TimeEntryService,
	TimeEntryServiceLive,
} from "./time-entry.service";

const correctionInput: CreateCorrectionInput = {
	employeeId: "employee-1",
	organizationId: "org-1",
	replacesEntryId: "entry-original",
	timestamp: new Date("2026-07-01T08:15:00.000Z"),
	createdBy: "user-1",
	notes: "Corrected entry",
	utcOffsetMinutes: 120,
	timezone: "Europe/Berlin",
	timezoneSource: "manager_target_user_setting",
};

function createCorrectionHarness(casWins: boolean) {
	const originalEntry = {
		id: "entry-original",
		employeeId: "employee-1",
		organizationId: "org-1",
		isSuperseded: false,
	};
	const previousEntry = { id: "entry-previous", hash: "previous-hash" };
	const createdCorrection = {
		id: "entry-correction",
		employeeId: "employee-1",
		organizationId: "org-1",
		isSuperseded: false,
	};
	const durableCorrections: (typeof createdCorrection)[] = [];
	let stagedCorrections: (typeof createdCorrection)[] = [];
	let selectCount = 0;

	const select = vi.fn(() => {
		selectCount += 1;
		const rows = selectCount === 1 ? [originalEntry] : [previousEntry];
		const limit = vi.fn().mockResolvedValue(rows);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ limit, orderBy }));
		return { from: vi.fn(() => ({ where })) };
	});

	const outerInsertReturning = vi.fn(async () => {
		durableCorrections.push(createdCorrection);
		return [createdCorrection];
	});
	const outerInsert = vi.fn(() => ({
		values: vi.fn(() => ({ returning: outerInsertReturning })),
	}));
	const outerUpdate = vi.fn(() => ({
		set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
	}));

	const transactionInsertReturning = vi.fn(async () => {
		stagedCorrections.push(createdCorrection);
		return [createdCorrection];
	});
	const transactionInsert = vi.fn(() => ({
		values: vi.fn(() => ({ returning: transactionInsertReturning })),
	}));
	const transactionUpdateReturning = vi
		.fn()
		.mockResolvedValue(casWins ? [{ id: originalEntry.id }] : []);
	const transactionUpdate = vi.fn(() => ({
		set: vi.fn(() => ({
			where: vi.fn(() => ({ returning: transactionUpdateReturning })),
		})),
	}));
	const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
		stagedCorrections = [];
		try {
			const result = await callback({
				insert: transactionInsert,
				update: transactionUpdate,
			});
			durableCorrections.push(...stagedCorrections);
			return result;
		} catch (error) {
			stagedCorrections = [];
			throw error;
		}
	});

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: {
				query: {
					employee: { findFirst: vi.fn().mockResolvedValue(originalEntry) },
				},
				select,
				insert: outerInsert,
				update: outerUpdate,
				transaction,
			} as never,
			query: (name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (cause) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause,
						}),
				}),
		}),
	);

	const correctionEffect = (input: CreateCorrectionInput) =>
		Effect.gen(function* (_) {
			const service = yield* _(TimeEntryService);
			return yield* _(service.createCorrectionEntry(input));
		}).pipe(Effect.provide(TimeEntryServiceLive), Effect.provide(dbLayer));
	const runCorrection = (input: CreateCorrectionInput = correctionInput) =>
		Effect.runPromise(correctionEffect(input));
	const runCorrectionExit = (input: CreateCorrectionInput = correctionInput) =>
		Effect.runPromiseExit(correctionEffect(input));

	return {
		createdCorrection,
		durableCorrections,
		outerInsert,
		outerUpdate,
		runCorrection,
		runCorrectionExit,
		transaction,
		transactionInsert,
		transactionUpdate,
		transactionUpdateReturning,
	};
}

type DirectCorrectionEndpoint = "clockIn" | "clockOut";

function createDirectCorrectionHarness(
	endpoint: DirectCorrectionEndpoint,
	options: { periodAvailableAfterCas?: boolean } = {},
) {
	const periodAvailableAfterCas = options.periodAvailableAfterCas ?? true;
	const originalEntryId = endpoint === "clockIn" ? "entry-clock-in" : "entry-clock-out";
	const correctionTimestamp =
		endpoint === "clockIn"
			? new Date("2026-07-01T08:15:00.000Z")
			: new Date("2026-07-01T17:30:00.000Z");
	const initialState = {
		original: {
			id: originalEntryId,
			employeeId: "employee-1",
			organizationId: "org-1",
			isSuperseded: false,
			supersededById: null as string | null,
		},
		corrections: [] as Array<{ id: string; timestamp: Date }>,
		period: {
			id: "period-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			clockInId: "entry-clock-in",
			clockOutId: "entry-clock-out",
			startTime: new Date("2026-07-01T08:00:00.000Z"),
			endTime: new Date("2026-07-01T17:00:00.000Z"),
			durationMinutes: 540,
			isActive: false,
			deletedAt: null,
			canonicalRecordId: "record-1",
		},
		canonicalRecord: {
			id: "record-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			recordKind: "work",
			startAt: new Date("2026-07-01T08:00:00.000Z"),
			endAt: new Date("2026-07-01T17:00:00.000Z"),
			durationMinutes: 540,
			updatedBy: null as string | null,
		},
	};
	let state = structuredClone(initialState);
	let outerSelectCount = 0;

	const outerSelect = vi.fn(() => {
		outerSelectCount += 1;
		const rows =
			outerSelectCount === 1 ? [state.original] : [{ id: "entry-previous", hash: "previous-hash" }];
		const limit = vi.fn().mockResolvedValue(rows);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ limit, orderBy }));
		return { from: vi.fn(() => ({ where })) };
	});

	const lockPeriod = vi.fn();
	const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
		const staged = structuredClone(state);
		const tx = {
			insert: vi.fn((table) => {
				expect(table).toBe(timeEntry);
				return {
					values: vi.fn((values: { timestamp: Date }) => ({
						returning: vi.fn(async () => {
							const correction = { id: "entry-correction", timestamp: values.timestamp };
							staged.corrections.push(correction);
							return [correction];
						}),
					})),
				};
			}),
			select: vi.fn(() => ({
				from: vi.fn((table) => {
					expect(table).toBe(workPeriod);
					return {
						where: vi.fn(() => ({
							for: lockPeriod.mockResolvedValue(periodAvailableAfterCas ? [staged.period] : []),
						})),
					};
				}),
			})),
			update: vi.fn((table) => ({
				set: vi.fn((values: Record<string, unknown>) => ({
					where: vi.fn(() => {
						if (table === timeEntry) {
							return {
								returning: vi.fn(async () => {
									if (staged.original.isSuperseded) return [];
									Object.assign(staged.original, values);
									return [{ id: staged.original.id }];
								}),
							};
						}
						if (table === workPeriod) {
							return {
								returning: vi.fn(async () => {
									Object.assign(staged.period, values);
									return [{ id: staged.period.id }];
								}),
							};
						}
						if (table === timeRecord) {
							Object.assign(staged.canonicalRecord, values);
							return Promise.resolve();
						}
						throw new Error("Unexpected update table");
					}),
				})),
			})),
		};

		const result = await callback(tx);
		state = staged;
		return result;
	});

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: {
				query: { employee: { findFirst: vi.fn().mockResolvedValue({ id: "employee-1" }) } },
				select: outerSelect,
				transaction,
			} as never,
			query: (name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (cause) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause,
						}),
				}),
		}),
	);
	const input: CreateCorrectionInput = {
		...correctionInput,
		replacesEntryId: originalEntryId,
		timestamp: correctionTimestamp,
		workPeriodId: "period-1",
	};
	const effect = Effect.gen(function* (_) {
		const service = yield* _(TimeEntryService);
		return yield* _(service.createCorrectionEntry(input));
	}).pipe(Effect.provide(TimeEntryServiceLive), Effect.provide(dbLayer));

	return {
		getState: () => state,
		initialState,
		lockPeriod,
		run: () => Effect.runPromise(effect),
		runExit: () => Effect.runPromiseExit(effect),
		transaction,
	};
}

describe("TimeEntryService correction safety", () => {
	it("atomically inserts an immediate correction and supersedes its active original", async () => {
		const harness = createCorrectionHarness(true);

		await expect(harness.runCorrection()).resolves.toEqual(harness.createdCorrection);

		expect(harness.transaction).toHaveBeenCalledOnce();
		expect(harness.transactionInsert).toHaveBeenCalledOnce();
		expect(harness.transactionUpdate).toHaveBeenCalledOnce();
		expect(harness.transactionUpdateReturning).toHaveBeenCalledOnce();
		expect(harness.durableCorrections).toEqual([harness.createdCorrection]);
		expect(harness.outerInsert).not.toHaveBeenCalled();
		expect(harness.outerUpdate).not.toHaveBeenCalled();
	});

	it("rolls back the inserted correction when compare-and-set superseding loses", async () => {
		const harness = createCorrectionHarness(false);
		const exit = await harness.runCorrectionExit();

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
		const error = Option.getOrThrow(Cause.failureOption(exit.cause));
		expect(error).toBeInstanceOf(ConflictError);
		expect(error).toMatchObject({
			message: "Time entry was already corrected by another process",
			conflictType: "time_entry_already_corrected",
		});

		expect(harness.transaction).toHaveBeenCalledOnce();
		expect(harness.transactionInsert).toHaveBeenCalledOnce();
		expect(harness.transactionUpdateReturning).toHaveBeenCalledOnce();
		expect(harness.durableCorrections).toEqual([]);
		expect(harness.outerInsert).not.toHaveBeenCalled();
		expect(harness.outerUpdate).not.toHaveBeenCalled();
	});

	it("atomically inserts an inactive pending correction without superseding the original", async () => {
		const harness = createCorrectionHarness(true);

		await expect(
			harness.runCorrection({ ...correctionInput, isSuperseded: true }),
		).resolves.toEqual(harness.createdCorrection);

		expect(harness.transaction).toHaveBeenCalledOnce();
		expect(harness.transactionInsert).toHaveBeenCalledOnce();
		expect(harness.transactionUpdate).not.toHaveBeenCalled();
		expect(harness.durableCorrections).toEqual([harness.createdCorrection]);
		expect(harness.outerInsert).not.toHaveBeenCalled();
	});

	it.each([
		[
			"clock-in",
			"clockIn" as const,
			{
				clockInId: "entry-correction",
				clockOutId: "entry-clock-out",
				startTime: new Date("2026-07-01T08:15:00.000Z"),
				endTime: new Date("2026-07-01T17:00:00.000Z"),
				durationMinutes: 525,
			},
		],
		[
			"clock-out",
			"clockOut" as const,
			{
				clockInId: "entry-clock-in",
				clockOutId: "entry-correction",
				startTime: new Date("2026-07-01T08:00:00.000Z"),
				endTime: new Date("2026-07-01T17:30:00.000Z"),
				durationMinutes: 570,
			},
		],
	])("atomically applies a direct %s correction to the original, period, and canonical record", async (_label, endpoint, expected) => {
		const harness = createDirectCorrectionHarness(endpoint);

		await harness.run();

		const state = harness.getState();
		expect(harness.transaction).toHaveBeenCalledOnce();
		expect(harness.lockPeriod).toHaveBeenCalledWith("update");
		expect(state.original).toMatchObject({
			isSuperseded: true,
			supersededById: "entry-correction",
		});
		expect(state.period).toMatchObject({ ...expected, isActive: false });
		expect(state.canonicalRecord).toMatchObject({
			startAt: expected.startTime,
			endAt: expected.endTime,
			durationMinutes: expected.durationMinutes,
			updatedBy: "user-1",
		});
		expect(state.corrections).toEqual([
			{
				id: "entry-correction",
				timestamp: expected[endpoint === "clockIn" ? "startTime" : "endTime"],
			},
		]);
	});

	it("rolls back every direct correction write when the period is stale after the original CAS", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			periodAvailableAfterCas: false,
		});
		const exit = await harness.runExit();

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
		const error = Option.getOrThrow(Cause.failureOption(exit.cause));
		expect(error).toBeInstanceOf(NotFoundError);
		expect(error).toMatchObject({
			message: "Work period not found",
			entityId: "period-1",
		});
		expect(harness.getState()).toEqual(harness.initialState);
	});
});
