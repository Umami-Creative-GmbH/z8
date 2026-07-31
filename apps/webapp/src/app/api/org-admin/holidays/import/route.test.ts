import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
	const categoryRows: Array<{ id: string }> = [];
	const existingHolidayRows: Array<{
		name: string;
		recurrenceRule: string | null;
		startDate: Date;
	}> = [];
	const categoryPredicates: unknown[] = [];
	const insertedHolidayBatches: unknown[][] = [];
	const holidayInsertFailure = { value: null as Error | null };
	const holidayInsertGate = { value: null as Promise<void> | null };
	const onHolidayInsert = { value: null as (() => void) | null };
	const onAdvisoryLockAcquired = {
		value: null as ((lockKey: string) => void) | null,
	};
	const onExistingHolidayRead = {
		value: null as ((count: number) => void) | null,
	};
	const onTransactionStarted = {
		value: null as ((count: number) => void) | null,
	};
	const advisoryLocks = new Map<string, Promise<void>>();
	const advisoryLockKeys: string[] = [];
	const advisoryLockStatements: string[] = [];
	const existingHolidayReadCount = { value: 0 };
	const transactionStartedCount = { value: 0 };
	const transaction = vi.fn();
	const insert = vi.fn();

	function queryResult<T>(rows: T[]) {
		return Object.assign(Promise.resolve(rows), {
			limit: vi.fn(async () => rows),
		});
	}

	function makeDatabase(context?: {
		pendingHolidays: typeof existingHolidayRows;
		releaseLocks: Array<() => void>;
	}) {
		return {
			execute: vi.fn(
				async (statement: { strings?: string[]; values?: unknown[] }) => {
					const [lockKey] = statement.values ?? [];
					if (typeof lockKey !== "string") {
						throw new Error("Expected parameterized advisory lock key");
					}
					if (!context)
						throw new Error("Advisory lock must run inside a transaction");

					advisoryLockKeys.push(lockKey);
					advisoryLockStatements.push(statement.strings?.join("?") ?? "");
					const previous = advisoryLocks.get(lockKey) ?? Promise.resolve();
					let release!: () => void;
					const held = new Promise<void>((resolve) => {
						release = resolve;
					});
					advisoryLocks.set(
						lockKey,
						previous.then(() => held),
					);
					await previous;
					onAdvisoryLockAcquired.value?.(lockKey);
					context.releaseLocks.push(release);
					return [];
				},
			),
			insert: vi.fn((table: { tableName?: string }) => ({
				values: vi.fn((values: unknown | unknown[]) => {
					if (table.tableName === "holiday") {
						const batch = Array.isArray(values) ? values : [values];
						insertedHolidayBatches.push(batch);
						onHolidayInsert.value?.();
						if (holidayInsertFailure.value) {
							return Promise.reject(holidayInsertFailure.value);
						}
						return (async () => {
							await holidayInsertGate.value;
							context?.pendingHolidays.push(
								...batch.map((row) => {
									const holidayRow = row as {
										name: string;
										recurrenceRule: string | null;
										startDate: Date;
									};
									return {
										name: holidayRow.name,
										recurrenceRule: holidayRow.recurrenceRule,
										startDate: holidayRow.startDate,
									};
								}),
							);
						})();
					}
					return Object.assign(Promise.resolve(undefined), {
						returning: vi.fn(async () => [{ id: "category-default" }]),
					});
				}),
			})),
			select: vi.fn(() => ({
				from: vi.fn((table: { tableName?: string }) => ({
					where: vi.fn((predicate: unknown) => {
						if (table.tableName === "holidayCategory") {
							categoryPredicates.push(predicate);
							return queryResult(categoryRows);
						}
						existingHolidayReadCount.value++;
						onExistingHolidayRead.value?.(existingHolidayReadCount.value);
						return queryResult(existingHolidayRows.map((row) => ({ ...row })));
					}),
				})),
			})),
		};
	}

	return {
		advisoryLockKeys,
		advisoryLockStatements,
		advisoryLocks,
		categoryPredicates,
		categoryRows,
		existingHolidayRows,
		existingHolidayReadCount,
		getAbility: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		holidayInsertFailure,
		holidayInsertGate,
		insert,
		insertedHolidayBatches,
		makeDatabase,
		onAdvisoryLockAcquired,
		onExistingHolidayRead,
		onHolidayInsert,
		onTransactionStarted,
		transaction,
		transactionStartedCount,
	};
});

