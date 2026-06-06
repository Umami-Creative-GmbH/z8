import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const limit = vi.fn();
	const orderBy = vi.fn(async () => []);
	const where = vi.fn(() => ({ limit, orderBy }));
	const innerJoin = vi.fn(() => ({ where }));
	const from = vi.fn(() => ({ innerJoin, where }));
	const select = vi.fn(() => ({ from }));
	const returning = vi.fn(async () => [{ id: "holiday-1" }]);
	const values = vi.fn(() => ({ returning }));
	const insert = vi.fn(() => ({ values }));

	return {
		connection: vi.fn(),
		from,
		getAbility: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		innerJoin,
		insert,
		limit,
		orderBy,
		returning,
		select,
		values,
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
		insert: mockState.insert,
		select: mockState.select,
	},
}));

vi.mock("@/db/schema", () => ({
	holiday: {
		categoryId: "holiday.categoryId",
		createdBy: "holiday.createdBy",
		description: "holiday.description",
		endDate: "holiday.endDate",
		id: "holiday.id",
		isActive: "holiday.isActive",
		name: "holiday.name",
		organizationId: "holiday.organizationId",
		recurrenceEndDate: "holiday.recurrenceEndDate",
		recurrenceRule: "holiday.recurrenceRule",
		recurrenceType: "holiday.recurrenceType",
		startDate: "holiday.startDate",
	},
	holidayCategory: {
		color: "holidayCategory.color",
		id: "holidayCategory.id",
		name: "holidayCategory.name",
		organizationId: "holidayCategory.organizationId",
		type: "holidayCategory.type",
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
	getAbility: mockState.getAbility,
}));

vi.mock("@/lib/authorization", () => ({
	ForbiddenError: class ForbiddenError extends Error {},
	toHttpError: vi.fn(() => ({ body: { error: "Forbidden" }, status: 403 })),
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
}));

const { GET, POST } = await import("./route");

function createPostRequest(body: Record<string, unknown>) {
	return {
		json: vi.fn(async () => body),
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

describe("POST /api/org-admin/holidays", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => false),
		});
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			user: { id: "user-1" },
		});
		mockState.headers.mockResolvedValue(new Headers());
		mockState.limit.mockResolvedValue([{ id: "category-1", organizationId: "org-1" }]);
	});

	it("rejects a category that does not belong to the active organization before insert", async () => {
		mockState.limit.mockResolvedValueOnce([]);

		const response = await POST(
			createPostRequest({
				categoryId: "category-foreign",
				endDate: "2026-12-25",
				name: "Christmas",
				recurrenceType: "yearly",
				startDate: "2026-12-25",
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid holiday category" });
		expectAndPredicateIncludes(mockState.where.mock.calls[0]?.[0], [
			{ column: "holidayCategory.id", value: "category-foreign" },
			{ column: "holidayCategory.organizationId", value: "org-1" },
		]);
		expect(mockState.insert).not.toHaveBeenCalled();
	});
});

describe("GET /api/org-admin/holidays", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => false),
		});
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			user: { id: "user-1" },
		});
		mockState.headers.mockResolvedValue(new Headers());
		mockState.orderBy.mockResolvedValue([]);
	});

	it("scopes the holiday category join to the active organization", async () => {
		const response = await GET({} as never);

		expect(response.status).toBe(200);
		expectAndPredicateIncludes(mockState.innerJoin.mock.calls[0]?.[1], [
			{ column: "holiday.categoryId", value: "holidayCategory.id" },
			{ column: "holidayCategory.organizationId", value: "org-1" },
		]);
		expect(mockState.where).toHaveBeenCalledWith({
			column: "holiday.organizationId",
			type: "eq",
			value: "org-1",
		});
	});
});
