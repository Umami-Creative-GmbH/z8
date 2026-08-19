import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import {
	employee,
	employeeManagers,
	teamMembership,
	timeEntry,
	timeRecord,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "../errors";
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
	workPeriodId: "period-1",
};

function createCorrectionHarness(casWins: boolean) {
	const originalEntry = {
		id: "entry-original",
		employeeId: "employee-1",
		organizationId: "org-1",
		isSuperseded: false,
	};
	const previousEntry = { id: "entry-previous", hash: "previous-hash" };
	const period = {
		id: "period-1",
		employeeId: "employee-1",
		organizationId: "org-1",
		clockInId: "entry-original",
		clockOutId: "entry-clock-out",
		startTime: new Date("2026-07-01T08:00:00.000Z"),
		endTime: new Date("2026-07-01T17:00:00.000Z"),
		canonicalRecordId: null,
	};
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
	const transactionSelect = vi.fn(() => ({
		from: vi.fn((table) => ({
			where: vi.fn(() => {
				const rows =
					table === workPeriod
						? [period]
						: table === member
							? [{ id: "member-1" }]
							: table === employee
								? [
										{
											id: "employee-1",
											userId: "user-1",
											organizationId: "org-1",
											isActive: true,
											role: "employee",
										},
									]
								: table === employeeManagers
									? [{ id: "manager-assignment-1" }]
									: [originalEntry];
				return {
					for: vi.fn().mockResolvedValue(rows),
					orderBy: vi.fn(() => ({
						for: vi.fn().mockResolvedValue(rows),
						limit: vi.fn().mockResolvedValue([previousEntry]),
					})),
				};
			}),
		})),
	}));
	const transactionClient = {
		insert: transactionInsert,
		query: {
			employee: { findFirst: vi.fn().mockResolvedValue(originalEntry) },
			approvalRequest: { findFirst: vi.fn().mockResolvedValue(null) },
			approvalWorkflow: { findFirst: vi.fn().mockResolvedValue(null) },
		},
		select: transactionSelect,
		update: transactionUpdate,
	};
	const transaction = vi.fn(
		async (callback: (tx: unknown) => Promise<unknown>) => {
			stagedCorrections = [];
			try {
				const result = await callback(transactionClient);
				durableCorrections.push(...stagedCorrections);
				return result;
			} catch (error) {
				stagedCorrections = [];
				throw error;
			}
		},
	);

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
		transactionClient,
		transactionInsert,
		transactionUpdate,
		transactionUpdateReturning,
	};
}

type DirectCorrectionEndpoint = "clockIn" | "clockOut";

