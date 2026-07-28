import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	descCalls: [] as Array<{ columnName: string; tableName: string | undefined }>,
	eqCalls: [] as Array<{ columnName: string; tableName: string | undefined; value: unknown }>,
	inArrayCalls: [] as Array<{
		columnName: string;
		tableName: string | undefined;
		values: unknown[];
	}>,
	getEmployeeSettingsActorContext: vi.fn(),
	getManagedEmployeeIdsForSettingsActor: vi.fn(),
}));

vi.mock("drizzle-orm", async () => {
	const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");

	return {
		...actual,
		desc: vi.fn((column: Parameters<typeof actual.desc>[0]) => {
			const typedColumn = column as { name?: string; table?: { [key: symbol]: string } };
			mocks.descCalls.push({
				columnName: typedColumn.name ?? "",
				tableName: typedColumn.table?.[Symbol.for("drizzle:Name")],
			});
			return actual.desc(column);
		}),
		eq: vi.fn((left: Parameters<typeof actual.eq>[0], right: Parameters<typeof actual.eq>[1]) => {
			const column = left as { name?: string; table?: { [key: symbol]: string } };

			mocks.eqCalls.push({
				columnName: column.name ?? "",
				tableName: column.table?.[Symbol.for("drizzle:Name")],
				value: right,
			});

			return actual.eq(left, right);
		}),
		inArray: vi.fn(
			(left: Parameters<typeof actual.inArray>[0], values: Parameters<typeof actual.inArray>[1]) => {
				const column = left as { name?: string; table?: { [key: symbol]: string } };
				mocks.inArrayCalls.push({
					columnName: column.name ?? "",
					tableName: column.table?.[Symbol.for("drizzle:Name")],
					values: [...values],
				});
				return actual.inArray(left, values);
			},
		),
	};
});

