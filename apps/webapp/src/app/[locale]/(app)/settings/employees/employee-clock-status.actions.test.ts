import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getEmployeeSettingsActorContext: vi.fn(),
	getManagedEmployeeIdsForSettingsActor: vi.fn(),
}));

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
	organizationEmployeeRows,
}: {
	activeRows: Array<{ employeeId: string }>;
	organizationEmployeeRows: Array<{ id: string }>;
}) {
	return {
		query: vi.fn((name: string, fn: () => unknown) => {
			if (name === "getEmployeeClockStatuses:organizationEmployees") {
				return Promise.resolve(organizationEmployeeRows);
			}

			if (name === "getEmployeeClockStatuses:activeWorkPeriods") {
				return Promise.resolve(activeRows);
			}

			return fn();
		}),
		db: {
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([])),
				})),
			})),
		},
	};
}

describe("getEmployeeClockStatuses", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns clocked-in only for requested employees with active work periods", async () => {
		const dbService = createDbService({
			activeRows: [{ employeeId: "emp-1" }],
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
			"emp-1": "clocked-in",
			"emp-2": "clocked-out",
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
		expect(result.data).toEqual({ "emp-1": "clocked-in" });
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
		expect(result.data).toEqual({ "emp-1": "clocked-out" });
	});

	it("does not expose requested employee ids outside the active organization", async () => {
		const dbService = createDbService({
			activeRows: [{ employeeId: "emp-1" }, { employeeId: "emp-outside-org" }],
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
		expect(result.data).toEqual({ "emp-1": "clocked-in" });
	});
});