function createDirectCorrectionHarness(
	endpoint: DirectCorrectionEndpoint,
	options: {
		actorActive?: boolean;
		actorEmployeeId?: string;
		actorRole?: "admin" | "employee" | "manager";
		managerAssigned?: boolean;
		membershipApproved?: boolean;
		honorRowLocks?: boolean;
		periodAvailableAfterCas?: boolean;
		pendingCanonical?: boolean;
		pendingLegacy?: boolean;
		restMetadata?: {
			workLocationType: "home" | "office";
			workCategoryId: string | null;
		};
		canonicalWorkDiverged?: boolean;
		canonicalMetadataUpdateFails?: boolean;
		currentWorkCategoryId?: string | null;
		correctionTimestamp?: Date;
		validationResult?: {
			isValid: boolean;
			error?: string;
			holidayName?: string;
		};
		targetEmployeeId?: string;
		targetEmployeeRows?: Array<{
			id: string;
			organizationId: string;
			isActive: boolean;
			role?: "admin" | "employee" | "manager";
			userId?: string;
		}>;
	} = {},
) {
	const periodAvailableAfterCas = options.periodAvailableAfterCas ?? true;
	const actorActive = options.actorActive ?? true;
	const actorEmployeeId = options.actorEmployeeId ?? "employee-1";
	const targetEmployeeId = options.targetEmployeeId ?? "employee-1";
	const actorRole = options.actorRole ?? "employee";
	const managerAssigned = options.managerAssigned ?? true;
	const membershipApproved = options.membershipApproved ?? true;
	const targetEmployeeRows =
		options.targetEmployeeRows ??
		[
			{
				id: targetEmployeeId,
				organizationId: "org-1",
				isActive: actorEmployeeId === targetEmployeeId ? actorActive : true,
				role: actorEmployeeId === targetEmployeeId ? actorRole : "employee",
				userId: actorEmployeeId === targetEmployeeId ? "user-1" : "target-user",
			},
			...(actorEmployeeId === targetEmployeeId
				? []
				: [
						{
							id: actorEmployeeId,
							organizationId: "org-1",
							isActive: actorActive,
							role: actorRole,
							userId: "user-1",
						},
					]),
		].sort((left, right) => left.id.localeCompare(right.id));
	const honorRowLocks = options.honorRowLocks ?? true;
	const originalEntryId =
		endpoint === "clockIn" ? "entry-clock-in" : "entry-clock-out";
	const correctionTimestamp =
		options.correctionTimestamp ??
		(endpoint === "clockIn"
			? new Date("2026-07-01T08:15:00.000Z")
			: new Date("2026-07-01T17:30:00.000Z"));
	const initialState = {
		original: {
			id: originalEntryId,
			employeeId: targetEmployeeId,
			organizationId: "org-1",
			isSuperseded: false,
			supersededById: null as string | null,
		},
		corrections: [] as Array<{ id: string; timestamp: Date }>,
		period: {
			id: "period-1",
			employeeId: targetEmployeeId,
			organizationId: "org-1",
			clockInId: "entry-clock-in",
			clockOutId: "entry-clock-out",
			startTime: new Date("2026-07-01T08:00:00.000Z"),
			endTime: new Date("2026-07-01T17:00:00.000Z"),
			durationMinutes: 540,
			isActive: false,
			deletedAt: null,
			canonicalRecordId: "record-1",
			workLocationType: "office",
			workCategoryId: options.currentWorkCategoryId ?? null,
		},
		canonicalRecord: {
			id: "record-1",
			organizationId: "org-1",
			employeeId: targetEmployeeId,
			recordKind: "work",
			startAt: new Date("2026-07-01T08:00:00.000Z"),
			endAt: new Date("2026-07-01T17:00:00.000Z"),
			durationMinutes: 540,
			updatedBy: null as string | null,
		},
		canonicalWork: {
			recordId: "record-1",
			organizationId: "org-1",
			recordKind: "work",
			workLocationType: options.canonicalWorkDiverged ? "home" : "office",
			workCategoryId: options.currentWorkCategoryId ?? null,
		},
		pendingLegacy: options.pendingLegacy ?? false,
		pendingCanonical: options.pendingCanonical ?? false,
	};
	let state = structuredClone(initialState);
	let outerSelectCount = 0;

	const outerSelect = vi.fn(() => {
		outerSelectCount += 1;
		const rows =
			outerSelectCount === 1
				? [state.original]
				: [{ id: "entry-previous", hash: "previous-hash" }];
		const limit = vi.fn().mockResolvedValue(rows);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ limit, orderBy }));
		return { from: vi.fn(() => ({ where })) };
	});

	const lockPeriod = vi.fn();
	const lockTargetEmployee = vi.fn();
	const lockMembership = vi.fn();
	const lockActor = vi.fn();
	const lockManagerAssignment = vi.fn();
	const lockOriginal = vi.fn();
	const transactionInsert = vi.fn();
	const workPeriodSetCalls: Array<Record<string, unknown>> = [];
	const observedLocks: string[] = [];
	const employeeLockBatches: string[][] = [];
	const rowLockTails = new Map<string, Promise<void>>();

	const acquireRowLock = async (key: string) => {
		const previous = rowLockTails.get(key) ?? Promise.resolve();
		let release = () => {};
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		rowLockTails.set(key, current);
		await previous;
		observedLocks.push(key);
		return () => {
			release();
			if (rowLockTails.get(key) === current) rowLockTails.delete(key);
		};
	};

	const transaction = vi.fn(
		async (callback: (tx: unknown) => Promise<unknown>) => {
			let staged = structuredClone(state);
			let employeeLockCount = 0;
			const releases: Array<() => void> = [];
			const heldKeys = new Set<string>();
			const lock = async (key: string) => {
				if (!honorRowLocks) return;
				if (heldKeys.has(key)) return;
				const release = await acquireRowLock(key);
				heldKeys.add(key);
				releases.push(release);
				if (releases.length === 1) staged = structuredClone(state);
			};
			const lockedRows = async (table: unknown, mode: string) => {
				if (table === employee) {
					employeeLockCount += 1;
					const ids = targetEmployeeRows.map((row) => row.id);
					employeeLockBatches.push(ids);
					if (employeeLockCount === 1) lockTargetEmployee(mode);
					else lockActor(mode);
					for (const id of ids) await lock(`employee:org-1:${id}`);
					return targetEmployeeRows;
				}
				if (table === workPeriod) {
					lockPeriod(mode);
					await lock("work-period:org-1:period-1");
					return periodAvailableAfterCas ? [staged.period] : [];
				}
				if (table === member) {
					lockMembership(mode);
					await lock("member:org-1:user-1");
					return membershipApproved ? [{ id: "member-1" }] : [];
				}
				if (table === employeeManagers) {
					lockManagerAssignment(mode);
					await lock(`manager:${targetEmployeeId}:${actorEmployeeId}`);
					return managerAssigned ? [{ id: "manager-assignment-1" }] : [];
				}
				if (table === teamMembership) return [];
				if (table === timeRecord) return [staged.canonicalRecord];
				if (table === timeRecordWork) return [staged.canonicalWork];
				expect(table).toBe(timeEntry);
				lockOriginal(mode);
				await lock(`time-entry:org-1:${staged.original.id}`);
				return [staged.original];
			};
			const tx = {
				insert: (table: unknown) => {
					transactionInsert(table);
					expect(table).toBe(timeEntry);
					return {
						values: vi.fn((values: { timestamp: Date }) => ({
							returning: vi.fn(async () => {
								const correction = {
									id: "entry-correction",
									timestamp: values.timestamp,
								};
								staged.corrections.push(correction);
								return [correction];
							}),
						})),
					};
				},
				query: {
					approvalRequest: {
						findFirst: vi.fn(async () =>
							staged.pendingLegacy ? { id: "legacy" } : null,
						),
					},
					approvalWorkflow: {
						findFirst: vi.fn(async () =>
							staged.pendingCanonical ? { id: "canonical" } : null,
						),
					},
				},
				setPendingLegacy: () => {
					staged.pendingLegacy = true;
				},
				select: vi.fn(() => ({
					from: vi.fn((table) => ({
						where: vi.fn(() => {
							return {
								for: (mode: string) => lockedRows(table, mode),
								orderBy: vi.fn(() => ({
									for: (mode: string) => lockedRows(table, mode),
									limit: vi
										.fn()
										.mockResolvedValue([
											{ id: "entry-previous", hash: "previous-hash" },
										]),
								})),
							};
						}),
					})),
				})),
				update: vi.fn((table) => ({
					set: vi.fn((values: Record<string, unknown>) => {
						if (table === workPeriod) workPeriodSetCalls.push(values);
						return {
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
									return {
										returning: vi.fn(async () => {
											return [{ id: staged.canonicalRecord.id }];
										}),
									};
								}
								if (table === timeRecordWork) {
									return {
										returning: vi.fn(async () => {
											if (options.canonicalMetadataUpdateFails) return [];
											Object.assign(staged.canonicalWork, values);
											return [{ recordId: staged.canonicalWork.recordId }];
										}),
									};
								}
								throw new Error("Unexpected update table");
							}),
						};
					}),
				})),
			};

			try {
				const result = await callback(tx);
				state = staged;
				return result;
			} finally {
				for (const release of releases.reverse()) release();
			}
		},
	);

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: {
				query: {
					employee: {
						findFirst: vi.fn().mockResolvedValue({ id: "employee-1" }),
					},
				},
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
	const validationResult = options.validationResult;
	const input: CreateCorrectionInput = {
		...correctionInput,
		employeeId: targetEmployeeId,
		replacesEntryId: originalEntryId,
		timestamp: correctionTimestamp,
		workPeriodId: "period-1",
		...(options.restMetadata
			? {
					...options.restMetadata,
					expectedClockInId: initialState.period.clockInId,
					expectedClockOutId: initialState.period.clockOutId,
					expectedStartTime: initialState.period.startTime,
					expectedEndTime: initialState.period.endTime,
					expectedWorkLocationType: initialState.period.workLocationType,
					expectedWorkCategoryId: initialState.period.workCategoryId,
					...(validationResult
						? { validateTimeRange: async () => validationResult }
						: {}),
				}
			: {}),
	};
	const effect = Effect.gen(function* (_) {
		const service = yield* _(TimeEntryService);
		return yield* _(service.createCorrectionEntry(input));
	}).pipe(Effect.provide(TimeEntryServiceLive), Effect.provide(dbLayer));
	let releaseApproval = () => {};
	const approvalMayCommit = new Promise<void>((resolve) => {
		releaseApproval = resolve;
	});
	let signalApprovalLocked = () => {};
	const approvalLocked = new Promise<void>((resolve) => {
		signalApprovalLocked = resolve;
	});
	const runApproval = () =>
		transaction(async (txValue) => {
			const tx = txValue as {
				select: typeof transaction;
				setPendingLegacy: () => void;
			};
			const lockingTx = tx as never as {
				select: () => {
					from: (table: unknown) => {
						where: () => { for: (mode: string) => Promise<unknown[]> };
					};
				};
			};
			await lockingTx.select().from(employee).where().for("update");
			await lockingTx.select().from(workPeriod).where().for("update");
			signalApprovalLocked();
			await approvalMayCommit;
			tx.setPendingLegacy();
			return { approvalId: "approval-1" };
		});

	return {
		getState: () => state,
		initialState,
		approvalLocked,
		lockPeriod,
		lockTargetEmployee,
		observedLocks,
		lockMembership,
		lockActor,
		lockManagerAssignment,
		employeeLockBatches,
		run: () => Effect.runPromise(effect),
		runApproval,
		runExit: () => Effect.runPromiseExit(effect),
		releaseApproval: () => releaseApproval(),
		transaction,
		transactionInsert,
		workPeriodSetCalls,
	};
}

