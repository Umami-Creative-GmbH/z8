import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";

/**
 * The web break adapter at its seams (#304): the clock-out owner, the shared
 * close/resume operation and the legacy writes. The committed graph itself is
 * verified on PostgreSQL in `clocking.active-break.integration.test.ts`.
 */
const mockState = vi.hoisted(() => ({
	admission: "legacy" as "legacy" | "append",
	ownerInputs: [] as unknown[],
	assertReview: vi.fn(),
	replayCloseResumeWork: vi.fn(),
	closeAndResumeWork: vi.fn(),
	createTimeEntry: vi.fn(),
	markEmployeeWorkBalanceDirty: vi.fn(),
	getActiveWorkPeriod: vi.fn(),
	updateSet: vi.fn(),
	updateReturning: vi.fn(),
	insertValues: vi.fn(),
	target: [{ id: "period-1", approvalStatus: "approved" }] as unknown[],
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: { nowInstant: () => original.parseInstant("2026-05-04T10:00:00Z") },
	};
});
vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ isOrgAdminCasl: vi.fn() }));
vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: vi.fn(),
}));
vi.mock("@/lib/billing/guard", () => ({
	isBillingMutationAllowed: () => true,
	requireBillingForMutation: async () => ({ canAccess: true }),
}));
vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mockState.markEmployeeWorkBalanceDirty,
}));
vi.mock("@/lib/time-tracking/work-period-review", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/time-tracking/work-period-review")>()),
	assertNoUnresolvedWorkPeriodReview: mockState.assertReview,
}));
vi.mock("@/lib/time-tracking/close-resume-work", () => ({
	replayCloseResumeWork: mockState.replayCloseResumeWork,
	closeAndResumeWork: mockState.closeAndResumeWork,
}));
vi.mock("@/lib/time-tracking/web-clock-out-transaction", () => ({
	withWebClockOutTransaction: async (
		input: unknown,
		_runtime: unknown,
		operation: (context: unknown) => Promise<unknown>,
	) => {
		mockState.ownerInputs.push(input);
		const chain = (rows: () => unknown) => ({
			from: () => ({ where: () => ({ limit: async () => rows() }) }),
		});
		return operation({
			admission: mockState.admission,
			assertEmployee: vi.fn(),
			db: {
				select: () => chain(() => mockState.target),
				update: () => ({
					set: (values: unknown) => {
						mockState.updateSet(values);
						return { where: () => ({ returning: mockState.updateReturning }) };
					},
				}),
				insert: () => ({
					values: (values: unknown) => {
						mockState.insertValues(values);
						return {
							returning: async () => [
								{ id: "period-2", startTime: new Date("2026-05-04T10:00:00.000Z") },
							],
						};
					},
				}),
			},
		});
	},
}));
vi.mock("./auth", () => ({
	getCurrentSession: async () => ({ user: { id: "user-1" } }),
	getCurrentEmployee: async () => ({
		id: "employee-1",
		organizationId: "org-1",
		teamId: "team-1",
		managerId: null,
	}),
	getUserTimezone: async () => "Europe/Berlin",
}));
vi.mock("./approvals", () => ({
	sendManualEntryApprovalNotifications: vi.fn(),
	sendManualEntryApprovedNotification: vi.fn(),
}));
vi.mock("./compliance", () => ({
	calculateAndPersistSurcharges: vi.fn(),
	calculateBreaksTakenToday: vi.fn(),
	checkComplianceAfterClockOut: vi.fn(async () => []),
	enforceBreaksAfterClockOut: vi.fn(async () => ({ wasAdjusted: false })),
	reconcileImmediateSurcharges: vi.fn(),
}));
vi.mock("./entry-helpers", () => ({
	checkProjectBudgetAfterClockOut: vi.fn(),
	createTimeEntry: mockState.createTimeEntry,
	validateProjectAssignment: vi.fn(),
}));
vi.mock("./policy-helpers", () => ({
	getEditCapabilityForPeriod: vi.fn(),
}));
vi.mock("./queries", () => ({
	getActiveWorkPeriod: mockState.getActiveWorkPeriod,
	getTimeSummary: vi.fn(),
}));
vi.mock("./shared", () => ({
	BREAK_WARNING_THRESHOLD_MINUTES: 30,
	EMPTY_BREAK_REMINDER_STATUS: {},
	logger: mockState.logger,
	ONE_MINUTE_MS: 60_000,
}));

const { addBreakToActiveSession } = await import("./clocking");

const submissionId = "30400000-0000-4000-8000-000000000001";

function resumeResult(workPeriodId: string, at: string) {
	return {
		resume: { workPeriodId, start: { at } },
		close: { workPeriodId: "period-1" },
	};
}

