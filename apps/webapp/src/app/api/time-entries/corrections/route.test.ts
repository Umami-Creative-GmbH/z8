import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/lib/effect/errors";

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
		createCorrectionEntry: vi.fn(),
		createTimeCorrectionApprovalWorkflow: vi.fn(),
		createTimeEntry: vi.fn(),
		from,
		getAbility: vi.fn(),
		getSession: vi.fn(),
		getUserTimezone: vi.fn(),
		headers: vi.fn(),
		limit,
		loggerError: vi.fn(),
		markEmployeeWorkBalanceDirty: vi.fn(),
		resolveCorrectionApprovalManager: vi.fn(),
		runPromise: vi.fn(),
		select,
		transaction: vi.fn(),
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
		id: "timeEntry.id",
		isSuperseded: "timeEntry.isSuperseded",
		organizationId: "timeEntry.organizationId",
		replacesEntryId: "timeEntry.replacesEntryId",
		type: "timeEntry.type",
	},
	workPeriod: {
		clockInId: "workPeriod.clockInId",
		clockOutId: "workPeriod.clockOutId",
		deletedAt: "workPeriod.deletedAt",
		employeeId: "workPeriod.employeeId",
		id: "workPeriod.id",
		organizationId: "workPeriod.organizationId",
	},
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/auth", () => ({
	getUserTimezone: mockState.getUserTimezone,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/corrections", () => ({
	resolveCorrectionApprovalManager: mockState.resolveCorrectionApprovalManager,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/entry-helpers", () => ({
	createTimeEntry: mockState.createTimeEntry,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", () => ({
	logger: { error: mockState.loggerError },
}));

vi.mock("@/lib/approvals/server/time-correction-approvals", () => ({
	createTimeCorrectionApprovalWorkflow: mockState.createTimeCorrectionApprovalWorkflow,
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

vi.mock("@/lib/effect/services/time-entry.service", async () => {
	const { Context } = await vi.importActual<typeof import("effect")>("effect");
	return {
		TimeEntryService: Context.GenericTag("TestTimeEntryService"),
	};
});

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mockState.markEmployeeWorkBalanceDirty,
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
	isNull: (column: unknown) => ({ column, type: "isNull" }),
	or: (...conditions: unknown[]) => ({ conditions, type: "or" }),
}));

const { TimeEntryService } = await import("@/lib/effect/services/time-entry.service");
const { GET, POST } = await import("./route");

function createGetRequest(query = "") {
	return {
		nextUrl: new URL(`https://z8.test/api/time-entries/corrections${query}`),
	} as never;
}

function createPostRequest(body: Record<string, unknown>) {
	return {
		json: vi.fn().mockResolvedValue(body),
	} as never;
}

