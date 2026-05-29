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
	const updateReturning = vi.fn(async () => [{ id: "period-1" }]);
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const txLimit = vi.fn();
	const txWhere = vi.fn(() => ({ limit: txLimit }));
	const txFrom = vi.fn(() => ({ where: txWhere }));
	const txSelect = vi.fn(() => ({ from: txFrom }));
	const txExecute = vi.fn(async () => undefined);
	const txClient = { execute: txExecute, insert, select, update };
	const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
		callback(txClient),
	);

	return {
		UnsupportedAuthorizationConditionError,
		accessibleByDrizzle: vi.fn(),
		asAppSubject: vi.fn((subject, data) => ({ ...data, __caslSubjectType__: subject })),
		connection: vi.fn(),
		createBillingForbiddenResponse: vi.fn(),
		createTimeEntry: vi.fn(),
		employeeHasAccessToCategory: vi.fn(),
		getAbility: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		insert,
		isBillingMutationAllowed: vi.fn(),
		limit,
		requireBillingForMutation: vi.fn(),
		runPromise: vi.fn(),
		select,
		transaction,
		txFrom,
		txLimit,
		txSelect,
		txWhere,
		txClient,
		txExecute,
		update,
		updateReturning,
		updateSet,
		updateWhere,
		values,
		validateProjectAssignment: vi.fn(),
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
		query: {
			userSettings: { findFirst: vi.fn(async () => ({ timezone: "Europe/Berlin" })) },
		},
		select: mockState.select,
		transaction: mockState.transaction,
		update: mockState.update,
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "employee.id",
		isActive: "employee.isActive",
		organizationId: "employee.organizationId",
		userId: "employee.userId",
	},
	project: {
		id: "project.id",
		organizationId: "project.organizationId",
	},
	projectAssignment: {
		projectId: "projectAssignment.projectId",
		organizationId: "projectAssignment.organizationId",
		employeeId: "projectAssignment.employeeId",
		teamId: "projectAssignment.teamId",
	},
	timeEntry: {
		employeeId: "timeEntry.employeeId",
		organizationId: "timeEntry.organizationId",
	},
	workPeriod: {
		endTime: "workPeriod.endTime",
		employeeId: "workPeriod.employeeId",
		id: "workPeriod.id",
		isActive: "workPeriod.isActive",
		organizationId: "workPeriod.organizationId",
	},
	workCategory: {
		id: "workCategory.id",
		isActive: "workCategory.isActive",
		organizationId: "workCategory.organizationId",
	},
	userSettings: { userId: "userSettings.userId" },
}));