describe("TimeEntryService correction safety", () => {
	it("atomically inserts an immediate correction and supersedes its active original", async () => {
		const harness = createCorrectionHarness(true);

		await expect(harness.runCorrection()).resolves.toEqual(
			harness.createdCorrection,
		);

		expect(harness.transaction).toHaveBeenCalledOnce();
		expect(harness.transactionInsert).toHaveBeenCalledOnce();
		expect(harness.transactionUpdate).toHaveBeenCalledTimes(2);
		expect(harness.transactionUpdateReturning).toHaveBeenCalledTimes(2);
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

	it("uses a caller transaction without opening a nested transaction", async () => {
		const harness = createCorrectionHarness(true);

		await expect(
			harness.runCorrection({
				...correctionInput,
				transaction: harness.transactionClient as never,
			}),
		).resolves.toEqual(harness.createdCorrection);

		expect(harness.transaction).not.toHaveBeenCalled();
		expect(harness.transactionInsert).toHaveBeenCalledOnce();
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
	])(
		"atomically applies a direct %s correction to the original, period, and canonical record",
		async (_label, endpoint, expected) => {
			const harness = createDirectCorrectionHarness(endpoint);

			await harness.run();

			const state = harness.getState();
			expect(harness.transaction).toHaveBeenCalledOnce();
			expect(harness.lockPeriod).toHaveBeenCalledWith("update");
			expect(harness.lockPeriod.mock.invocationCallOrder[0]).toBeLessThan(
				harness.transactionInsert.mock.invocationCallOrder[0] ?? 0,
			);
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
			expect(harness.workPeriodSetCalls).toHaveLength(1);
			expect(Object.keys(harness.workPeriodSetCalls[0] ?? {}).sort()).toEqual(
				(endpoint === "clockIn"
					? ["clockInId", "durationMinutes", "startTime", "updatedAt"]
					: ["clockOutId", "durationMinutes", "endTime", "updatedAt"]
				).sort(),
			);
		},
	);

	it("atomically applies a REST metadata-only correction to legacy and canonical work rows", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			correctionTimestamp: new Date("2026-07-01T08:00:00.000Z"),
			restMetadata: { workLocationType: "home", workCategoryId: null },
		});

		await expect(harness.run()).resolves.toBeNull();

		expect(harness.transactionInsert).not.toHaveBeenCalled();
		expect(Object.keys(harness.workPeriodSetCalls[0] ?? {}).sort()).toEqual(
			[
				"durationMinutes",
				"updatedAt",
				"workCategoryId",
				"workLocationType",
			].sort(),
		);
		expect(harness.getState()).toMatchObject({
			period: { workLocationType: "home", workCategoryId: null },
			canonicalWork: { workLocationType: "home", workCategoryId: null },
			original: { isSuperseded: false, supersededById: null },
		});
	});

	it("atomically applies mixed REST endpoint and metadata changes", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			restMetadata: { workLocationType: "home", workCategoryId: null },
		});

		await harness.run();
		expect(Object.keys(harness.workPeriodSetCalls[0] ?? {}).sort()).toEqual(
			[
				"clockInId",
				"durationMinutes",
				"startTime",
				"updatedAt",
				"workCategoryId",
				"workLocationType",
			].sort(),
		);

		expect(harness.getState()).toMatchObject({
			period: {
				startTime: new Date("2026-07-01T08:15:00.000Z"),
				workLocationType: "home",
				workCategoryId: null,
			},
			canonicalRecord: {
				startAt: new Date("2026-07-01T08:15:00.000Z"),
			},
			canonicalWork: { workLocationType: "home", workCategoryId: null },
		});
	});

	it("allows REST category removal without requiring current category access", async () => {
		const categoryId = "31000000-0000-4000-8000-000000000910";
		const harness = createDirectCorrectionHarness("clockIn", {
			correctionTimestamp: new Date("2026-07-01T08:00:00.000Z"),
			currentWorkCategoryId: categoryId,
			restMetadata: { workLocationType: "office", workCategoryId: null },
		});

		await harness.run();

		expect(harness.getState()).toMatchObject({
			period: { workCategoryId: null },
			canonicalWork: { workCategoryId: null },
		});
	});

	it("rejects an unchanged REST correction", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			correctionTimestamp: new Date("2026-07-01T08:00:00.000Z"),
			restMetadata: { workLocationType: "office", workCategoryId: null },
		});
		const exit = await harness.runExit();

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
		expect(Option.getOrThrow(Cause.failureOption(exit.cause))).toBeInstanceOf(
			ValidationError,
		);
		expect(harness.getState()).toEqual(harness.initialState);
	});

	it("rolls back REST endpoint and metadata writes when canonical metadata update fails", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			canonicalMetadataUpdateFails: true,
			restMetadata: { workLocationType: "home", workCategoryId: null },
		});

		const exit = await harness.runExit();

		expect(Exit.isFailure(exit)).toBe(true);
		expect(harness.getState()).toEqual(harness.initialState);
	});

	it("rolls back REST endpoint and metadata writes when range validation fails", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			restMetadata: { workLocationType: "home", workCategoryId: null },
			validationResult: {
				isValid: false,
				error: "errors.holiday.blocksTimeEntry",
				holidayName: "Founders Day",
			},
		});

		const exit = await harness.runExit();

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
		expect(Option.getOrThrow(Cause.failureOption(exit.cause))).toMatchObject({
			message: "errors.holiday.blocksTimeEntry",
			value: "Founders Day",
		});
		expect(harness.getState()).toEqual(harness.initialState);
	});

	it("rejects REST writes when canonical work metadata diverges", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			canonicalWorkDiverged: true,
			restMetadata: { workLocationType: "home", workCategoryId: null },
		});
		const exit = await harness.runExit();

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
		expect(Option.getOrThrow(Cause.failureOption(exit.cause))).toMatchObject({
			conflictType: "time_correction_work_metadata_diverged",
		});
		expect(harness.getState()).toEqual(harness.initialState);
	});

	it("rejects a direct correction when organization membership is revoked before the period lock", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			membershipApproved: false,
		});
		const exit = await harness.runExit();

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
		const error = Option.getOrThrow(Cause.failureOption(exit.cause));
		expect(error).toBeInstanceOf(AuthorizationError);
		expect(harness.lockTargetEmployee.mock.invocationCallOrder[0]).toBeLessThan(
			harness.lockMembership.mock.invocationCallOrder[0] ?? 0,
		);
		expect(harness.lockPeriod).not.toHaveBeenCalled();
		expect(harness.transactionInsert).not.toHaveBeenCalled();
		expect(harness.getState()).toEqual(harness.initialState);
	});

	it.each([
		["missing", []],
		[
			"inactive",
			[
				{
					id: "employee-1",
					organizationId: "org-1",
					isActive: false,
					role: "employee" as const,
					userId: "user-1",
				},
			],
		],
		[
			"duplicate",
			[
				{ id: "employee-1", organizationId: "org-1", isActive: true },
				{ id: "employee-1", organizationId: "org-1", isActive: true },
			],
		],
	] as const)(
		"fails closed when the locked target employee is %s",
		async (_label, targetEmployeeRows) => {
			const harness = createDirectCorrectionHarness("clockIn", {
				targetEmployeeRows: [...targetEmployeeRows],
			});
			const exit = await harness.runExit();

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
			const error = Option.getOrThrow(Cause.failureOption(exit.cause));
			expect(error).toBeInstanceOf(NotFoundError);
			expect(harness.transactionInsert).not.toHaveBeenCalled();
			expect(harness.getState()).toEqual(harness.initialState);
		},
	);

	it("locks the exact target employee before the exact work period", async () => {
		const harness = createDirectCorrectionHarness("clockIn");

		await harness.run();

		expect(harness.lockTargetEmployee).toHaveBeenCalledWith("update");
		expect(harness.lockPeriod).toHaveBeenCalledWith("update");
		expect(harness.lockTargetEmployee.mock.invocationCallOrder[0]).toBeLessThan(
			harness.lockPeriod.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("uses one global employee lock order for reciprocal manager corrections", async () => {
		const aCorrectsB = createDirectCorrectionHarness("clockIn", {
			actorEmployeeId: "employee-a",
			actorRole: "manager",
			targetEmployeeId: "employee-b",
		});
		const bCorrectsA = createDirectCorrectionHarness("clockIn", {
			actorEmployeeId: "employee-b",
			actorRole: "manager",
			targetEmployeeId: "employee-a",
		});

		await Promise.all([aCorrectsB.run(), bCorrectsA.run()]);

		expect(aCorrectsB.employeeLockBatches).toEqual([
			["employee-a", "employee-b"],
		]);
		expect(bCorrectsA.employeeLockBatches).toEqual([
			["employee-a", "employee-b"],
		]);
		expect(
			aCorrectsB.lockTargetEmployee.mock.invocationCallOrder[0],
		).toBeLessThan(aCorrectsB.lockPeriod.mock.invocationCallOrder[0] ?? 0);
		expect(
			bCorrectsA.lockTargetEmployee.mock.invocationCallOrder[0],
		).toBeLessThan(bCorrectsA.lockPeriod.mock.invocationCallOrder[0] ?? 0);
	});

	it("rejects a direct correction when the actor employee is deactivated before the period lock", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			actorActive: false,
			actorEmployeeId: "manager-1",
			actorRole: "manager",
		});
		const exit = await harness.runExit();

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
		const error = Option.getOrThrow(Cause.failureOption(exit.cause));
		expect(error).toBeInstanceOf(AuthorizationError);
		expect(harness.lockMembership).not.toHaveBeenCalled();
		expect(harness.lockPeriod).not.toHaveBeenCalled();
		expect(harness.transactionInsert).not.toHaveBeenCalled();
		expect(harness.getState()).toEqual(harness.initialState);
	});

	it("rejects a manager correction when the manager assignment is revoked before the period lock", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			actorEmployeeId: "manager-1",
			actorRole: "manager",
			managerAssigned: false,
		});
		const exit = await harness.runExit();

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
		const error = Option.getOrThrow(Cause.failureOption(exit.cause));
		expect(error).toBeInstanceOf(AuthorizationError);
		expect(harness.lockTargetEmployee.mock.invocationCallOrder[0]).toBeLessThan(
			harness.lockManagerAssignment.mock.invocationCallOrder[0] ?? 0,
		);
		expect(harness.lockPeriod).not.toHaveBeenCalled();
		expect(harness.transactionInsert).not.toHaveBeenCalled();
		expect(harness.getState()).toEqual(harness.initialState);
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

	it.each([
		["legacy", { pendingLegacy: true }],
		["canonical", { pendingCanonical: true }],
	] as const)(
		"rejects a direct correction while a %s correction is pending",
		async (_kind, options) => {
			const harness = createDirectCorrectionHarness("clockIn", options);
			const exit = await harness.runExit();

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isSuccess(exit)) throw new Error("Expected correction to fail");
			const error = Option.getOrThrow(Cause.failureOption(exit.cause));
			expect(error).toBeInstanceOf(ConflictError);
			expect(error).toMatchObject({
				conflictType: "pending_time_correction_approval",
			});
			expect(harness.transactionInsert).not.toHaveBeenCalled();
			expect(harness.getState()).toEqual(harness.initialState);
		},
	);

	it.each(["manager REST", "same-day"])(
		"models exactly one winner in the in-memory keyed row-lock contract when approval creation races a %s correction",
		async () => {
			const harness = createDirectCorrectionHarness("clockIn");
			const approval = harness.runApproval();
			await harness.approvalLocked;
			const immediate = harness.runExit();
			harness.releaseApproval();

			await expect(approval).resolves.toEqual({ approvalId: "approval-1" });
			const exit = await immediate;
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isSuccess(exit))
				throw new Error("Expected correction to lose the race");
			const error = Option.getOrThrow(Cause.failureOption(exit.cause));
			expect(error).toMatchObject({
				conflictType: "pending_time_correction_approval",
			});
			expect(harness.getState()).toMatchObject({
				pendingLegacy: true,
				corrections: [],
				original: { isSuperseded: false, supersededById: null },
			});
			expect(harness.observedLocks).toEqual(
				expect.arrayContaining([
					"employee:org-1:employee-1",
					"work-period:org-1:period-1",
				]),
			);
		},
	);

	it("does not serialize whole transactions when the in-memory row-lock contract is disabled", async () => {
		const harness = createDirectCorrectionHarness("clockIn", {
			honorRowLocks: false,
		});
		const approval = harness.runApproval();
		await harness.approvalLocked;
		const immediate = harness.runExit();
		const progress = await Promise.race([
			immediate.then(() => "completed" as const),
			new Promise<"blocked">((resolve) =>
				setTimeout(() => resolve("blocked"), 20),
			),
		]);
		harness.releaseApproval();
		await approval;
		const exit = await immediate;

		expect(progress).toBe("completed");
		expect(Exit.isSuccess(exit)).toBe(true);
		expect(harness.observedLocks).toEqual([]);
	});
});