describe("addBreakToActiveSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:00:00.000Z"));
		mockState.admission = "legacy";
		mockState.ownerInputs.length = 0;
		mockState.target = [{ id: "period-1", approvalStatus: "approved" }];
		mockState.replayCloseResumeWork.mockResolvedValue(null);
		mockState.updateReturning.mockResolvedValue([{ id: "period-1" }]);
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "period-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			startTime: new Date("2026-05-04T09:00:00.000Z"),
			workLocationType: "remote",
		});
		mockState.createTimeEntry
			.mockResolvedValueOnce({ id: "clock-out-1", type: "clock_out" })
			.mockResolvedValueOnce({ id: "clock-in-2", type: "clock_in" });
	});

	it("keeps the established writes of a legacy organization inside the clock-out owner", async () => {
		const result = await addBreakToActiveSession(15, {
			submissionId,
			browserTimezone: "Europe/Lisbon",
		});

		expect(result).toEqual({
			success: true,
			data: { id: "period-2", startTime: new Date("2026-05-04T10:00:00.000Z") },
		});
		// Replay transaction first, then the coordinated break at the break start.
		expect(mockState.ownerInputs).toEqual([
			{ organizationId: "org-1", employeeId: "employee-1", userId: "user-1", submissionId },
			expect.objectContaining({
				submissionId,
				workPeriodId: "period-1",
				endTime: parseInstant("2026-05-04T09:45:00Z"),
			}),
		]);
		expect(mockState.assertReview).toHaveBeenCalledWith(expect.anything(), "org-1", {
			id: "period-1",
			approvalStatus: "approved",
		});
		expect(mockState.createTimeEntry).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: "clock_out",
				timestamp: new Date("2026-05-04T09:45:00.000Z"),
				createdBy: "user-1",
				// Captured in the browser zone at the break start.
				timezone: "Europe/Lisbon",
				timezoneSource: "browser",
				utcOffsetMinutes: 60,
			}),
			expect.anything(),
		);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				clockOutId: "clock-out-1",
				endTime: new Date("2026-05-04T09:45:00.000Z"),
				durationMinutes: 45,
				isActive: false,
			}),
		);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				clockInId: "clock-in-2",
				startTime: new Date("2026-05-04T10:00:00.000Z"),
				workLocationType: "remote",
			}),
		);
		expect(mockState.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-04",
		});
		expect(mockState.closeAndResumeWork).not.toHaveBeenCalled();
	});

	it("refuses a break on work under review with useful feedback and no writes", async () => {
		mockState.assertReview.mockRejectedValueOnce(
			new ConflictError({
				message: "This work period is awaiting approval and cannot be edited",
				conflictType: "work_period_pending_approval",
			}),
		);

		await expect(addBreakToActiveSession(15, { submissionId })).resolves.toEqual({
			success: false,
			error:
				"This work period is awaiting approval and cannot be edited. Add the break once it is resolved.",
		});
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("runs the shared close/resume operation in an adopted organization", async () => {
		mockState.admission = "append";
		mockState.closeAndResumeWork.mockResolvedValue({
			disposition: "executed",
			result: resumeResult("period-2", "2026-05-04T10:00:00Z"),
			closed: {
				entry: { id: "clock-out-1" },
				disposition: "executed",
				surchargeSnapshot: null,
				result: {
					workPeriodId: "period-1",
					segment: {
						startAt: "2026-05-04T09:00:00Z",
						endAt: "2026-05-04T09:45:00Z",
						durationMinutes: 45,
					},
					attribution: { projectId: null },
				},
			},
		});

		const result = await addBreakToActiveSession(15, {
			submissionId,
			browserTimezone: "Europe/Lisbon",
		});

		expect(result).toEqual({
			success: true,
			data: { id: "period-2", startTime: new Date("2026-05-04T10:00:00.000Z") },
		});
		// A break never routes approval (#361).
		expect(mockState.ownerInputs[1]).not.toHaveProperty("requiresApproval");
		expect(mockState.closeAndResumeWork).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			employeeId: "employee-1",
			teamId: "team-1",
			actorUserId: "user-1",
			workPeriodId: "period-1",
			command: {
				version: 1,
				operationId: submissionId,
				breakMinutes: 15,
				browserTimezone: "Europe/Lisbon",
				deviceInfo: "web",
			},
			writer: expect.objectContaining({ writer: "web_clock_out", deviceInfo: "web" }),
			close: {
				instant: parseInstant("2026-05-04T09:45:00Z"),
				capture: { timezone: "Europe/Lisbon", timezoneSource: "browser", utcOffsetMinutes: 60 },
			},
			resume: {
				instant: parseInstant("2026-05-04T10:00:00Z"),
				capture: { timezone: "Europe/Lisbon", timezoneSource: "browser", utcOffsetMinutes: 60 },
			},
		});
		// The operation commits its own balance intent; no legacy writes run.
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
		expect(mockState.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
	});

	it("replays a committed break without preflight reads or writes", async () => {
		mockState.replayCloseResumeWork.mockResolvedValueOnce({
			disposition: "replayed",
			result: resumeResult("period-2", "2026-05-04T09:59:00Z"),
		});

		await expect(addBreakToActiveSession(15, { submissionId })).resolves.toEqual({
			success: true,
			data: { id: "period-2", startTime: new Date("2026-05-04T09:59:00.000Z") },
		});
		expect(mockState.ownerInputs).toHaveLength(1);
		expect(mockState.getActiveWorkPeriod).not.toHaveBeenCalled();
		expect(mockState.closeAndResumeWork).not.toHaveBeenCalled();
		expect(mockState.createTimeEntry).not.toHaveBeenCalled();
	});

	it("validates the request before any transaction", async () => {
		await expect(addBreakToActiveSession(0)).resolves.toEqual({
			success: false,
			error: "Enter a break duration of at least 1 minute.",
		});
		await expect(addBreakToActiveSession(15, { submissionId: "not-a-uuid" })).resolves.toEqual({
			success: false,
			error: "Failed to add break. Please try again.",
		});
		expect(mockState.ownerInputs).toHaveLength(0);
	});

	it("refuses a break as long as the active session", async () => {
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "period-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			startTime: new Date("2026-05-04T09:45:00.000Z"),
			workLocationType: "office",
		});

		await expect(addBreakToActiveSession(15, { submissionId })).resolves.toEqual({
			success: false,
			error: "Break duration must be shorter than your current session.",
		});
		// Only the replay transaction ran.
		expect(mockState.ownerInputs).toHaveLength(1);
	});

	it("reports that the employee is not clocked in", async () => {
		mockState.getActiveWorkPeriod.mockResolvedValue(null);

		await expect(addBreakToActiveSession(15, { submissionId })).resolves.toEqual({
			success: false,
			error: "You are not currently clocked in.",
		});
	});
});
