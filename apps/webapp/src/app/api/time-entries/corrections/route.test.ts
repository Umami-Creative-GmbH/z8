import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const limit = vi.fn();
	const where = vi.fn(() => {
		const result = [] as unknown[] & { limit: typeof limit };
		result.limit = limit;
		return result;
	});
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));

	return {
		canApproveFor: vi.fn(),
		connection: vi.fn(),
		from,
		getAbility: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		limit,
		runPromise: vi.fn(),
		select,
		where,
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
	timeEntry: {
		employeeId: "timeEntry.employeeId",
		id: "timeEntry.id",
		organizationId: "timeEntry.organizationId",
		replacesEntryId: "timeEntry.replacesEntryId",
		type: "timeEntry.type",
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
	canApproveFor: mockState.canApproveFor,
	getAbility: mockState.getAbility,
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

vi.mock("@/lib/time-tracking/timezone-capture", () => ({
	resolveFallbackTimezoneCapture: vi.fn(() => ({
		timezone: "UTC",
		timezoneSource: "user_setting",
		utcOffsetMinutes: 0,
	})),
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
}));

const { GET } = await import("./route");

function createGetRequest(query = "") {
	return {
		nextUrl: new URL(`https://z8.test/api/time-entries/corrections${query}`),
	} as never;
}

function expectAndPredicateIncludes(
	predicate: unknown,
	expected: Array<{ column: string; value: unknown }>,
) {
	expect(predicate).toEqual(
		expect.objectContaining({
			conditions: expect.arrayContaining(
				expected.map(({ column, value }) => expect.objectContaining({ column, value })),
			),
			type: "and",
		}),
	);
}

describe("GET /api/time-entries/corrections", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getAbility.mockReset();
		mockState.getSession.mockReset();
		mockState.headers.mockReset();
		mockState.limit.mockReset();
		mockState.runPromise.mockReset();
		mockState.where.mockClear();
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
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => false),
		});
	});

	it("includes the active organization in correction history queries", async () => {
		const response = await GET(createGetRequest());

		expect(response.status).toBe(200);
		expectAndPredicateIncludes(mockState.where.mock.calls.at(-1)?.[0], [
			{ column: "timeEntry.type", value: "correction" },
			{ column: "timeEntry.organizationId", value: "org-1" },
			{ column: "timeEntry.employeeId", value: "employee-1" },
		]);
	});

	it("looks up an entryId by id and active organization before returning correction history", async () => {
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([]);

		const response = await GET(createGetRequest("?entryId=entry-foreign"));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Entry not found" });
		expectAndPredicateIncludes(mockState.where.mock.calls[1]?.[0], [
			{ column: "timeEntry.id", value: "entry-foreign" },
			{ column: "timeEntry.organizationId", value: "org-1" },
		]);
	});

	it("returns 404 before accepting an employeeId outside the active organization", async () => {
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([]);

		const response = await GET(createGetRequest("?employeeId=employee-foreign"));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Employee not found" });
		expectAndPredicateIncludes(mockState.where.mock.calls[1]?.[0], [
			{ column: "employee.id", value: "employee-foreign" },
			{ column: "employee.organizationId", value: "org-1" },
			{ column: "employee.isActive", value: true },
		]);
		expect(mockState.getAbility).not.toHaveBeenCalled();
	});

	it("preserves CASL checks for non-self employee correction reads", async () => {
		const ability = { cannot: vi.fn(() => true) };
		mockState.getAbility.mockResolvedValue(ability);
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([{ id: "employee-2", organizationId: "org-1" }]);

		const response = await GET(createGetRequest("?employeeId=employee-2"));

		expect(response.status).toBe(403);
		expect(ability.cannot).toHaveBeenCalledWith("manage", "TimeEntry");
	});
});
