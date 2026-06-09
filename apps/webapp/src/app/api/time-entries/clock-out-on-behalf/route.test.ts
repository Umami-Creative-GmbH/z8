import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const limit = vi.fn();
	const where = vi.fn(() => ({ limit }));
	const innerJoin = vi.fn(() => ({ where }));
	const from = vi.fn(() => ({ innerJoin, where }));
	const select = vi.fn(() => ({ from }));

	const txLimit = vi.fn();
	const txWhere = vi.fn(() => ({ limit: txLimit }));
	const txFrom = vi.fn(() => ({ where: txWhere }));
	const txSelect = vi.fn(() => ({ from: txFrom }));
	const txExecute = vi.fn(async () => undefined);
	const updateReturning = vi.fn(async () => [{ id: "period-1" }]);
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const txClient = { execute: txExecute, select: txSelect, update };
	const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
		callback(txClient),
	);

	return {
		asAppSubject: vi.fn((subject, data) => ({ ...data, __caslSubjectType__: subject })),
		connection: vi.fn(),
		createBillingForbiddenResponse: vi.fn(),
		createTimeEntry: vi.fn(),
		calculateAndPersistSurcharges: vi.fn(),
		checkComplianceAfterClockOut: vi.fn(),
		enforceBreaksAfterClockOut: vi.fn(),
		findUserSettings: vi.fn(),
		getAbility: vi.fn(),
		getSession: vi.fn(),
		headers: vi.fn(),
		innerJoin,
		isBillingMutationAllowed: vi.fn(),
		isValidIanaTimezone: vi.fn(),
		markEmployeeWorkBalanceDirty: vi.fn(),
		limit,
		requireBillingForMutation: vi.fn(),
		resolveFallbackTimezoneCapture: vi.fn(),
		select,
		transaction,
		txClient,
		txExecute,
		txLimit,
		txSelect,
		update,
		updateReturning,
		updateSet,
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
		query: {
			userSettings: { findFirst: mockState.findUserSettings },
		},
		select: mockState.select,
		transaction: mockState.transaction,
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
		organizationId: "timeEntry.organizationId",
	},
	userSettings: { userId: "userSettings.userId" },
	workPeriod: {
		clockOutId: "workPeriod.clockOutId",
		deletedAt: "workPeriod.deletedAt",
		durationMinutes: "workPeriod.durationMinutes",
		employeeId: "workPeriod.employeeId",
		endTime: "workPeriod.endTime",
		id: "workPeriod.id",
		isActive: "workPeriod.isActive",
		organizationId: "workPeriod.organizationId",
		startTime: "workPeriod.startTime",
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
	asAppSubject: mockState.asAppSubject,
	ForbiddenError: class ForbiddenError extends Error {},
	toHttpError: vi.fn(() => ({ body: { error: "Forbidden" }, status: 403 })),
}));

vi.mock("@/lib/billing/guard", () => ({
	createBillingForbiddenResponse: mockState.createBillingForbiddenResponse,
	isBillingMutationAllowed: mockState.isBillingMutationAllowed,
	requireBillingForMutation: mockState.requireBillingForMutation,
}));

vi.mock("@/lib/time-tracking/timezone-capture", () => ({
	isValidIanaTimezone: mockState.isValidIanaTimezone,
	resolveFallbackTimezoneCapture: mockState.resolveFallbackTimezoneCapture,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/entry-helpers", () => ({
	createTimeEntry: mockState.createTimeEntry,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/compliance", () => ({
	calculateAndPersistSurcharges: mockState.calculateAndPersistSurcharges,
	checkComplianceAfterClockOut: mockState.checkComplianceAfterClockOut,
	enforceBreaksAfterClockOut: mockState.enforceBreaksAfterClockOut,
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mockState.markEmployeeWorkBalanceDirty,
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
	isNull: (column: unknown) => ({ column, type: "isNull" }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, type: "sql", values }),
}));

const { POST } = await import("./route");

const now = new Date("2026-06-09T10:30:00.000Z");

const actorEmployee = {
	id: "actor-employee-1",
	organizationId: "org-1",
	userId: "actor-user-1",
};

const targetEmployee = {
	id: "target-employee-1",
	organizationId: "org-1",
	userId: "target-user-1",
};

