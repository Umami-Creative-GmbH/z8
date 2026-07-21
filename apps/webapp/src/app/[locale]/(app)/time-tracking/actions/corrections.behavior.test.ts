import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	selectLimit: vi.fn(),
	employeeFindFirst: vi.fn(),
	timeEntryFindMany: vi.fn(),
	txSelectForUpdate: vi.fn(),
	txTimeEntryFindFirst: vi.fn(),
	txInsertValues: vi.fn(),
	txDeleteReturning: vi.fn(),
	withTransaction: vi.fn(),
	executeSubmission: vi.fn(),
	getManager: vi.fn(),
	getSession: vi.fn(),
	getTimezone: vi.fn(),
	requireBilling: vi.fn(),
	sendEmail: vi.fn(),
	maintenance: vi.fn(),
	events: [] as string[],
}));

vi.mock("next/headers", () => ({
	headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: state.getSession } },
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: state.getManager,
}));

vi.mock("@/lib/approvals/server/time-correction-approvals", () => ({
	deleteCancelledTimeCorrectionsInTransaction: vi.fn(),
	executeTimeCorrectionSubmissionInTransaction: state.executeSubmission,
	finalizeTimeCorrectionTerminalInTransaction: vi.fn(),
	insertTimeCorrectionSourceEntry: vi.fn(async (input) => {
		const [created] = await input.dbService.db
			.insert()
			.values({
				...input.timezoneCapture,
				id: input.id,
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				type: "correction",
				timestamp: input.timestamp,
				hash: input.hash,
				previousHash: input.previousHash,
				previousEntryId: input.previousEntryId,
				replacesEntryId: input.replacesEntryId,
				isSuperseded: true,
				supersededById: null,
				notes: input.notes,
				location: input.location ?? null,
				ipAddress: input.ipAddress,
				deviceInfo: input.deviceInfo,
				createdBy: input.createdBy,
			})
			.returning();
		return created ?? null;
	}),
	runAutoCompletedTimeCorrectionMaintenance: async (input: unknown) => {
		state.events.push("maintenance");
		return state.maintenance(input);
	},
}));

vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: () => ({
		repository: { withTransaction: state.withTransaction },
		transitionEngine: {},
	}),
}));

vi.mock("@/lib/billing/guard", () => ({
	isBillingMutationAllowed: (access: { allowed: boolean }) => access.allowed,
	requireBillingForMutation: state.requireBilling,
}));

vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: vi.fn().mockResolvedValue("https://example.com"),
}));

vi.mock("@/lib/email/render", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/email/render")>()),
	renderTimeCorrectionPendingApproval: vi.fn().mockResolvedValue("email"),
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: async (input: unknown) => {
		state.events.push("email");
		return state.sendEmail(input);
	},
}));

vi.mock("@/lib/time-tracking/validation", () => ({
	validateTimeEntryRange: vi.fn().mockResolvedValue({ isValid: true }),
}));

vi.mock("./auth", async (importOriginal) => ({
	...(await importOriginal<typeof import("./auth")>()),
	getCurrentEmployee: vi.fn(),
	getCurrentSession: state.getSession,
	getRequestMetadata: vi.fn().mockResolvedValue({
		ipAddress: "127.0.0.1",
		userAgent: "vitest",
	}),
	getUserTimezone: state.getTimezone,
}));

