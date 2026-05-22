import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	class UnsupportedAuthorizationConditionError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "UnsupportedAuthorizationConditionError";
		}
	}

	const limit = vi.fn();
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	const values = vi.fn(async () => undefined);
	const insert = vi.fn(() => ({ values }));

	return {
		UnsupportedAuthorizationConditionError,
		accessibleByDrizzle: vi.fn(),
		asAppSubject: vi.fn((subject, data) => ({ ...data, __caslSubjectType__: subject })),
		connection: vi.fn(),
		createBillingForbiddenResponse: vi.fn(),
		getAbility: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		insert,
		isBillingMutationAllowed: vi.fn(),
		limit,
		requireBillingForMutation: vi.fn(),
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
		employeeId: "workPeriod.employeeId",
		id: "workPeriod.id",
		organizationId: "workPeriod.organizationId",
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

vi.mock("@/lib/billing/guard", () => ({
	createBillingForbiddenResponse: mockState.createBillingForbiddenResponse,
	isBillingMutationAllowed: mockState.isBillingMutationAllowed,
	requireBillingForMutation: mockState.requireBillingForMutation,
}));

vi.mock("@/lib/authorization", () => ({
	UnsupportedAuthorizationConditionError: mockState.UnsupportedAuthorizationConditionError,
	accessibleByDrizzle: mockState.accessibleByDrizzle,
	asAppSubject: mockState.asAppSubject,
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

const { GET, POST } = await import("./route");

function createGetRequest(employeeId: string) {
	return {
		nextUrl: new URL(`https://z8.test/api/time-entries?employeeId=${employeeId}`),
	} as never;
}

describe("GET /api/time-entries authorization source", () => {
	it("uses CASL query adapter and subject checks for time entry reads", () => {
		const source = readFileSync("src/app/api/time-entries/route.ts", "utf8");

		expect(source).toContain("accessibleByDrizzle");
		expect(source).toContain("asAppSubject");
		expect(source).toContain("TimeEntry");
		expect(source).toContain("workPeriod.organizationId");
		expect(source).toContain("workPeriod.employeeId");
	});
});

describe("GET /api/time-entries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.accessibleByDrizzle.mockReset();
		mockState.asAppSubject.mockReset();
		mockState.getAbility.mockReset();
		mockState.getSession.mockReset();
		mockState.headers.mockReset();
		mockState.limit.mockReset();
		mockState.runPromise.mockReset();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			user: { id: "user-1" },
		});
		mockState.accessibleByDrizzle.mockReturnValue({ type: "sql" });
		mockState.asAppSubject.mockImplementation((subject, data) => ({
			...data,
			__caslSubjectType__: subject,
		}));
		mockState.getAbility.mockResolvedValue({
			can: vi.fn(() => true),
		});
		mockState.limit.mockResolvedValue([
			{
				id: "employee-1",
				organizationId: "org-1",
			},
		]);
		mockState.runPromise.mockResolvedValue([{ id: "entry-1" }]);
	});

	it("allows direct-report reads when the query adapter cannot translate legacy rules", async () => {
		const ability = { can: vi.fn(() => true) };
		mockState.getAbility.mockResolvedValue(ability);
		mockState.accessibleByDrizzle.mockImplementation(() => {
			throw new mockState.UnsupportedAuthorizationConditionError(
				"Unconditional database authorization is not supported",
			);
		});
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([{ id: "employee-2", organizationId: "org-1" }]);

		const response = await GET(createGetRequest("employee-2"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ entries: [{ id: "entry-1" }] });
		expect(ability.can).toHaveBeenCalledWith(
			"read",
			expect.objectContaining({
				employeeId: "employee-2",
				organizationId: "org-1",
			}),
		);
		expect(mockState.runPromise).toHaveBeenCalledTimes(1);
	});

	it("returns 403 for cross-employee reads without an ability", async () => {
		mockState.getAbility.mockResolvedValue(undefined);
		mockState.limit.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }]);

		const response = await GET(createGetRequest("employee-2"));

		expect(response.status).toBe(403);
		expect(mockState.accessibleByDrizzle).not.toHaveBeenCalled();
		expect(mockState.runPromise).not.toHaveBeenCalled();
	});

	it("returns 403 for same-organization targets denied by record authorization", async () => {
		const ability = { can: vi.fn(() => false) };
		mockState.getAbility.mockResolvedValue(ability);
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([{ id: "employee-2", organizationId: "org-1" }]);

		const response = await GET(createGetRequest("employee-2"));

		expect(response.status).toBe(403);
		expect(ability.can).toHaveBeenCalledWith(
			"read",
			expect.objectContaining({
				employeeId: "employee-2",
				organizationId: "org-1",
			}),
		);
		expect(mockState.runPromise).not.toHaveBeenCalled();
	});

	it("returns 404 for cross-organization or missing targets before fetching entries", async () => {
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([]);

		const response = await GET(createGetRequest("employee-2"));

		expect(response.status).toBe(404);
		expect(mockState.runPromise).not.toHaveBeenCalled();
	});
});

describe("POST /api/time-entries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.accessibleByDrizzle.mockReset();
		mockState.asAppSubject.mockReset();
		mockState.getAbility.mockReset();
		mockState.getSession.mockReset();
		mockState.headers.mockReset();
		mockState.limit.mockReset();
		mockState.runPromise.mockReset();
		mockState.values.mockReset();
		mockState.requireBillingForMutation.mockReset();
		mockState.isBillingMutationAllowed.mockReset();
		mockState.createBillingForbiddenResponse.mockReset();
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
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.createBillingForbiddenResponse.mockImplementation((access) =>
			Response.json(
				{ error: "billing_required", reason: access.reason ?? "subscription_required" },
				{ status: 402 },
			),
		);
	});

	it("rejects writes when billing access is suspended", async () => {
		mockState.requireBillingForMutation.mockResolvedValue({
			canAccess: false,
			reason: "trial_expired",
		});
		mockState.isBillingMutationAllowed.mockReturnValue(false);

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_in",
					timestamp: "2026-05-04T09:00:00.000Z",
				}),
				method: "POST",
			}) as never,
		);

		expect(mockState.requireBillingForMutation).toHaveBeenCalledWith("org-1");
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({
			error: "billing_required",
			reason: "trial_expired",
		});
		expect(mockState.runPromise).not.toHaveBeenCalled();
		expect(mockState.values).not.toHaveBeenCalled();
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
