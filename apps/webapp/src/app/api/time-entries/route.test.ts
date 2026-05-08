import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const limit = vi.fn();
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	const values = vi.fn(async () => undefined);
	const insert = vi.fn(() => ({ values }));

	return {
		connection: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		insert,
		limit,
		runPromise: vi.fn(),
		select,
		values,
	};
});

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: mockState.connection,
	};
});

vi.mock("@/db", () => ({
	db: {
		insert: mockState.insert,
		select: mockState.select,
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "employee.id",
		isActive: "employee.isActive",
		organizationId: "employee.organizationId",
		userId: "employee.userId",
	},
	workPeriod: {
		id: "workPeriod.id",
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAbility: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
	ForbiddenError: class ForbiddenError extends Error {},
	toHttpError: vi.fn(() => ({ body: { error: "Forbidden" }, status: 403 })),
}));

vi.mock("@/lib/effect/runtime", () => ({
	runtime: {
		runPromise: mockState.runPromise,
	},
}));

vi.mock("@/lib/effect/services/time-entry.service", () => ({
	TimeEntryService: Symbol("TimeEntryService"),
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
	isNull: (column: unknown) => ({ column, type: "isNull" }),
}));

const { POST } = await import("./route");

describe("POST /api/time-entries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			user: { id: "user-1" },
		});
		mockState.limit.mockResolvedValue([
			{
				id: "employee-1",
				organizationId: "org-1",
			},
		]);
		mockState.runPromise.mockResolvedValue({ id: "entry-1" });
		mockState.values.mockResolvedValue(undefined);
	});

	it("persists workLocationType from offline clock-in requests", async () => {
		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_in",
					timestamp: "2026-05-04T09:00:00.000Z",
					workLocationType: "remote",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(201);
		expect(mockState.values).toHaveBeenCalledWith(
			expect.objectContaining({
				workLocationType: "remote",
			}),
		);
	});

	it("defaults offline clock-in requests to office work location", async () => {
		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_in",
					timestamp: "2026-05-04T09:00:00.000Z",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(201);
		expect(mockState.values).toHaveBeenCalledWith(
			expect.objectContaining({
				workLocationType: "office",
			}),
		);
	});
});