vi.mock("./employee-action-utils", () => ({
	getEmployeeSettingsActorContext: mocks.getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor: mocks.getManagedEmployeeIdsForSettingsActor,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");

	return { AppLayer: Layer.empty };
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	return {
		runServerActionSafe: async <T>(effect: Parameters<typeof Effect.runPromiseExit<T>>[0]) => {
			const exit = await Effect.runPromiseExit(effect);

			return Exit.match(exit, {
				onFailure: (cause) => {
					const defect = [...Cause.defects(cause)][0] ?? null;
					const failure = Option.getOrNull(Cause.failureOption(cause));
					const error = defect ?? failure ?? cause;

					return {
						success: false as const,
						error: error instanceof Error ? error.message : "An unexpected error occurred",
						code: "UNKNOWN_ERROR",
					};
				},
				onSuccess: (data) => ({ success: true as const, data }),
			});
		},
	};
});

import { getEmployeeClockStatuses } from "./employee-clock-status.actions";

function createDbService({
	activeRows,
	activityRows = [],
	organizationEmployeeRows,
}: {
	activeRows: Array<{ employeeId: string }>;
	activityRows?: Array<{
		employeeId: string;
		timestamp: Date;
		utcOffsetMinutes: number;
	}>;
	organizationEmployeeRows: Array<{ id: string }>;
}) {
	const query = vi.fn((name: string, fn: () => unknown) => {
		if (name === "getEmployeeClockStatuses:organizationEmployees") {
			void fn();
			return Promise.resolve(organizationEmployeeRows);
		}

		if (name === "getEmployeeClockStatuses:activeWorkPeriods") {
			return Promise.resolve(activeRows);
		}

		if (name === "getEmployeeClockStatuses:activity") {
			void fn();
			return Promise.resolve(activityRows);
		}

		return fn();
	});

	return {
		query,
		db: {
			select: vi.fn(() => ({
				from: vi.fn((table: { [key: symbol]: string }) => ({
					where: vi.fn(() =>
						table[Symbol.for("drizzle:Name")] === "time_entry"
							? { orderBy: vi.fn(() => Promise.resolve([])) }
							: Promise.resolve([]),
					),
				})),
			})),
		},
	};
}

describe("getEmployeeClockStatuses", () => {
	beforeEach(() => {
		mocks.descCalls.length = 0;
		mocks.eqCalls.length = 0;
		mocks.inArrayCalls.length = 0;
		vi.clearAllMocks();
	});

	it("returns clocked-in only for requested employees with active work periods", async () => {
		const dbService = createDbService({
			activeRows: [{ employeeId: "emp-1" }],
			activityRows: [
				{
					employeeId: "emp-1",
					timestamp: new Date("2026-07-28T10:30:00.000Z"),
					utcOffsetMinutes: 120,
				},
				{
					employeeId: "emp-1",
					timestamp: new Date("2026-07-28T08:00:00.000Z"),
					utcOffsetMinutes: 60,
				},
			],
			organizationEmployeeRows: [{ id: "emp-1" }, { id: "emp-2" }],
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				dbService,
				organizationId: "org-1",
				accessTier: "orgAdmin",
				currentEmployee: { id: "admin-1", role: "admin" },
				session: { user: { id: "user-1" } },
			}),
		);
		mocks.getManagedEmployeeIdsForSettingsActor.mockReturnValue(Effect.succeed(null));

		const result = await getEmployeeClockStatuses(["emp-1", "emp-2"]);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({
			"emp-1": {
				status: "clocked-in",
				lastActivityAt: "2026-07-28T10:30:00.000Z",
				lastActivityUtcOffsetMinutes: 120,
			},
			"emp-2": {
				status: "clocked-out",
				lastActivityAt: null,
				lastActivityUtcOffsetMinutes: null,
			},
		});
	});

	it("filters manager requests to managed employees", async () => {
		const dbService = createDbService({
			activeRows: [{ employeeId: "emp-1" }, { employeeId: "emp-2" }],
			organizationEmployeeRows: [{ id: "emp-1" }, { id: "emp-2" }],
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				dbService,
				organizationId: "org-1",
				accessTier: "manager",
				currentEmployee: { id: "manager-1", role: "manager" },
				session: { user: { id: "manager-user" } },
			}),
		);
		mocks.getManagedEmployeeIdsForSettingsActor.mockReturnValue(Effect.succeed(new Set(["emp-1"])));

		const result = await getEmployeeClockStatuses(["emp-1", "emp-2"]);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({
			"emp-1": {
				status: "clocked-in",
				lastActivityAt: null,
				lastActivityUtcOffsetMinutes: null,
			},
		});
	});

	it("deduplicates and ignores empty employee ids", async () => {
		const dbService = createDbService({
			activeRows: [],
			organizationEmployeeRows: [{ id: "emp-1" }],
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				dbService,
				organizationId: "org-1",
				accessTier: "orgAdmin",
				currentEmployee: { id: "admin-1", role: "admin" },
				session: { user: { id: "user-1" } },
			}),
		);
		mocks.getManagedEmployeeIdsForSettingsActor.mockReturnValue(Effect.succeed(null));

		const result = await getEmployeeClockStatuses(["emp-1", "emp-1", ""]);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({
			"emp-1": {
				status: "clocked-out",
				lastActivityAt: null,
				lastActivityUtcOffsetMinutes: null,
			},
		});
	});

	it("does not expose requested employee ids outside the active organization", async () => {
		const dbService = createDbService({
			activeRows: [{ employeeId: "emp-1" }, { employeeId: "emp-outside-org" }],
			activityRows: [
				{
					employeeId: "emp-outside-org",
					timestamp: new Date("2026-07-28T11:00:00.000Z"),
					utcOffsetMinutes: -240,
				},
			],
			organizationEmployeeRows: [{ id: "emp-1" }],
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				dbService,
				organizationId: "org-1",
				accessTier: "orgAdmin",
				currentEmployee: { id: "admin-1", role: "admin" },
				session: { user: { id: "user-1" } },
			}),
		);
		mocks.getManagedEmployeeIdsForSettingsActor.mockReturnValue(Effect.succeed(null));

		const result = await getEmployeeClockStatuses(["emp-1", "emp-outside-org"]);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({
			"emp-1": {
				status: "clocked-in",
				lastActivityAt: null,
				lastActivityUtcOffsetMinutes: null,
			},
		});
		expect(dbService.query).toHaveBeenCalledWith(
			"getEmployeeClockStatuses:activity",
			expect.any(Function),
		);
	});

	it("scopes latest activity to accessible employees and valid clock events", async () => {
		const dbService = createDbService({
			activeRows: [],
			organizationEmployeeRows: [{ id: "emp-1" }, { id: "emp-2" }],
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				dbService,
				organizationId: "org-1",
				accessTier: "manager",
				currentEmployee: { id: "manager-1", role: "manager" },
				session: { user: { id: "manager-user" } },
			}),
		);
		mocks.getManagedEmployeeIdsForSettingsActor.mockReturnValue(Effect.succeed(new Set(["emp-1"])));

		await getEmployeeClockStatuses(["emp-1", "emp-2"]);

		expect(mocks.eqCalls).toEqual(
			expect.arrayContaining([
				{ columnName: "organization_id", tableName: "time_entry", value: "org-1" },
				{ columnName: "is_superseded", tableName: "time_entry", value: false },
			]),
		);
		expect(mocks.inArrayCalls).toEqual(
			expect.arrayContaining([
				{ columnName: "employee_id", tableName: "time_entry", values: ["emp-1"] },
				{
					columnName: "type",
					tableName: "time_entry",
					values: ["clock_in", "clock_out"],
				},
			]),
		);
		expect(mocks.descCalls).toEqual([
			{ columnName: "timestamp", tableName: "time_entry" },
			{ columnName: "id", tableName: "time_entry" },
		]);
	});

	it("does not query activity when no requested employees are accessible", async () => {
		const dbService = createDbService({ activeRows: [], organizationEmployeeRows: [] });
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				dbService,
				organizationId: "org-1",
				accessTier: "orgAdmin",
				currentEmployee: { id: "admin-1", role: "admin" },
				session: { user: { id: "user-1" } },
			}),
		);
		mocks.getManagedEmployeeIdsForSettingsActor.mockReturnValue(Effect.succeed(null));

		const result = await getEmployeeClockStatuses(["inaccessible-emp"]);

		expect(result).toEqual({ success: true, data: {} });
		expect(dbService.query).not.toHaveBeenCalledWith(
			"getEmployeeClockStatuses:activity",
			expect.any(Function),
		);
	});

	it("filters organization employee resolution to active employees", async () => {
		const dbService = createDbService({
			activeRows: [],
			organizationEmployeeRows: [{ id: "emp-1" }],
		});
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				dbService,
				organizationId: "org-1",
				accessTier: "orgAdmin",
				currentEmployee: { id: "admin-1", role: "admin" },
				session: { user: { id: "user-1" } },
			}),
		);
		mocks.getManagedEmployeeIdsForSettingsActor.mockReturnValue(Effect.succeed(null));

		await getEmployeeClockStatuses(["emp-1", "inactive-emp"]);

		expect(mocks.eqCalls).toContainEqual({
			columnName: "is_active",
			tableName: "employee",
			value: true,
		});
	});
});