vi.mock("@/lib/query/work-category.queries", () => ({
	employeeHasAccessToCategory: mockState.employeeHasAccessToCategory,
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

vi.mock("@/app/[locale]/(app)/time-tracking/actions/entry-helpers", () => ({
	createTimeEntry: mockState.createTimeEntry,
	validateProjectAssignment: mockState.validateProjectAssignment,
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
	isNull: (column: unknown) => ({ column, type: "isNull" }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, type: "sql", values }),
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
		expect(source).toContain("timeEntry.organizationId");
		expect(source).toContain("timeEntry.employeeId");
		expect(source).toContain("authorizationPredicate");
	});
});

describe("GET /api/time-entries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.accessibleByDrizzle.mockReset();
		mockState.asAppSubject.mockReset();
		mockState.createTimeEntry.mockReset();
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

	it("passes translated authorization predicates to the time entry service", async () => {
		const predicate = { type: "sql", source: "time-entry-access" };
		mockState.accessibleByDrizzle.mockReturnValue(predicate);
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([{ id: "employee-2", organizationId: "org-1" }]);

		const source = readFileSync("src/app/api/time-entries/route.ts", "utf8");
		const response = await GET(createGetRequest("employee-2"));

		expect(response.status).toBe(200);
		expect(mockState.accessibleByDrizzle).toHaveBeenCalledWith(
			expect.anything(),
			"read",
			"TimeEntry",
			expect.objectContaining({
				employeeId: "timeEntry.employeeId",
				organizationId: "timeEntry.organizationId",
			}),
		);
		expect(source).toContain("authorizationPredicate: timeEntryAccess ?? undefined");
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
		mockState.transaction.mockClear();
		mockState.txLimit.mockReset();
		mockState.txExecute.mockReset();
		mockState.txSelect.mockClear();
		mockState.txFrom.mockClear();
		mockState.txWhere.mockClear();
		mockState.update.mockClear();
		mockState.updateReturning.mockReset();
		mockState.updateSet.mockClear();
		mockState.updateWhere.mockClear();
		mockState.values.mockReset();
		mockState.validateProjectAssignment.mockReset();
		mockState.requireBillingForMutation.mockReset();
		mockState.isBillingMutationAllowed.mockReset();
		mockState.createBillingForbiddenResponse.mockReset();
		mockState.employeeHasAccessToCategory.mockReset();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			user: { id: "user-1" },
		});
		mockState.limit
			.mockResolvedValueOnce([
				{
					id: "employee-1",
					organizationId: "org-1",
					teamId: "team-1",
				},
			])
			.mockResolvedValue([]);
		mockState.txClient.select = mockState.txSelect;
		mockState.txClient.execute = mockState.txExecute;
		mockState.txLimit.mockResolvedValue([]);
		mockState.txExecute.mockResolvedValue(undefined);
		mockState.createTimeEntry.mockResolvedValue({ id: "entry-1" });
		mockState.runPromise.mockResolvedValue({ id: "entry-1" });
		mockState.values.mockResolvedValue(undefined);
		mockState.updateReturning.mockResolvedValue([{ id: "period-1" }]);
		mockState.validateProjectAssignment.mockResolvedValue({ isValid: true });
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.createBillingForbiddenResponse.mockImplementation((access) =>
			Response.json(
				{ error: "billing_required", reason: access.reason ?? "subscription_required" },
				{ status: 402 },
			),
		);
		mockState.employeeHasAccessToCategory.mockResolvedValue(true);
	});

	it("checks duplicate clock-in state inside the transaction before inserting", async () => {
		mockState.limit.mockReset();
		mockState.limit.mockResolvedValueOnce([
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
		]);
		mockState.txLimit.mockResolvedValueOnce([
			{ id: "period-1", startTime: new Date("2026-05-04T08:00:00.000Z") },
		]);

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_in",
					timestamp: "2026-05-04T09:00:00.000Z",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Active work period already exists" });
		expect(mockState.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.txSelect).toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("passes offline location into the transactional time entry insert", async () => {
		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_in",
					timestamp: "2026-05-04T09:00:00.000Z",
					location: "48.137,11.575",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(201);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({ location: "48.137,11.575" }),
			expect.anything(),
		);
	});

	it("acquires a per-employee transaction lock before active period lookup", async () => {
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
		expect(mockState.txExecute).toHaveBeenCalledWith(
			expect.objectContaining({
				strings: expect.arrayContaining([
					"select pg_advisory_xact_lock(hashtextextended(",
					", 0))",
				]),
				values: ["org-1:employee-1"],
			}),
		);
		expect(mockState.txExecute.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.txSelect.mock.invocationCallOrder[0],
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

	it("inserts the time entry with the transaction client before creating the work period", async () => {
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
		expect(mockState.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({ type: "clock_in" }),
			mockState.txClient,
		);
		expect(mockState.createTimeEntry.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.values.mock.invocationCallOrder[0],
		);
	});

	it("returns an error when the transactional work period insert fails", async () => {
		mockState.values.mockRejectedValueOnce(new Error("insert failed"));

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_in",
					timestamp: "2026-05-04T09:00:00.000Z",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(500);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(expect.anything(), mockState.txClient);
	});

	it("ignores generic timezone for capture fallback and uses saved user timezone", async () => {
		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_in",
					timestamp: "2026-05-04T09:00:00.000Z",
					timezone: "America/New_York",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(201);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
			}),
			expect.anything(),
		);
	});

	it("rejects clock-out without an active work period before inserting a time entry", async () => {
		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_out",
					timestamp: "2026-05-04T09:00:00.000Z",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "No active work period found" });
		expect(mockState.runPromise).not.toHaveBeenCalled();
		expect(mockState.values).not.toHaveBeenCalled();
	});

	it("rejects duplicate clock-in when an active work period already exists", async () => {
		mockState.limit.mockReset();
		mockState.limit.mockResolvedValueOnce([
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
		]);
		mockState.txLimit.mockResolvedValueOnce([
			{ id: "period-1", startTime: new Date("2026-05-04T08:00:00.000Z") },
		]);

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_in",
					timestamp: "2026-05-04T09:00:00.000Z",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Active work period already exists" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.values).not.toHaveBeenCalled();
	});

	it("rejects cross-organization work categories before inserting a clock-out entry", async () => {
		mockState.limit.mockReset();
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1", teamId: "team-1" }])
			.mockResolvedValueOnce([]);

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_out",
					timestamp: "2026-05-04T09:00:00.000Z",
					workCategoryId: "foreign-category-1",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Work category not found" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("rejects unavailable work categories before inserting a clock-out entry", async () => {
		mockState.limit.mockReset();
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1", teamId: "team-1" }])
			.mockResolvedValueOnce([{ id: "category-1", organizationId: "org-1", isActive: true }]);
		mockState.employeeHasAccessToCategory.mockResolvedValueOnce(false);

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_out",
					timestamp: "2026-05-04T09:00:00.000Z",
					workCategoryId: "category-1",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Cannot assign to this work category" });
		expect(mockState.employeeHasAccessToCategory).toHaveBeenCalledWith(
			"employee-1",
			"category-1",
		);
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("rolls back clock-out time entry when the active period update loses the race", async () => {
		mockState.limit.mockReset();
		mockState.limit.mockResolvedValueOnce([
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
		]);
		mockState.txLimit.mockResolvedValueOnce([
			{ id: "period-1", startTime: new Date("2026-05-04T08:00:00.000Z") },
		]);
		mockState.updateReturning.mockResolvedValueOnce([]);

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_out",
					timestamp: "2026-05-04T09:00:00.000Z",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Active work period changed" });
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(expect.anything(), mockState.txClient);
		expect(mockState.transaction).toHaveBeenCalledTimes(1);
	});

	it("rejects cross-organization project ids on clock-out before inserting a time entry", async () => {
		mockState.limit.mockReset();
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1", teamId: "team-1" }])
			.mockResolvedValueOnce([]);

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_out",
					timestamp: "2026-05-04T09:00:00.000Z",
					projectId: "foreign-project-1",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Project not found" });
		expect(mockState.runPromise).not.toHaveBeenCalled();
		expect(mockState.values).not.toHaveBeenCalled();
	});

	it("rejects assigned-project validation failures before inserting a clock-out entry", async () => {
		mockState.limit.mockReset();
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1", teamId: "team-1" }])
			.mockResolvedValueOnce([{ id: "project-1", organizationId: "org-1", status: "active" }])
			.mockResolvedValueOnce([{ id: "category-1", organizationId: "org-1", isActive: true }]);
		mockState.txLimit.mockResolvedValueOnce([
			{ id: "period-1", startTime: new Date("2026-05-04T08:00:00.000Z") },
		]);
		mockState.validateProjectAssignment.mockResolvedValueOnce({
			isValid: false,
			error: "You are not assigned to this project. Contact your administrator.",
		});

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_out",
					timestamp: "2026-05-04T09:00:00.000Z",
					projectId: "project-1",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "You are not assigned to this project. Contact your administrator.",
		});
		expect(mockState.validateProjectAssignment).toHaveBeenCalledWith(
			"project-1",
			"employee-1",
			"team-1",
		);
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("persists project and work category when closing an active work period", async () => {
		mockState.limit.mockReset();
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1", teamId: "team-1" }])
			.mockResolvedValueOnce([{ id: "project-1", organizationId: "org-1", status: "active" }])
			.mockResolvedValueOnce([{ id: "category-1", organizationId: "org-1", isActive: true }]);
		mockState.txLimit.mockResolvedValueOnce([
			{ id: "period-1", startTime: new Date("2026-05-04T08:00:00.000Z") },
		]);

		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				body: JSON.stringify({
					type: "clock_out",
					timestamp: "2026-05-04T09:00:00.000Z",
					projectId: "project-1",
					workCategoryId: "category-1",
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(201);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "project-1",
				workCategoryId: "category-1",
			}),
		);
	});
});