vi.mock("next/headers", () => ({ headers: state.headers }));
vi.mock("next/server", async () => {
	const actual =
		await vi.importActual<typeof import("next/server")>("next/server");
	return { ...actual, connection: vi.fn() };
});
vi.mock("@/db/schema", () => ({
	holiday: {
		tableName: "holiday",
		isActive: "holiday.isActive",
		name: "holiday.name",
		organizationId: "holiday.organizationId",
		recurrenceRule: "holiday.recurrenceRule",
		startDate: "holiday.startDate",
	},
	holidayCategory: {
		tableName: "holidayCategory",
		id: "holidayCategory.id",
		isActive: "holidayCategory.isActive",
		organizationId: "holidayCategory.organizationId",
		type: "holidayCategory.type",
	},
}));
vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: state.getSession } },
}));
vi.mock("@/lib/auth-helpers", () => ({ getAbility: state.getAbility }));
vi.mock("@/lib/authorization", () => ({
	ForbiddenError: class ForbiddenError extends Error {},
	toHttpError: vi.fn(() => ({ body: { error: "Forbidden" }, status: 403 })),
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
		strings,
		values,
	}),
}));

const database = state.makeDatabase();
state.transaction.mockImplementation(
	async (callback: (tx: typeof database) => unknown) => {
		const context = {
			pendingHolidays: [] as typeof state.existingHolidayRows,
			releaseLocks: [] as Array<() => void>,
		};
		const tx = state.makeDatabase(context);
		state.transactionStartedCount.value++;
		state.onTransactionStarted.value?.(state.transactionStartedCount.value);
		try {
			const result = await callback(tx as typeof database);
			state.existingHolidayRows.push(...context.pendingHolidays);
			return result;
		} finally {
			for (const release of context.releaseLocks.toReversed()) release();
		}
	},
);
vi.mock("@/db", () => ({
	db: {
		...database,
		transaction: state.transaction,
	},
}));

const { POST } = await import("./route");

const categoryId = "10000000-0000-4000-8000-000000000001";

function holidayInput(name: string, date: string, endDate = date) {
	return {
		date: `${date} 00:00:00`,
		endDate: `${endDate}T00:00:00.000Z`,
		name,
		startDate: `${date}T00:00:00.000Z`,
		type: "public",
	};
}

