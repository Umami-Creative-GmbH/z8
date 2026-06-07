import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const limit = vi.fn();
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	const returning = vi.fn(async () => [{ id: "holiday-1" }]);
	const updateWhere = vi.fn(() => ({ returning }));
	const set = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set }));

	return {
		connection: vi.fn(),
		from,
		getAbility: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		limit,
		returning,
		select,
		set,
		update,
		updateWhere,
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
		update: mockState.update,
	},
}));

vi.mock("@/db/schema", () => ({
	holiday: {
		categoryId: "holiday.categoryId",
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
		updatedBy: "holiday.updatedBy",
	},
	holidayCategory: {
		id: "holidayCategory.id",
		organizationId: "holidayCategory.organizationId",
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

const { PATCH } = await import("./route");

function createPatchRequest(body: Record<string, unknown>) {
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

describe("PATCH /api/org-admin/holidays/[id]", () => {
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
		mockState.limit.mockResolvedValue([{ id: "holiday-1", organizationId: "org-1" }]);
	});

	it("rejects a category that does not belong to the active organization before update", async () => {
		mockState.limit
			.mockResolvedValueOnce([{ id: "holiday-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([]);

		const response = await PATCH(createPatchRequest({ categoryId: "category-foreign" }), {
			params: Promise.resolve({ id: "holiday-1" }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid holiday category" });
		expectAndPredicateIncludes(mockState.where.mock.calls[1]?.[0], [
			{ column: "holidayCategory.id", value: "category-foreign" },
			{ column: "holidayCategory.organizationId", value: "org-1" },
		]);
		expect(mockState.update).not.toHaveBeenCalled();
	});
});
