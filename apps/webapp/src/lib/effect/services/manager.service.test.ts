import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { employee, employeeManagers } from "@/db/schema";
import { DatabaseService } from "./database.service";
import { ManagerService, ManagerServiceLive } from "./manager.service";

// Protection itself is covered by authorization-mutation.test.ts and the
// PostgreSQL suite; here it runs the mutation in the fake's transaction.
const protection = vi.hoisted(() => ({ scopes: [] as unknown[] }));
vi.mock("@/lib/authorization/authorization-mutation", () => ({
	withAuthorizationMutation: async (
		scope: unknown,
		mutation: (tx: unknown) => Promise<unknown>,
		database: { transaction: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown> },
	) => {
		protection.scopes.push(scope);
		return database.transaction(mutation);
	},
}));

function createManagerServiceTestContext({
	employeeRecord = { id: "employee-1", organizationId: "org-1" },
	existingAssignment,
	managerRecord = { id: "manager-1", organizationId: "org-1" },
	managerAssignments,
}: {
	employeeRecord?: { id: string; organizationId: string } | null;
	existingAssignment?: { id: string } | null;
	managerRecord?: { id: string; organizationId: string } | null;
	managerAssignments?: Array<{
		id: string;
		employeeId: string;
		managerId: string;
		isPrimary: boolean;
	}>;
} = {}) {
	const updatedTables: unknown[] = [];
	const updateWhere = vi.fn(async () => undefined);
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const deleteWhere = vi.fn(async () => undefined);

	const db = {
		query: {
			employee: {
				findFirst: vi
					.fn()
					.mockResolvedValueOnce(employeeRecord)
					.mockResolvedValueOnce(managerRecord)
					.mockResolvedValue(employeeRecord),
			},
			employeeManagers: {
				findFirst: vi.fn(async () => existingAssignment ?? null),
				findMany: vi.fn(async () => managerAssignments ?? []),
			},
		},
		insert: vi.fn(() => ({
			values: vi.fn(async () => undefined),
		})),
		update: vi.fn((table) => {
			updatedTables.push(table);
			return { set: updateSet };
		}),
		delete: vi.fn(() => ({ where: deleteWhere })),
		// Reads inside the protected transaction: the existing link on assignment,
		// every current link on removal.
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(async () =>
					managerAssignments ?? (existingAssignment ? [existingAssignment] : []),
				),
			})),
		})),
		transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
	};

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: db as never,
			query: (_name, query) => Effect.promise(query) as never,
		}),
	);
	const layer = ManagerServiceLive.pipe(Layer.provide(dbLayer));

	return {
		db,
		updatedTables,
		employeeTableUpdateCount: () => updatedTables.filter((table) => table === employee).length,
		employeeManagersTableUpdateCount: () =>
			updatedTables.filter((table) => table === employeeManagers).length,
		runAssignManager: (isPrimary: boolean) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* ManagerService;
					yield* service.assignManager("employee-1", "manager-1", isPrimary, "admin-1");
				}).pipe(Effect.provide(layer)),
			),
		runRemoveManager: () =>
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* ManagerService;
					yield* service.removeManager("employee-1", "manager-1");
				}).pipe(Effect.provide(layer)),
			),
	};
}

describe("ManagerService", () => {
	it("does not sync employee.managerId when assigning a primary manager", async () => {
		const { employeeTableUpdateCount, employeeManagersTableUpdateCount, runAssignManager } =
			createManagerServiceTestContext();

		await runAssignManager(true);

		expect(employeeManagersTableUpdateCount()).toBeGreaterThan(0);
		expect(employeeTableUpdateCount()).toBe(0);
	});

	it("changes relations under both employees' configuration/access protection", async () => {
		protection.scopes.length = 0;
		const { runAssignManager } = createManagerServiceTestContext();

		await runAssignManager(false);

		expect(protection.scopes).toEqual([
			{ organizationId: "org-1", employeeIds: ["employee-1", "manager-1"] },
		]);
	});

	it("rejects manager assignments across organizations", async () => {
		const { db, runAssignManager, employeeManagersTableUpdateCount } =
			createManagerServiceTestContext({
				employeeRecord: { id: "employee-1", organizationId: "org-1" },
				managerRecord: { id: "manager-1", organizationId: "org-2" },
			});

		await expect(runAssignManager(true)).rejects.toMatchObject({
			message: "Manager must belong to the same organization as the employee",
		});
		expect(db.insert).not.toHaveBeenCalled();
		expect(employeeManagersTableUpdateCount()).toBe(0);
	});

	it("does not sync employee.managerId when removing the primary manager", async () => {
		const { employeeTableUpdateCount, employeeManagersTableUpdateCount, runRemoveManager } =
			createManagerServiceTestContext({
				managerAssignments: [
					{
						id: "assignment-1",
						employeeId: "employee-1",
						managerId: "manager-1",
						isPrimary: true,
					},
					{
						id: "assignment-2",
						employeeId: "employee-1",
						managerId: "manager-2",
						isPrimary: false,
					},
				],
			});

		await runRemoveManager();

		expect(employeeManagersTableUpdateCount()).toBeGreaterThan(0);
		expect(employeeTableUpdateCount()).toBe(0);
	});
});
