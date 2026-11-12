import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	descCalls: [] as Array<{ columnName: string; tableName: string | undefined }>,
	distinctOnCalls: [] as Array<Array<{ columnName: string; tableName: string | undefined }>>,
	eqCalls: [] as Array<{
		columnName: string;
		tableName: string | undefined;
		value: unknown;
	}>,
	inArrayCalls: [] as Array<{
		columnName: string;
		tableName: string | undefined;
		values: unknown[];
	}>,
	orderByFirstColumnCalls: [] as Array<{
		columnName: string;
		tableName: string | undefined;
	}>,
	caller: null as StubCaller | null,
	dbService: null as null | ReturnType<typeof createDbService>,
	managedEmployeeIds: [] as string[],
}));

vi.mock("drizzle-orm", async () => {
	const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");

	return {
		...actual,
		desc: vi.fn((column: Parameters<typeof actual.desc>[0]) => {
			const typedColumn = column as {
				name?: string;
				table?: { [key: symbol]: string };
			};
			mocks.descCalls.push({
				columnName: typedColumn.name ?? "",
				tableName: typedColumn.table?.[Symbol.for("drizzle:Name")],
			});
			return actual.desc(column);
		}),
		eq: vi.fn((left: Parameters<typeof actual.eq>[0], right: Parameters<typeof actual.eq>[1]) => {
			const column = left as {
				name?: string;
				table?: { [key: symbol]: string };
			};

			mocks.eqCalls.push({
				columnName: column.name ?? "",
				tableName: column.table?.[Symbol.for("drizzle:Name")],
				value: right,
			});

			return actual.eq(left, right);
		}),
		inArray: vi.fn(
			(
				left: Parameters<typeof actual.inArray>[0],
				values: Parameters<typeof actual.inArray>[1],
			) => {
				const column = left as {
					name?: string;
					table?: { [key: symbol]: string };
				};
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

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: new Proxy({}, { get: (_target, key) => Reflect.get(mocks.dbService?.db ?? {}, key) }),
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([mocks.managedEmployeeIds.map((id) => ({ id })), []]) as never)
					: (mocks.dbService?.query(name, fn) as never),
		}),
	);
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
	const createActivityQuery = () => ({
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				orderBy: vi.fn((firstColumn: { name?: string; table?: { [key: symbol]: string } }) => {
					mocks.orderByFirstColumnCalls.push({
						columnName: firstColumn.name ?? "",
						tableName: firstColumn.table?.[Symbol.for("drizzle:Name")],
					});
					return Promise.resolve([]);
				}),
			})),
		})),
	});
	const query = vi.fn((name: string, fn: () => unknown) => {
		if (name === "getEmployeeClockStatuses:organizationEmployees") {
			void fn();
			return Effect.succeed(organizationEmployeeRows);
		}

		if (name === "getEmployeeClockStatuses:activeWorkPeriods") {
			return Effect.succeed(activeRows);
		}

		if (name === "getEmployeeClockStatuses:activity") {
			void fn();
			return Effect.succeed(activityRows);
		}

		return Effect.promise(async () => fn());
	});

	return {
		query,
		db: {
			selectDistinctOn: vi.fn(
				(columns: Array<{ name?: string; table?: { [key: symbol]: string } }>) => {
					mocks.distinctOnCalls.push(
						columns.map((column) => ({
							columnName: column.name ?? "",
							tableName: column.table?.[Symbol.for("drizzle:Name")],
						})),
					);
					return createActivityQuery();
				},
			),
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

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "admin-1", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	userId: "manager-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	userId: "member-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "member-1", role: "employee", former: false },
};

function useCaller(
	caller: StubCaller,
	dbService: ReturnType<typeof createDbService>,
	managedEmployeeIds: string[] = [],
) {
	mocks.caller = caller;
	mocks.dbService = dbService;
	mocks.managedEmployeeIds = managedEmployeeIds;
}

describe("getEmployeeClockStatuses", () => {
	beforeEach(() => {
		mocks.descCalls.length = 0;
		mocks.distinctOnCalls.length = 0;
		mocks.eqCalls.length = 0;
		mocks.inArrayCalls.length = 0;
		mocks.orderByFirstColumnCalls.length = 0;
		vi.clearAllMocks();
		mocks.caller = null;
	});

	it("refuses an org member, one level below scoped manager", async () => {
		const dbService = createDbService({
			activeRows: [{ employeeId: "emp-1" }],
			organizationEmployeeRows: [{ id: "emp-1" }],
		});
		useCaller(orgMember, dbService);

		await expect(getEmployeeClockStatuses(["emp-1"])).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(dbService.query).not.toHaveBeenCalled();
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
		useCaller(orgAdmin, dbService);

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

	it("reports an employee on a break in progress as on break, since its start (#861)", async () => {
		const dbService = createDbService({
			activeRows: [
				{
					employeeId: "emp-1",
					breakSince: parseInstant("2026-07-28T09:45:00Z"),
					breakZone: "Europe/Berlin",
				},
				{ employeeId: "emp-2", breakSince: null, breakZone: null },
			] as never,
			organizationEmployeeRows: [{ id: "emp-1" }, { id: "emp-2" }],
		});
		useCaller(orgAdmin, dbService);

		const result = await getEmployeeClockStatuses(["emp-1", "emp-2"]);

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({
			"emp-1": {
				status: "on-break",
				lastActivityAt: null,
				lastActivityUtcOffsetMinutes: null,
				breakStartedAt: "2026-07-28T09:45:00.000Z",
				breakStartedZone: "Europe/Berlin",
			},
			"emp-2": {
				status: "clocked-in",
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
		useCaller(scopedManager, dbService, ["emp-1"]);

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
		useCaller(orgAdmin, dbService);

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
		useCaller(orgAdmin, dbService);

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
		useCaller(scopedManager, dbService, ["emp-1"]);

		await getEmployeeClockStatuses(["emp-1", "emp-2"]);

		expect(mocks.eqCalls).toEqual(
			expect.arrayContaining([
				{
					columnName: "organization_id",
					tableName: "time_entry",
					value: "org-1",
				},
				{ columnName: "is_superseded", tableName: "time_entry", value: false },
			]),
		);
		expect(mocks.inArrayCalls).toEqual(
			expect.arrayContaining([
				{
					columnName: "employee_id",
					tableName: "time_entry",
					values: ["emp-1"],
				},
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
		expect(mocks.distinctOnCalls).toEqual([
			[{ columnName: "employee_id", tableName: "time_entry" }],
		]);
		expect(mocks.orderByFirstColumnCalls).toEqual([
			{ columnName: "employee_id", tableName: "time_entry" },
		]);
	});

	it("does not query activity when no requested employees are accessible", async () => {
		const dbService = createDbService({
			activeRows: [],
			organizationEmployeeRows: [],
		});
		useCaller(orgAdmin, dbService);

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
		useCaller(orgAdmin, dbService);

		await getEmployeeClockStatuses(["emp-1", "inactive-emp"]);

		expect(mocks.eqCalls).toContainEqual({
			columnName: "is_active",
			tableName: "employee",
			value: true,
		});
	});
});