function mockPostTarget({
	currentEmployeeId = "employee-1",
	periodEnd = "2026-12-31T20:00:00.000Z",
	periodStart = "2026-01-01T06:00:00.000Z",
	targetEmployeeId = "employee-1",
	targetEntryId = "entry-clock-in",
	targetUserId = "user-1",
}: {
	currentEmployeeId?: string;
	periodEnd?: string;
	periodStart?: string;
	targetEmployeeId?: string;
	targetEntryId?: string;
	targetUserId?: string;
} = {}) {
	mockState.limit
		.mockResolvedValueOnce([
			{
				id: currentEmployeeId,
				organizationId: "org-1",
				teamId: "team-1",
				userId: "user-1",
			},
		])
		.mockResolvedValueOnce([
			{ id: targetEntryId, employeeId: targetEmployeeId, organizationId: "org-1" },
		])
		.mockResolvedValueOnce([
			{
				id: targetEmployeeId,
				organizationId: "org-1",
				teamId: "team-1",
				userId: targetUserId,
			},
		])
		.mockResolvedValueOnce([
			{
				id: "period-1",
				clockInId: "entry-clock-in",
				clockOutId: "entry-clock-out",
				startTime: new Date(periodStart),
				endTime: new Date(periodEnd),
			},
		]);
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

describe("POST /api/time-entries/corrections", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-1" },
			user: { id: "user-1" },
		});
		mockState.canApproveFor.mockResolvedValue(false);
		mockState.getUserTimezone.mockResolvedValue("Europe/Berlin");
		mockState.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mockState.resolveCorrectionApprovalManager.mockResolvedValue({
			ok: true,
			managerId: "employee-manager",
		});
		mockState.createTimeEntry.mockResolvedValue({ id: "entry-correction" });
		mockState.createTimeCorrectionApprovalWorkflow.mockReturnValue(
			Effect.succeed({ kind: "default_created", approvalRequestId: "approval-1" }),
		);
		mockState.createCorrectionEntry.mockReturnValue(
			Effect.succeed({ id: "entry-direct-correction" }),
		);
		mockState.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback({}),
		);
		mockState.runPromise.mockImplementation((effect) =>
			Effect.runPromise(
				effect.pipe(
					Effect.provideService(TimeEntryService, {
						createCorrectionEntry: mockState.createCorrectionEntry,
					} as never),
				),
			),
		);
	});

	it("scopes target entry lookup to the active organization and hides foreign targets", async () => {
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([]);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-foreign",
				timestamp: "2026-07-01T08:15:00Z",
				notes: "Foreign correction",
			}),
		);

		expect(response.status).toBe(404);
		expectAndPredicateIncludes(mockState.where.mock.calls[1]?.[0], [
			{ column: "timeEntry.id", value: "entry-foreign" },
			{ column: "timeEntry.organizationId", value: "org-1" },
		]);
		expect(mockState.canApproveFor).not.toHaveBeenCalled();
	});

	it("rejects an already superseded target before creating a pending correction", async () => {
		mockState.limit
			.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }])
			.mockResolvedValueOnce([]);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-superseded",
				timestamp: "2026-07-01T08:15:00Z",
				notes: "Duplicate correction",
			}),
		);

		expect(response.status).toBe(404);
		expectAndPredicateIncludes(mockState.where.mock.calls[1]?.[0], [
			{ column: "timeEntry.id", value: "entry-superseded" },
			{ column: "timeEntry.organizationId", value: "org-1" },
			{ column: "timeEntry.isSuperseded", value: false },
		]);
		expect(mockState.transaction).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.createTimeCorrectionApprovalWorkflow).not.toHaveBeenCalled();
	});

	it("rejects invalid correction timestamps", async () => {
		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "not-a-timestamp",
				notes: "Invalid correction",
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "timestamp must be a valid RFC3339 value with an explicit offset",
		});
		expect(mockState.select).not.toHaveBeenCalled();
	});

	it("rejects offset-less correction timestamps", async () => {
		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "2026-07-01T08:15:00",
				notes: "Offset-less correction",
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "timestamp must be a valid RFC3339 value with an explicit offset",
		});
		expect(mockState.select).not.toHaveBeenCalled();
	});

	it("rejects an invalid IANA timezone", async () => {
		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "2026-07-01T08:15:00Z",
				timezone: "Mars/Olympus_Mons",
				notes: "Invalid timezone",
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "timezone must be a valid IANA timezone" });
		expect(mockState.select).not.toHaveBeenCalled();
	});

	it.each([
		["UTC", "2026-07-01T08:15:00Z", "UTC", 0],
		["Berlin summer", "2026-07-01T08:15:00+02:00", "Europe/Berlin", 120],
		["Berlin winter", "2026-01-15T08:15:00+01:00", "Europe/Berlin", 60],
	])("derives %s timezone capture from the correction instant", async (_label, timestamp, timezone, expectedOffset) => {
		mockPostTarget();

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp,
				timezone,
				notes: "Correct clock-in",
			}),
		);

		expect(response.status).toBe(201);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				timezone,
				timezoneSource: "browser",
				utcOffsetMinutes: expectedOffset,
			}),
			expect.anything(),
		);
	});

	it.each([
		[
			"clock-in at the unchanged clock-out",
			"entry-clock-in",
			"2026-07-01T16:00:00Z",
			"2026-07-01T08:00:00.000Z",
			"2026-07-01T16:00:00.000Z",
		],
		[
			"clock-out before the unchanged clock-in",
			"entry-clock-out",
			"2026-07-01T07:59:00Z",
			"2026-07-01T08:00:00.000Z",
			"2026-07-01T16:00:00.000Z",
		],
	])("rejects a corrected %s", async (_label, targetEntryId, timestamp, periodStart, periodEnd) => {
		mockPostTarget({ targetEntryId, periodStart, periodEnd });

		const response = await POST(
			createPostRequest({
				replacesEntryId: targetEntryId,
				timestamp,
				notes: "Invalid endpoint range",
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Clock out time must be after clock in time",
		});
		expect(mockState.canApproveFor).not.toHaveBeenCalled();
	});

	it("creates a self clock-in correction as inactive with a linked pending approval", async () => {
		mockState.limit
			.mockResolvedValueOnce([
				{ id: "employee-1", organizationId: "org-1", teamId: "team-1", userId: "user-1" },
			])
			.mockResolvedValueOnce([
				{ id: "entry-clock-in", employeeId: "employee-1", organizationId: "org-1" },
			])
			.mockResolvedValueOnce([
				{ id: "employee-1", organizationId: "org-1", teamId: "team-1", userId: "user-1" },
			])
			.mockResolvedValueOnce([
				{
					id: "period-1",
					clockInId: "entry-clock-in",
					clockOutId: "entry-clock-out",
					startTime: new Date("2026-07-01T06:00:00.000Z"),
					endTime: new Date("2026-07-01T14:00:00.000Z"),
				},
			]);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "2026-07-01T08:15:00+02:00",
				timezone: "Europe/Berlin",
				notes: "Correct clock-in",
			}),
		);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			entry: { id: "entry-correction" },
			approvalId: "approval-1",
			message: "Correction submitted. Awaiting manager approval.",
		});
		expect(mockState.transaction).toHaveBeenCalledOnce();
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				replacesEntryId: "entry-clock-in",
				isSuperseded: true,
				timestamp: new Date("2026-07-01T06:15:00.000Z"),
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
				utcOffsetMinutes: 120,
			}),
			expect.anything(),
		);
		expect(mockState.createTimeCorrectionApprovalWorkflow).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "org-1",
				requesterEmployeeId: "employee-1",
				workPeriodId: "period-1",
				defaultApproverId: "employee-manager",
				correctionEntryIds: { clockInCorrectionId: "entry-correction" },
			}),
		);
		expect(mockState.runPromise).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expectAndPredicateIncludes(mockState.where.mock.calls[2]?.[0], [
			{ column: "employee.id", value: "employee-1" },
			{ column: "employee.organizationId", value: "org-1" },
			{ column: "employee.isActive", value: true },
		]);
		expectAndPredicateIncludes(mockState.where.mock.calls[3]?.[0], [
			{ column: "workPeriod.employeeId", value: "employee-1" },
			{ column: "workPeriod.organizationId", value: "org-1" },
		]);
		expect(mockState.where.mock.calls[3]?.[0]).toEqual(
			expect.objectContaining({
				conditions: expect.arrayContaining([
					{ column: "workPeriod.deletedAt", type: "isNull" },
					expect.objectContaining({
						conditions: expect.arrayContaining([
							{ column: "workPeriod.clockInId", type: "eq", value: "entry-clock-in" },
							{ column: "workPeriod.clockOutId", type: "eq", value: "entry-clock-in" },
						]),
						type: "or",
					}),
				]),
			}),
		);
	});

	it("links a self clock-out correction to only the clock-out approval endpoint", async () => {
		mockState.limit
			.mockResolvedValueOnce([
				{ id: "employee-1", organizationId: "org-1", teamId: "team-1", userId: "user-1" },
			])
			.mockResolvedValueOnce([
				{ id: "entry-clock-out", employeeId: "employee-1", organizationId: "org-1" },
			])
			.mockResolvedValueOnce([
				{ id: "employee-1", organizationId: "org-1", teamId: "team-1", userId: "user-1" },
			])
			.mockResolvedValueOnce([
				{
					id: "period-1",
					clockInId: "entry-clock-in",
					clockOutId: "entry-clock-out",
					startTime: new Date("2026-07-01T06:00:00.000Z"),
					endTime: new Date("2026-07-01T14:00:00.000Z"),
				},
			]);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-out",
				timestamp: "2026-07-01T16:30:00+02:00",
				notes: "Correct clock-out",
			}),
		);

		expect(response.status).toBe(201);
		expect(mockState.createTimeCorrectionApprovalWorkflow).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				correctionEntryIds: { clockOutCorrectionId: "entry-correction" },
			}),
		);
		expect(mockState.createTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				isSuperseded: true,
				replacesEntryId: "entry-clock-out",
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
				utcOffsetMinutes: 120,
			}),
			expect.anything(),
		);
	});

	it("keeps manager corrections on the immediate path using the target employee timezone", async () => {
		mockPostTarget({
			currentEmployeeId: "employee-manager",
			targetEmployeeId: "employee-target",
			targetUserId: "target-user",
		});
		mockState.canApproveFor.mockResolvedValueOnce(true);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "2026-07-01T08:15:00Z",
				timezone: "UTC",
				notes: "Manager correction",
			}),
		);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			entry: { id: "entry-direct-correction" },
			message: "Correction applied successfully.",
		});
		expect(mockState.getUserTimezone).toHaveBeenCalledWith("target-user");
		expect(mockState.createCorrectionEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-target",
				organizationId: "org-1",
				workPeriodId: "period-1",
				timezone: "Europe/Berlin",
				timezoneSource: "manager_target_user_setting",
				utcOffsetMinutes: 120,
			}),
		);
		expect(mockState.runPromise).toHaveBeenCalledOnce();
		expect(mockState.transaction).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.createTimeCorrectionApprovalWorkflow).not.toHaveBeenCalled();
	});

	it.each([
		[
			"an earlier corrected clock-in",
			"entry-clock-in",
			"2026-07-01T08:15:00Z",
			"2026-07-02T08:00:00.000Z",
			"2026-07-02T17:00:00.000Z",
			"2026-07-01",
		],
		[
			"a clock-out-only correction",
			"entry-clock-out",
			"2026-07-03T17:30:00Z",
			"2026-07-02T08:00:00.000Z",
			"2026-07-02T17:00:00.000Z",
			"2026-07-02",
		],
	])("marks the target employee work balance dirty after applying %s", async (_label, targetEntryId, timestamp, periodStart, periodEnd, dirtyFromDate) => {
		mockPostTarget({
			currentEmployeeId: "employee-manager",
			periodEnd,
			periodStart,
			targetEmployeeId: "employee-target",
			targetEntryId,
			targetUserId: "target-user",
		});
		mockState.canApproveFor.mockResolvedValueOnce(true);

		const response = await POST(
			createPostRequest({
				replacesEntryId: targetEntryId,
				timestamp,
				notes: "Manager correction",
			}),
		);

		expect(response.status).toBe(201);
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			dirtyFromDate,
			employeeId: "employee-target",
			organizationId: "org-1",
		});
		expect(mockState.runPromise.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("keeps a successful direct correction response when work balance invalidation fails", async () => {
		mockPostTarget({
			currentEmployeeId: "employee-manager",
			targetEmployeeId: "employee-target",
			targetUserId: "target-user",
		});
		mockState.canApproveFor.mockResolvedValueOnce(true);
		const error = new Error("dirty marker failed");
		mockState.markEmployeeWorkBalanceDirty.mockRejectedValueOnce(error);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "2026-07-01T08:15:00Z",
				notes: "Manager correction",
			}),
		);

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({
			entry: { id: "entry-direct-correction" },
			message: "Correction applied successfully.",
		});
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledOnce();
		expect(mockState.loggerError).toHaveBeenCalledWith(
			expect.objectContaining({
				error,
				employeeId: "employee-target",
				organizationId: "org-1",
			}),
			"Failed to mark work balance dirty after direct time correction",
		);
	});

	it("returns a bounded conflict when an immediate manager correction loses the race", async () => {
		mockPostTarget({
			currentEmployeeId: "employee-manager",
			targetEmployeeId: "employee-target",
			targetUserId: "target-user",
		});
		mockState.canApproveFor.mockResolvedValueOnce(true);
		mockState.runPromise.mockImplementationOnce(() =>
			Effect.runPromise(
				Effect.fail(
					new ConflictError({
						message: "Time entry was already corrected by another process",
						conflictType: "time_entry_already_corrected",
					}),
				),
			),
		);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "2026-07-01T08:15:00Z",
				notes: "Manager correction",
			}),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "Time entry was already corrected by another process",
			code: "time_entry_already_corrected",
		});
	});

	it("rolls back the inactive correction when approval creation fails", async () => {
		mockPostTarget();
		let committed = false;
		mockState.transaction.mockImplementationOnce(
			async (callback: (tx: unknown) => Promise<unknown>) => {
				const result = await callback({});
				committed = true;
				return result;
			},
		);
		mockState.createTimeCorrectionApprovalWorkflow.mockReturnValueOnce(
			Effect.fail(new Error("approval insert failed")),
		);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "2026-07-01T08:15:00Z",
				notes: "Correction that must roll back",
			}),
		);

		expect(response.status).toBe(500);
		expect(committed).toBe(false);
		expect(mockState.createTimeEntry).toHaveBeenCalledOnce();
		expect(mockState.createTimeCorrectionApprovalWorkflow).toHaveBeenCalledOnce();
	});

	it("returns a conflict for a duplicate pending correction approval", async () => {
		mockPostTarget();
		const durableCorrections: Array<{ id: string }> = [];
		let stagedCorrection: { id: string } | null = null;
		mockState.createTimeEntry.mockImplementationOnce(async () => {
			stagedCorrection = { id: "entry-correction" };
			return stagedCorrection;
		});
		mockState.transaction.mockImplementationOnce(
			async (callback: (tx: unknown) => Promise<unknown>) => {
				const result = await callback({});
				if (stagedCorrection) durableCorrections.push(stagedCorrection);
				return result;
			},
		);
		mockState.createTimeCorrectionApprovalWorkflow.mockReturnValueOnce(
			Effect.fail(
				new ConflictError({
					message: "A time correction approval is already pending for this work period",
					conflictType: "pending_time_correction_approval",
				}),
			),
		);

		const response = await POST(
			createPostRequest({
				replacesEntryId: "entry-clock-in",
				timestamp: "2026-07-01T08:15:00Z",
				notes: "Duplicate correction",
			}),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "A time correction approval is already pending for this work period",
			code: "pending_time_correction_approval",
		});
		expect(mockState.createTimeEntry).toHaveBeenCalledOnce();
		expect(mockState.transaction).toHaveBeenCalledOnce();
		expect(durableCorrections).toEqual([]);
	});
});