function request(body: unknown) {
	return { json: vi.fn(async () => body) } as never;
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("POST /api/org-admin/holidays/import", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.categoryRows.length = 0;
		state.existingHolidayRows.length = 0;
		state.categoryPredicates.length = 0;
		state.insertedHolidayBatches.length = 0;
		state.holidayInsertFailure.value = null;
		state.holidayInsertGate.value = null;
		state.onAdvisoryLockAcquired.value = null;
		state.onExistingHolidayRead.value = null;
		state.onHolidayInsert.value = null;
		state.onTransactionStarted.value = null;
		state.advisoryLocks.clear();
		state.advisoryLockKeys.length = 0;
		state.advisoryLockStatements.length = 0;
		state.existingHolidayReadCount.value = 0;
		state.transactionStartedCount.value = 0;
		state.categoryRows.push({ id: categoryId });
		state.getAbility.mockResolvedValue({ cannot: vi.fn(() => false) });
		state.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-active" },
			user: { id: "user-1" },
		});
		state.headers.mockResolvedValue(new Headers());
	});

	it("rejects more than 366 holidays before opening a transaction", async () => {
		const holidays = Array.from({ length: 367 }, (_, index) =>
			holidayInput(`Holiday ${index}`, "2026-01-01"),
		);

		const response = await POST(request({ categoryId, holidays }));

		expect(response.status).toBe(400);
		expect(state.transaction).not.toHaveBeenCalled();
	});

	it("rejects a category outside the active organization before any write", async () => {
		state.categoryRows.length = 0;

		const response = await POST(
			request({
				categoryId,
				holidays: [holidayInput("New Year", "2026-01-01")],
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Invalid holiday category",
		});
		expect(state.categoryPredicates[0]).toEqual({
			conditions: expect.arrayContaining([
				{ column: "holidayCategory.id", type: "eq", value: categoryId },
				{
					column: "holidayCategory.organizationId",
					type: "eq",
					value: "org-active",
				},
			]),
			type: "and",
		});
		expect(state.transaction).toHaveBeenCalledOnce();
		expect(state.advisoryLockKeys).toEqual(["holiday-import:org-active"]);
		expect(state.insertedHolidayBatches).toEqual([]);
	});

	it("preserves input order while skipping duplicates and collecting row errors", async () => {
		state.existingHolidayRows.push({
			name: "Existing",
			recurrenceRule: JSON.stringify({ day: 2, month: 1 }),
			startDate: new Date("2020-01-02T00:00:00.000Z"),
		});

		const response = await POST(
			request({
				categoryId,
				holidays: [
					holidayInput("First", "2026-01-01"),
					holidayInput("Existing", "2026-01-02"),
					holidayInput("Bad second", "2026-01-05", "2026-01-04"),
					holidayInput("First", "2026-01-03"),
					holidayInput("Bad fourth", "2026-01-07", "2026-01-06"),
					holidayInput("Last", "2026-01-08"),
				],
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			categoryId,
			errors: [
				'Failed to import "Bad second"',
				'Failed to import "Bad fourth"',
			],
			imported: 2,
			skipped: 2,
		});
		expect(state.transaction).toHaveBeenCalledOnce();
		expect(state.insertedHolidayBatches).toHaveLength(1);
		expect(
			state.insertedHolidayBatches[0]?.map(
				(row) => (row as { name: string }).name,
			),
		).toEqual(["First", "Last"]);
	});

	it("does not report partial success when the transactional bulk insert fails", async () => {
		state.holidayInsertFailure.value = new Error("database unavailable");

		const response = await POST(
			request({
				categoryId,
				holidays: [holidayInput("First", "2026-01-01")],
			}),
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Internal server error" });
		expect(state.transaction).toHaveBeenCalledOnce();
		expect(state.insertedHolidayBatches).toHaveLength(1);
	});

	it("serializes concurrent imports for one organization before duplicate reads", async () => {
		const firstInsertStarted = deferred<void>();
		const releaseFirstInsert = deferred<void>();
		const secondTransactionStarted = deferred<void>();
		state.onHolidayInsert.value = () => firstInsertStarted.resolve();
		state.holidayInsertGate.value = releaseFirstInsert.promise;
		state.onTransactionStarted.value = (count) => {
			if (count === 2) secondTransactionStarted.resolve();
		};
		const body = {
			categoryId,
			holidays: [holidayInput("Concurrent", "2026-02-01")],
		};

		const firstResponsePromise = POST(request(body));
		await firstInsertStarted.promise;
		const secondResponsePromise = POST(request(body));
		await secondTransactionStarted.promise;

		try {
			expect(state.existingHolidayReadCount.value).toBe(1);
			expect(state.insertedHolidayBatches).toHaveLength(1);
			expect(state.advisoryLockKeys).toEqual([
				"holiday-import:org-active",
				"holiday-import:org-active",
			]);
			expect(state.advisoryLockStatements).toEqual([
				"select pg_advisory_xact_lock(hashtextextended(?, 0))",
				"select pg_advisory_xact_lock(hashtextextended(?, 0))",
			]);
		} finally {
			releaseFirstInsert.resolve();
		}

		const [firstResponse, secondResponse] = await Promise.all([
			firstResponsePromise,
			secondResponsePromise,
		]);
		expect(await firstResponse.json()).toMatchObject({
			imported: 1,
			skipped: 0,
		});
		expect(await secondResponse.json()).toMatchObject({
			imported: 0,
			skipped: 1,
		});
		expect(state.insertedHolidayBatches).toHaveLength(1);
	});

	it("allows concurrent imports for different organizations to proceed independently", async () => {
		const firstInsertStarted = deferred<void>();
		const releaseFirstInsert = deferred<void>();
		const secondLockAcquired = deferred<void>();
		const secondReadStarted = deferred<void>();
		const secondTransactionStarted = deferred<void>();
		state.onHolidayInsert.value = () => firstInsertStarted.resolve();
		state.holidayInsertGate.value = releaseFirstInsert.promise;
		state.onTransactionStarted.value = (count) => {
			if (count === 2) secondTransactionStarted.resolve();
		};
		state.onAdvisoryLockAcquired.value = (lockKey) => {
			if (lockKey === "holiday-import:org-other") secondLockAcquired.resolve();
		};
		state.onExistingHolidayRead.value = (count) => {
			if (count === 2) secondReadStarted.resolve();
		};
		state.getSession
			.mockResolvedValueOnce({
				session: { activeOrganizationId: "org-active" },
				user: { id: "user-1" },
			})
			.mockResolvedValueOnce({
				session: { activeOrganizationId: "org-other" },
				user: { id: "user-2" },
			});
		const body = {
			categoryId,
			holidays: [holidayInput("Parallel", "2026-03-01")],
		};

		const firstResponsePromise = POST(request(body));
		await firstInsertStarted.promise;
		state.holidayInsertGate.value = null;
		const secondResponsePromise = POST(request(body));
		await secondTransactionStarted.promise;

		try {
			expect(state.advisoryLockKeys).toEqual([
				"holiday-import:org-active",
				"holiday-import:org-other",
			]);
			await secondLockAcquired.promise;
			await secondReadStarted.promise;
			expect(state.existingHolidayReadCount.value).toBe(2);
		} finally {
			releaseFirstInsert.resolve();
		}

		const [firstResponse, secondResponse] = await Promise.all([
			firstResponsePromise,
			secondResponsePromise,
		]);
		expect(await firstResponse.json()).toMatchObject({
			imported: 1,
			skipped: 0,
		});
		expect(await secondResponse.json()).toMatchObject({
			imported: 1,
			skipped: 0,
		});
		expect(state.insertedHolidayBatches).toHaveLength(2);
	});
});
