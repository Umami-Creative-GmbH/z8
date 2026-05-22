import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { employee, employeeManagers } from "@/db/schema";
import { DatabaseService } from "./database.service";
import { ManagerService, ManagerServiceLive } from "./manager.service";

function createManagerServiceTestContext({
	existingAssignment,
	managerAssignments,
}: {
	existingAssignment?: { id: string } | null;
	managerAssignments?: Array<{ id: string; employeeId: string; managerId: string; isPrimary: boolean }>;
} = {}) {
	const updatedTables: unknown[] = [];
	const updateWhere = vi.fn(async () => undefined);
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const deleteWhere = vi.fn(async () => undefined);

	const db = {
		query: {
			employee: {
				findFirst: vi.fn(async () => ({ id: "employee-record" })),
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

	it("does not sync employee.managerId when removing the primary manager", async () => {
		const { employeeTableUpdateCount, employeeManagersTableUpdateCount, runRemoveManager } =
			createManagerServiceTestContext({
				managerAssignments: [
					{ id: "assignment-1", employeeId: "employee-1", managerId: "manager-1", isPrimary: true },
					{ id: "assignment-2", employeeId: "employee-1", managerId: "manager-2", isPrimary: false },
				],
			});

		await runRemoveManager();

		expect(employeeManagersTableUpdateCount()).toBeGreaterThan(0);
		expect(employeeTableUpdateCount()).toBe(0);
	});
});