vi.mock("./shared", () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const modular = await import("./corrections");
const monolithic = await import("../actions");

const ids = {
	employee: "31000000-0000-4000-8000-000000000901",
	manager: "31000000-0000-4000-8000-000000000902",
	period: "31000000-0000-4000-8000-000000000903",
	clockIn: "31000000-0000-4000-8000-000000000904",
	clockOut: "31000000-0000-4000-8000-000000000905",
	team: "31000000-0000-4000-8000-000000000907",
};
const submissionId = "31000000-0000-4000-8000-000000000906";

const employee = {
	id: ids.employee,
	userId: "user-1",
	organizationId: "org-1",
	teamId: null,
	isActive: true,
};
const approvedMember = {
	id: "member-1",
	userId: "user-1",
	organizationId: "org-1",
	status: "approved",
};
const period = {
	id: ids.period,
	employeeId: ids.employee,
	organizationId: "org-1",
	clockInId: ids.clockIn,
	clockOutId: ids.clockOut,
	startTime: new Date("2026-07-01T08:00:00.000Z"),
	endTime: new Date("2026-07-01T16:00:00.000Z"),
	deletedAt: null,
};
const originals = [
	{
		id: ids.clockIn,
		employeeId: ids.employee,
		organizationId: "org-1",
		timestamp: period.startTime,
		isSuperseded: false,
		hash: "clock-in-hash",
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
		utcOffsetMinutes: 120,
	},
	{
		id: ids.clockOut,
		employeeId: ids.employee,
		organizationId: "org-1",
		timestamp: period.endTime,
		isSuperseded: false,
		hash: "clock-out-hash",
		timezone: "America/New_York",
		timezoneSource: "browser",
		utcOffsetMinutes: -240,
	},
];

function transactionDb() {
	const lockedQuery = () => ({
		for: state.txSelectForUpdate,
		limit: vi.fn(() => ({ for: state.txSelectForUpdate })),
	});
	return {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					for: state.txSelectForUpdate,
					limit: vi.fn(() => ({ for: state.txSelectForUpdate })),
					orderBy: vi.fn(lockedQuery),
				})),
			})),
		})),
		insert: vi.fn(() => ({ values: state.txInsertValues })),
		delete: vi.fn(() => ({
			where: vi.fn(() => ({ returning: state.txDeleteReturning })),
		})),
		query: {
			timeEntry: { findFirst: state.txTimeEntryFindFirst },
		},
	};
}

function configure(result: {
	kind: "auto_completed" | "default_created";
	disposition?: "executed" | "replayed";
	authority?: "legacy" | "canonical";
	submittedToEmployeeId?: string | null;
}) {
	state.getSession.mockResolvedValue({
		user: { id: "user-1" },
		session: { activeOrganizationId: "org-1" },
	});
	state.getTimezone.mockResolvedValue("UTC");
	state.requireBilling.mockResolvedValue({ allowed: true });
	state.employeeFindFirst.mockResolvedValue(employee);
	state.selectLimit.mockResolvedValue([period]);
	state.timeEntryFindMany.mockResolvedValue(originals);
	state.txSelectForUpdate.mockReset();
	state.txSelectForUpdate
		.mockResolvedValueOnce([employee])
		.mockResolvedValueOnce([approvedMember])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([period])
		.mockResolvedValueOnce([originals[0]]);
	state.getManager.mockResolvedValue(ids.manager);
	state.txTimeEntryFindFirst.mockReset();
	state.txTimeEntryFindFirst
		.mockResolvedValueOnce(originals[1])
		.mockResolvedValue(null);
	state.txInsertValues.mockImplementation((values) => ({
		returning: async () => [{ ...values, createdAt: new Date() }],
	}));
	state.txDeleteReturning.mockReset().mockResolvedValue([]);
	const tx = transactionDb();
	state.withTransaction.mockImplementation(async (operation) => {
		state.events.push("transaction");
		const context = { dbService: { db: tx } };
		return operation(context);
	});
	const autoCompletion = {
		period,
		workBalanceDirtyMark: {
			employeeId: ids.employee,
			organizationId: "org-1",
			dirtyFromDate: "2026-07-01",
		},
	};
	state.executeSubmission.mockImplementation(async (input) => {
		expect(input.context.dbService.db).toBe(input.dbService.db);
		expect(input.overtimeRisk).toBeNull();
		state.events.push("boundary");
		return {
			disposition: result.disposition ?? "executed",
			kind: result.kind,
			approvalRequestId: "approval-1",
			...(result.kind === "auto_completed" ? { autoCompletion } : {}),
			postCommit: {
				authority: result.authority ?? "canonical",
				submittedToEmployeeId: result.submittedToEmployeeId ?? null,
				terminal:
					result.kind === "auto_completed" && result.authority === "legacy"
						? {
								kind: "approved",
								dirtyFromDate: "2026-07-01",
								requesterEmployeeId: ids.employee,
							}
						: null,
			},
		};
	});
	state.sendEmail.mockResolvedValue({ success: true });
}

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: state.employeeFindFirst },
			timeEntry: { findMany: state.timeEntryFindMany },
			userSettings: { findFirst: vi.fn() },
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit: state.selectLimit })),
			})),
		})),
	},
}));