const runningPeriod = {
	endTime: null,
	id: "period-1",
	isActive: true,
	organizationId: "org-1",
	startTime: new Date("2026-06-09T08:00:00.000Z"),
};

function createRequest(body: unknown) {
	return new Request("https://z8.test/api/time-entries/clock-out-on-behalf", {
		body: JSON.stringify(body),
		method: "POST",
	}) as never;
}

function loadedPeriod(period = runningPeriod) {
	return { period, targetEmployee };
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

describe("POST /api/time-entries/clock-out-on-behalf", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
		vi.clearAllMocks();
		mockState.asAppSubject.mockImplementation((subject, data) => ({
			...data,
			__caslSubjectType__: subject,
		}));
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			user: { id: "actor-user-1" },
		});
		mockState.limit.mockResolvedValue([]);
		mockState.limit
			.mockResolvedValueOnce([actorEmployee])
			.mockResolvedValueOnce([loadedPeriod()]);
		mockState.txLimit.mockResolvedValue([runningPeriod]);
		mockState.getAbility.mockResolvedValue({ can: vi.fn(() => true) });
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.createBillingForbiddenResponse.mockImplementation((access) =>
			Response.json({ error: "billing_required", reason: access.reason }, { status: 402 }),
		);
		mockState.findUserSettings.mockResolvedValue({ timezone: "Europe/Berlin" });
		mockState.isValidIanaTimezone.mockImplementation((timezone) => timezone === "Europe/Berlin");
		mockState.resolveFallbackTimezoneCapture.mockReturnValue({
			timezone: "Europe/Berlin",
			timezoneSource: "manager_target_user_setting",
			utcOffsetMinutes: 120,
		});
		mockState.createTimeEntry.mockResolvedValue({ id: "clock-out-entry-1" });
		mockState.calculateAndPersistSurcharges.mockResolvedValue(undefined);
		mockState.checkComplianceAfterClockOut.mockResolvedValue([]);
		mockState.enforceBreaksAfterClockOut.mockResolvedValue({ wasAdjusted: false });
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.txExecute.mockResolvedValue(undefined);
		mockState.updateReturning.mockResolvedValue([{ id: "period-1" }]);
	});

	it("closes a target running period at the current server time", async () => {
		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ entry: { id: "clock-out-entry-1" } });
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				createdBy: "actor-user-1",
				employeeId: "target-employee-1",
				organizationId: "org-1",
				timestamp: now,
				timezone: "Europe/Berlin",
				timezoneSource: "manager_target_user_setting",
				type: "clock_out",
			}),
			mockState.txClient,
		);
		expect(mockState.findUserSettings).toHaveBeenCalledWith(
			expect.objectContaining({ columns: { timezone: true } }),
		);
		expect(mockState.resolveFallbackTimezoneCapture).toHaveBeenCalledWith({
			timestamp: now,
			timezone: "Europe/Berlin",
			timezoneSource: "manager_target_user_setting",
		});
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				clockOutId: "clock-out-entry-1",
				durationMinutes: 150,
				endTime: now,
				isActive: false,
			}),
		);
		expect(mockState.txExecute).toHaveBeenCalledWith(
			expect.objectContaining({ values: ["org-1:target-employee-1"] }),
		);
	});

	it("runs clock-out domain side effects after successfully closing the target period", async () => {
		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(201);
		expect(mockState.calculateAndPersistSurcharges).toHaveBeenCalledWith("period-1", "org-1");
		expect(mockState.checkComplianceAfterClockOut).toHaveBeenCalledWith(
			"target-employee-1",
			"org-1",
			"period-1",
			150,
			"Europe/Berlin",
		);
		expect(mockState.enforceBreaksAfterClockOut).toHaveBeenCalledWith({
			createdBy: "actor-user-1",
			employeeId: "target-employee-1",
			organizationId: "org-1",
			sessionDurationMinutes: 150,
			timezone: "Europe/Berlin",
			workPeriodId: "period-1",
		});
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			dirtyFromDate: "2026-06-09",
			employeeId: "target-employee-1",
			organizationId: "org-1",
		});
		expect(mockState.calculateAndPersistSurcharges.mock.invocationCallOrder[0]).toBeGreaterThan(
			mockState.transaction.mock.invocationCallOrder[0],
		);
		expect(mockState.enforceBreaksAfterClockOut.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.calculateAndPersistSurcharges.mock.invocationCallOrder[0],
		);
	});

	it("keeps a successful clock-out response when work balance dirty marking fails", async () => {
		mockState.markEmployeeWorkBalanceDirty.mockRejectedValueOnce(new Error("dirty marker failed"));

		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ entry: { id: "clock-out-entry-1" } });
		expect(mockState.calculateAndPersistSurcharges).toHaveBeenCalledWith("period-1", "org-1");
		expect(mockState.checkComplianceAfterClockOut).toHaveBeenCalledWith(
			"target-employee-1",
			"org-1",
			"period-1",
			150,
			"Europe/Berlin",
		);
		expect(mockState.enforceBreaksAfterClockOut).toHaveBeenCalledWith(
			expect.objectContaining({ workPeriodId: "period-1" }),
		);
	});

	it("marks work balance dirty again when break enforcement adjusts the closed period", async () => {
		mockState.enforceBreaksAfterClockOut.mockResolvedValueOnce({ wasAdjusted: true });

		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(201);
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledTimes(2);
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenLastCalledWith({
			dirtyFromDate: "2026-06-09",
			employeeId: "target-employee-1",
			organizationId: "org-1",
		});
	});

	it("returns 403 and does not create a time entry when ability denies access", async () => {
		const ability = { can: vi.fn(() => false) };
		mockState.getAbility.mockResolvedValue(ability);

		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Forbidden" });
		expect(ability.can).toHaveBeenCalledWith(
			"manage",
			expect.objectContaining({ employeeId: "target-employee-1", organizationId: "org-1" }),
		);
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("returns 403 and does not create a time entry when actor targets their own running period", async () => {
		mockState.limit.mockReset();
		mockState.limit
			.mockResolvedValueOnce([actorEmployee])
			.mockResolvedValueOnce([{ period: runningPeriod, targetEmployee: actorEmployee }]);

		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Forbidden" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.transaction).not.toHaveBeenCalled();
	});

	it("returns 404 for a missing or cross-organization work period", async () => {
		mockState.limit.mockReset();
		mockState.limit.mockResolvedValueOnce([actorEmployee]).mockResolvedValueOnce([]);

		const response = await POST(createRequest({ workPeriodId: "foreign-period" }));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Work period not found" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("scopes target period lookup to active employees in the active organization", async () => {
		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(201);
		expectAndPredicateIncludes(mockState.where.mock.calls[1]?.[0], [
			{ column: "workPeriod.id", value: "period-1" },
			{ column: "workPeriod.organizationId", value: "org-1" },
			{ column: "employee.organizationId", value: "org-1" },
			{ column: "employee.isActive", value: true },
		]);
	});

	it("returns 409 when the loaded work period is already stopped", async () => {
		mockState.limit.mockReset();
		mockState.limit
			.mockResolvedValueOnce([actorEmployee])
			.mockResolvedValueOnce([
				loadedPeriod({
					...runningPeriod,
					endTime: new Date("2026-06-09T09:00:00.000Z"),
					isActive: false,
				}),
			]);

		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Work period is no longer running" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("returns 409 when the guarded update loses a race", async () => {
		mockState.updateReturning.mockResolvedValueOnce([]);

		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Active work period changed" });
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(expect.anything(), mockState.txClient);
	});

	it("requires a workPeriodId string", async () => {
		const response = await POST(createRequest({ workPeriodId: 42 }));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "workPeriodId is required" });
		expect(mockState.getSession).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("rejects unauthenticated requests", async () => {
		mockState.getSession.mockResolvedValue(null);

		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("returns billing guard response before writing", async () => {
		mockState.requireBillingForMutation.mockResolvedValue({
			canAccess: false,
			reason: "trial_expired",
		});
		mockState.isBillingMutationAllowed.mockReturnValue(false);

		const response = await POST(createRequest({ workPeriodId: "period-1" }));

		expect(mockState.requireBillingForMutation).toHaveBeenCalledWith("org-1");
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({ error: "billing_required", reason: "trial_expired" });
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});
});