describe("time correction submission actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.events.length = 0;
	});

	it.each([
		["modular", modular.requestTimeCorrectionEffect],
		["monolithic", monolithic.requestTimeCorrectionEffect],
	] as const)("returns the stable pending response from the %s path", async (_name, action) => {
		configure({ kind: "default_created" });

		const result = await action({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toEqual({
			success: true,
			data: { approvalId: "approval-1", status: "pending" },
		});
		expect(state.withTransaction).toHaveBeenCalledOnce();
		expect(state.executeSubmission).toHaveBeenCalledOnce();
		expect(state.events).toEqual(["transaction", "boundary"]);
	});

	it("rejects an active SCIM employee whose organization membership is suspended", async () => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([{ ...approvedMember, status: "suspended" }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[0]]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.txInsertValues).not.toHaveBeenCalled();
		expect(state.executeSubmission).not.toHaveBeenCalled();
	});

	it.each([
		["missing", []],
		["duplicate", [approvedMember, { ...approvedMember, id: "member-2" }]],
		["wrong organization", [{ ...approvedMember, organizationId: "org-2" }]],
	] as const)("rejects a %s organization membership before correction insertion", async (_label, members) => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce(members);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.txInsertValues).not.toHaveBeenCalled();
		expect(state.executeSubmission).not.toHaveBeenCalled();
	});

	it("returns approved without direct canonical side effects", async () => {
		configure({ kind: "auto_completed" });

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toEqual({
			success: true,
			data: { approvalId: "approval-1", status: "approved" },
		});
		expect(state.maintenance).not.toHaveBeenCalled();
		expect(state.sendEmail).not.toHaveBeenCalled();
	});

	it("rejects an invalid cycle token before opening the repository transaction", async () => {
		configure({ kind: "default_created" });

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId: "not-a-uuid",
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.withTransaction).not.toHaveBeenCalled();
	});

	it.each([
		["missing", []],
		["duplicate", [employee, { ...employee }]],
	] as const)("fails closed when the locked submission target is %s", async (_label, lockedEmployees) => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate.mockReset().mockResolvedValueOnce(lockedEmployees);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toMatchObject({ success: false });
		expect(state.executeSubmission).not.toHaveBeenCalled();
		expect(state.txInsertValues).not.toHaveBeenCalled();
	});

	it("lets Task 7 route a managerless submission", async () => {
		configure({ kind: "default_created" });
		state.getManager.mockResolvedValue(null);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(true);
		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({ defaultApproverId: null }),
		);
	});

	it("routes with the organization-scoped team locked in the transaction", async () => {
		configure({ kind: "default_created" });
		const employeeWithTeam = { ...employee, teamId: ids.team };
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employeeWithTeam])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([
				{ organizationId: "org-1", employeeId: ids.employee, teamId: ids.team },
			])
			.mockResolvedValueOnce([{ id: ids.team, organizationId: "org-1" }])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[0]]);

		await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(state.executeSubmission).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: ids.team }),
		);
	});

	it("derives the same correction row identity for an exact request retry", async () => {
		configure({ kind: "default_created" });
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		};

		await modular.requestTimeCorrectionEffect(request);
		const firstId = state.txInsertValues.mock.calls.at(-1)?.[0].id;
		configure({ kind: "default_created" });
		await modular.requestTimeCorrectionEffect(request);
		const retryId = state.txInsertValues.mock.calls.at(-1)?.[0].id;

		expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
		expect(retryId).toBe(firstId);
	});

	it("derives a new correction row identity for a later cycle token", async () => {
		configure({ kind: "default_created" });
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		};
		await modular.requestTimeCorrectionEffect(request);
		const firstId = state.txInsertValues.mock.calls.at(-1)?.[0].id;
		configure({ kind: "default_created" });
		await modular.requestTimeCorrectionEffect({
			...request,
			submissionId: "31000000-0000-4000-8000-000000000908",
		});
		const laterId = state.txInsertValues.mock.calls.at(-1)?.[0].id;

		expect(laterId).not.toBe(firstId);
	});

	it("removes only a correction row inserted by an exact replay", async () => {
		configure({ kind: "default_created", disposition: "replayed" });
		state.txDeleteReturning.mockImplementation(async () => [
			{ id: state.txInsertValues.mock.calls[0]?.[0].id },
		]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(true);
		expect(state.txInsertValues).toHaveBeenCalledOnce();
		expect(state.txDeleteReturning).toHaveBeenCalledOnce();
		expect(state.maintenance).not.toHaveBeenCalled();
		expect(state.sendEmail).not.toHaveBeenCalled();
	});

	it("preserves a matching correction row that existed before an exact replay", async () => {
		const request = {
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		};
		configure({ kind: "default_created" });
		await modular.requestTimeCorrectionEffect(request);
		const existingCorrection = state.txInsertValues.mock.calls[0]?.[0];

		configure({ kind: "default_created", disposition: "replayed" });
		state.txTimeEntryFindFirst
			.mockReset()
			.mockResolvedValueOnce(originals[1])
			.mockResolvedValueOnce(existingCorrection);

		const replay = await modular.requestTimeCorrectionEffect(request);

		expect(replay.success).toBe(true);
		expect(state.txInsertValues).toHaveBeenCalledOnce();
		expect(state.txDeleteReturning).not.toHaveBeenCalled();
	});

	it("supports a clock-out-only request without inserting a clock-in row", async () => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce([originals[1]]);

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "08:00",
			newClockOutDate: "2026-07-01",
			newClockOutTime: "17:00",
			reason: "Late clock-out",
		});

		expect(result.success).toBe(true);
		expect(state.txInsertValues).toHaveBeenCalledOnce();
		expect(state.txInsertValues.mock.calls[0]?.[0].replacesEntryId).toBe(
			ids.clockOut,
		);
	});

	it("dispatches legacy maintenance after commit and preserves success on failure", async () => {
		configure({ kind: "auto_completed", authority: "legacy" });
		state.maintenance.mockRejectedValue(new Error("maintenance unavailable"));

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(true);
		expect(state.events).toEqual(["transaction", "boundary", "maintenance"]);
	});

	it("sends legacy manager email after commit and preserves success on delivery failure", async () => {
		configure({
			kind: "default_created",
			authority: "legacy",
			submittedToEmployeeId: ids.manager,
		});
		state.employeeFindFirst
			.mockReset()
			.mockResolvedValueOnce(employee)
			.mockResolvedValueOnce({
				...employee,
				id: ids.manager,
				user: { name: "Manager", email: "manager@example.com" },
			})
			.mockResolvedValueOnce({
				...employee,
				user: { name: "Employee", email: "employee@example.com" },
			});
		state.sendEmail.mockRejectedValue(new Error("email unavailable"));

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(true);
		expect(state.events.slice(0, 2)).toEqual(["transaction", "boundary"]);
		expect(state.events.slice(2).every((event) => event === "email")).toBe(
			true,
		);
	});

	it("does not dispatch side effects when the repository transaction rolls back", async () => {
		configure({ kind: "auto_completed", authority: "legacy" });
		state.withTransaction.mockRejectedValue(new Error("rollback"));

		const result = await modular.requestTimeCorrectionEffect({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result.success).toBe(false);
		expect(state.maintenance).not.toHaveBeenCalled();
		expect(state.sendEmail).not.toHaveBeenCalled();
	});

	it("submits deletion through the same boundary with independent endpoint zones", async () => {
		configure({ kind: "default_created" });
		state.txSelectForUpdate
			.mockReset()
			.mockResolvedValueOnce([employee])
			.mockResolvedValueOnce([approvedMember])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([period])
			.mockResolvedValueOnce(originals);

		const result = await modular.requestTimeEntryDeletion({
			workPeriodId: ids.period,
			submissionId,
			reason: "Duplicate entry",
		});

		expect(result).toEqual({
			success: true,
			data: { approvalId: "approval-1", status: "pending" },
		});
		const inserted = state.txInsertValues.mock.calls.map(([value]) => value);
		expect(inserted).toHaveLength(2);
		expect(inserted.map((value) => value.timezone)).toEqual([
			"Europe/Berlin",
			"America/New_York",
		]);
		expect(inserted.every((value) => value.isSuperseded === true)).toBe(true);
	});

	it("preserves the monolithic billing guard result without entering a transaction", async () => {
		configure({ kind: "default_created" });
		state.requireBilling.mockResolvedValue({
			allowed: false,
			reason: "subscription_required",
		});

		const result = await monolithic.requestTimeCorrection({
			workPeriodId: ids.period,
			submissionId,
			newClockInDate: "2026-07-01",
			newClockInTime: "09:00",
			reason: "Missed punch",
		});

		expect(result).toEqual({
			success: false,
			error: "billing_required",
			code: "subscription_required",
		});
		expect(state.withTransaction).not.toHaveBeenCalled();
	});
});
